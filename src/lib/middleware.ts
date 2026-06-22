import { Env, User } from '../types';
import { getOrCreateJwtSecret, readCsrfCookie } from './auth';
import { importJwtSecret, verifyJWT } from './jwt';
import { SessionModel } from '../models/session';
import { UserModel } from '../models/user';

/**
 * Applies standard security headers and Content-Security-Policy (CSP) with a nonce.
 */
export function applySecurityHeaders(response: Response, nonce: string): Response {
  const newHeaders = new Headers(response.headers);
  newHeaders.set('X-Content-Type-Options', 'nosniff');
  newHeaders.set('X-Frame-Options', 'DENY');
  newHeaders.set('X-XSS-Protection', '1; mode=block');
  newHeaders.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  
  if (!newHeaders.has('Content-Security-Policy')) {
    newHeaders.set(
      'Content-Security-Policy',
      `default-src 'self'; script-src 'self' 'nonce-${nonce}' https://challenges.cloudflare.com https://static.cloudflareinsights.com; script-src-attr 'unsafe-inline'; frame-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://icons.duckduckgo.com; connect-src 'self' https://challenges.cloudflare.com https://cloudflare-dns.com https://1.1.1.1;`
    );
  }

  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: newHeaders
  });
}

/**
 * Parses authorization header and verifies JWT to get the current authenticated user.
 */
export async function getCurrentUser(request: Request, env: Env): Promise<User | null> {
  const authHeader = request.headers.get("Authorization") || "";
  let accessToken = "";
  if (authHeader.startsWith("Bearer ")) {
    accessToken = authHeader.slice(7);
  }

  if (!accessToken) {
    return null;
  }

  try {
    const secret = await getOrCreateJwtSecret(env);
    const jwtKey = await importJwtSecret(secret);
    const payload = await verifyJWT<{ userId: string; role: string; sessionId: string; exp: number }>(
      accessToken,
      jwtKey
    );
    if (payload) {
      // Validate session in database (enforce statefulness and idle timeout)
      const sessionModel = new SessionModel(env.DB);
      const session = await sessionModel.getSession(payload.sessionId);
      if (!session) {
        return null;
      }

      // Check idle timeout
      const now = Math.floor(Date.now() / 1000);
      const idleTimeoutMin = Number(env.SESSION_IDLE_TIMEOUT_MINUTES) || 60;
      const idleTimeoutSec = idleTimeoutMin * 60;
      const lastActive = session.last_active_at || session.created_at;

      let isPaused = !!session.is_paused;
      if (!isPaused && (now - lastActive > idleTimeoutSec)) {
        const userModel = new UserModel(env.DB);
        const dbUser = await userModel.getById(payload.userId);
        if (dbUser && dbUser.pin_hash) {
          await sessionModel.pauseSession(session.id);
          isPaused = true;
        }
      }

      if (isPaused) {
        return { id: payload.userId, username: "", role: payload.role as any, isPaused: true, sessionId: payload.sessionId };
      }

      // Throttle DB updates: only update if at least 10 seconds have elapsed since last active time
      if (now - lastActive > 10) {
        await sessionModel.updateLastActive(session.id, now);
      }

      return { id: payload.userId, username: "", role: payload.role as any, sessionId: payload.sessionId };
    }
  } catch (e) {
    // Ignore verification errors and return null
  }
  return null;
}

/**
 * Validates CSRF double submit cookie against the request header.
 */
export function validateCsrf(request: Request): boolean {
  const cookieHeader = request.headers.get("Cookie") || "";
  const csrfCookie = readCsrfCookie(cookieHeader);
  const csrfHeader = request.headers.get("X-CSRF-Token");
  return !!csrfCookie && !!csrfHeader && csrfCookie === csrfHeader;
}
