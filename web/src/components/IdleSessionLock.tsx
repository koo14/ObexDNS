import React, { useState, useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { Button, Spinner } from "@blueprintjs/core";
import { Lock, LogOut, Delete } from "lucide-react";
import { hashPin } from "../utils/auth";
import { unlockSession } from "../services";
import type { UserInfo } from "../services";

interface IdleSessionLockProps {
  currentUser: UserInfo | null;
  handleLogout: () => Promise<void>;
  children: React.ReactNode;
}

export const IdleSessionLock: React.FC<IdleSessionLockProps> = ({
  currentUser,
  handleLogout,
  children
}) => {
  const { t } = useTranslation();
  const [isLocked, setIsLocked] = useState<boolean>(() => {
    return sessionStorage.getItem("obex_session_locked") === "true";
  });
  const [pin, setPin] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [attemptsRemaining, setAttemptsRemaining] = useState<number | null>(null);

  const lastActivityRef = useRef<number>(Date.now());

  // Read configurations from localStorage
  const isLockEnabled = localStorage.getItem("obex_session_lock_enabled") === "true";
  const timeoutMinutes = Number(localStorage.getItem("obex_session_lock_timeout")) || 15;
  const isPinSet = currentUser?.pin_enabled;

  // Listen to user activity to reset inactivity timer
  useEffect(() => {
    if (!isLockEnabled || !isPinSet || isLocked || !currentUser) return;

    const resetTimer = () => {
      lastActivityRef.current = Date.now();
    };

    const events = ["mousemove", "mousedown", "keypress", "scroll", "touchstart", "click"];
    events.forEach((event) => {
      window.addEventListener(event, resetTimer);
    });

    // Inactivity check loop
    const interval = setInterval(() => {
      const inactiveMs = Date.now() - lastActivityRef.current;
      const timeoutMs = timeoutMinutes * 60 * 1000;
      if (inactiveMs >= timeoutMs) {
        setIsLocked(true);
        sessionStorage.setItem("obex_session_locked", "true");
      }
    }, 10000); // Check every 10 seconds

    return () => {
      events.forEach((event) => {
        window.removeEventListener(event, resetTimer);
      });
      clearInterval(interval);
    };
  }, [isLockEnabled, isPinSet, isLocked, timeoutMinutes, currentUser]);

  // Listen to the session_paused custom event from interceptor
  useEffect(() => {
    const handlePaused = () => {
      setIsLocked(true);
      sessionStorage.setItem("obex_session_locked", "true");
    };

    window.addEventListener("session_paused", handlePaused);
    return () => {
      window.removeEventListener("session_paused", handlePaused);
    };
  }, []);

  // Handle PIN entry from numeric keyboard (physical keyboard support)
  useEffect(() => {
    if (!isLocked) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (loading) return;
      if (e.key >= "0" && e.key <= "9") {
        handleDigit(e.key);
      } else if (e.key === "Backspace") {
        handleBackspace();
      } else if (e.key === "Escape") {
        handleClear();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isLocked, pin, loading]);

  const handleDigit = (digit: string) => {
    if (pin.length < 4) {
      setPin((prev) => prev + digit);
    }
  };

  const handleBackspace = () => {
    setPin((prev) => prev.slice(0, -1));
  };

  const handleClear = () => {
    setPin("");
    setError("");
  };

  // Submit and verify PIN when 4 digits are completed
  useEffect(() => {
    if (pin.length === 4) {
      submitUnlock();
    }
  }, [pin]);

  const submitUnlock = async () => {
    setLoading(true);
    setError("");
    try {
      const pinHash = await hashPin(pin);
      await unlockSession(pinHash);
      
      // Success! Unlock session
      setIsLocked(false);
      sessionStorage.removeItem("obex_session_locked");
      setPin("");
      setError("");
      setAttemptsRemaining(null);
      // Reset activity clock
      lastActivityRef.current = Date.now();
    } catch (err: any) {
      setPin(""); // Clear PIN on error
      if (err.status === 401 && err.bodyText.includes("too_many_attempts")) {
        setError(t("auth.sessionExpired", "Too many failed attempts. Session terminated."));
        setTimeout(() => {
          handleLogout();
        }, 1500);
      } else if (err.status === 400 || err.status === 401) {
        let attemptsLeft = 3;
        try {
          const body = JSON.parse(err.bodyText);
          if (body && typeof body.attemptsRemaining === "number") {
            attemptsLeft = body.attemptsRemaining;
          }
        } catch {}
        setAttemptsRemaining(attemptsLeft);
        setError(t("auth.pinIncorrect", "Incorrect PIN"));
      } else {
        setError(t("auth.networkError", "Network error. Please try again."));
      }
    } finally {
      setLoading(false);
    }
  };

  if (isLocked) {
    return (
      <div 
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 9999,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          background: "radial-gradient(circle at center, #1b202e 0%, #0d0f14 100%)",
          color: "#e1e6f0",
          fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
          userSelect: "none"
        }}
      >
        <div 
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            width: "320px",
            textAlign: "center"
          }}
        >
          {/* Avatar / Lock Icon */}
          <div 
            style={{
              width: "72px",
              height: "72px",
              borderRadius: "50%",
              background: "rgba(255, 255, 255, 0.05)",
              border: "1px solid rgba(255, 255, 255, 0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              marginBottom: "16px",
              boxShadow: "0 8px 32px rgba(0, 0, 0, 0.3)"
            }}
          >
            {loading ? (
              <Spinner size={32} />
            ) : (
              <Lock size={32} style={{ color: "#4f46e5" }} />
            )}
          </div>

          <h3 style={{ margin: "0 0 8px 0", fontSize: "20px", fontWeight: 600 }}>
            {currentUser?.username}
          </h3>
          <p style={{ margin: "0 0 32px 0", color: "#8a99ad", fontSize: "14px" }}>
            {t("auth.sessionLocked", "Session Locked due to inactivity")}
          </p>

          {/* Dots Indicator */}
          <div 
            style={{
              display: "flex",
              gap: "24px",
              marginBottom: "32px",
              justifyContent: "center"
            }}
          >
            {[0, 1, 2, 3].map((index) => {
              const active = pin.length > index;
              return (
                <div 
                  key={index}
                  style={{
                    width: "14px",
                    height: "14px",
                    borderRadius: "50%",
                    border: "2px solid #4f46e5",
                    background: active ? "#4f46e5" : "transparent",
                    boxShadow: active ? "0 0 12px #4f46e5" : "none",
                    transform: active ? "scale(1.15)" : "scale(1)",
                    transition: "all 0.15s cubic-bezier(0.4, 0, 0.2, 1)"
                  }}
                />
              );
            })}
          </div>

          {/* Error Message */}
          {error && (
            <div 
              style={{
                color: "#ff4d4f",
                fontSize: "13px",
                marginBottom: "24px",
                minHeight: "18px",
                fontWeight: 500
              }}
            >
              {error}
              {attemptsRemaining !== null && (
                <div style={{ fontSize: "12px", color: "#ff7875", marginTop: "4px" }}>
                  {t("auth.attemptsRemaining", "{{count}} attempts remaining", { count: attemptsRemaining })}
                </div>
              )}
            </div>
          )}

          {/* Keypad */}
          <div 
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: "16px 24px",
              width: "100%",
              marginBottom: "40px"
            }}
          >
            {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((num) => (
              <button
                key={num}
                onClick={() => handleDigit(num)}
                disabled={loading}
                style={{
                  height: "56px",
                  borderRadius: "50%",
                  border: "1px solid rgba(255, 255, 255, 0.05)",
                  background: "rgba(255, 255, 255, 0.02)",
                  color: "#e1e6f0",
                  fontSize: "20px",
                  fontWeight: 500,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  outline: "none",
                  transition: "all 0.12s ease",
                  boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
                }}
                onMouseDown={(e) => {
                  e.currentTarget.style.background = "rgba(79, 70, 229, 0.25)";
                  e.currentTarget.style.borderColor = "#4f46e5";
                  e.currentTarget.style.transform = "scale(0.92)";
                }}
                onMouseUp={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                  e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                  e.currentTarget.style.transform = "scale(1)";
                }}
              >
                {num}
              </button>
            ))}

            {/* Clear Button */}
            <button
              onClick={handleClear}
              disabled={loading}
              style={{
                background: "transparent",
                border: "none",
                color: "#8a99ad",
                fontSize: "14px",
                cursor: "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.15s ease"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#e1e6f0")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8a99ad")}
            >
              {t("common.clear", "Clear")}
            </button>

            {/* Digit 0 */}
            <button
              onClick={() => handleDigit("0")}
              disabled={loading}
              style={{
                height: "56px",
                borderRadius: "50%",
                border: "1px solid rgba(255, 255, 255, 0.05)",
                background: "rgba(255, 255, 255, 0.02)",
                color: "#e1e6f0",
                fontSize: "20px",
                fontWeight: 500,
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                outline: "none",
                transition: "all 0.12s ease",
                boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)"
              }}
              onMouseDown={(e) => {
                e.currentTarget.style.background = "rgba(79, 70, 229, 0.25)";
                e.currentTarget.style.borderColor = "#4f46e5";
                e.currentTarget.style.transform = "scale(0.92)";
              }}
              onMouseUp={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.transform = "scale(1)";
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.06)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.1)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "rgba(255, 255, 255, 0.02)";
                e.currentTarget.style.borderColor = "rgba(255, 255, 255, 0.05)";
                e.currentTarget.style.transform = "scale(1)";
              }}
            >
              0
            </button>

            {/* Backspace Button */}
            <button
              onClick={handleBackspace}
              disabled={loading}
              style={{
                background: "transparent",
                border: "none",
                color: "#8a99ad",
                cursor: "pointer",
                outline: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                transition: "color 0.15s ease"
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = "#e1e6f0")}
              onMouseLeave={(e) => (e.currentTarget.style.color = "#8a99ad")}
            >
              <Delete size={20} />
            </button>
          </div>

          {/* Fallback Log Out */}
          <Button
            minimal
            icon={<LogOut size={16} />}
            onClick={handleLogout}
            style={{
              color: "#8a99ad",
              fontSize: "13px"
            }}
          >
            {t("auth.logoutAndReturn", "Log Out Session")}
          </Button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
};
