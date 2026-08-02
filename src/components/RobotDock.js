import React, { useEffect, useMemo, useState } from "react";

// Matches the phase color tokens defined in ChatBot.css (--pf-divergent,
// --pf-convergent, --pf-incubation, --pf-conflict, --pf-neutral). Those
// custom properties are deliberately scoped to .chatbot-container (see
// that file's header comment) and aren't reliably available out here —
// RobotDock is rendered as ChatBot's sibling and may be on screen while
// ChatBot itself is unmounted — so the literal values are duplicated
// rather than referenced via var(...). Keep in sync if the tokens change.
const PHASE_COLORS = {
  divergent: "#2f6fed",
  convergent: "#d9860f",
  incubation: "#6b7280",
  conflict: "#e2483d",
  neutral: "#8a8fa3",
};

function phaseColor(phase) {
  return PHASE_COLORS[phase] || PHASE_COLORS.neutral;
}

// Keeps the toast to a quick 1-2 line read instead of a full nudge
// paragraph — the full text is still available once the user hits
// Accept and opens the chat.
const TOAST_TEXT_MAX_CHARS = 100;

function shortenNudgeText(text) {
  const trimmed = (text || "").replace(/\s+/g, " ").trim();
  if (trimmed.length <= TOAST_TEXT_MAX_CHARS) return trimmed;
  return `${trimmed.slice(0, TOAST_TEXT_MAX_CHARS).trimEnd()}…`;
}

export default function RobotDock({
  src,
  show = true,
  phase = null,
  position = { left: 16, bottom: 108 },
  size = 300,
  zIndex = 10070,
  ringWidth = 4,
  loop = true,
  onEnded = null,
  countdownEndsAt = null,
  countdownDurationMs = 30000,

  onOpenChat = null, // ✅ NEW

  // ✅ NEW — nudge toast shown beside the dock. `toast` is
  // { id, text, chips, phase, meta, createdAt } or null/undefined when
  // there's nothing to show. `bump` is a short-lived boolean the parent
  // flips true->false whenever a new toast arrives, used to nudge the
  // dock icon itself by a few pixels so it visibly reacts too.
  toast = null,
  toastDurationMs = 15000,
  onAcceptToast = null,
  onRejectToast = null,
  onSnoozeToast = null,
  bump = false,
}) {
  const { left, right, top, bottom } = position;

  const neutralRing = "rgba(0, 0, 0, 0.18)";
  const ringColor =
    phase === "divergent"
      ? "rgba(45, 130, 255, 0.95)"
      : phase === "convergent"
      ? "rgba(255, 153, 0, 0.95)"
      : neutralRing;

  const [progress, setProgress] = useState(0);

  useEffect(() => {
    if (!countdownEndsAt) {
      setProgress(0);
      return;
    }

    let raf = 0;
    const tick = () => {
      const now = Date.now();
      const remaining = Math.max(0, countdownEndsAt - now);
      const p = Math.min(1, remaining / countdownDurationMs);
      setProgress(p);
      if (remaining > 0) raf = requestAnimationFrame(tick);
    };

    tick();
    return () => cancelAnimationFrame(raf);
  }, [countdownEndsAt, countdownDurationMs]);

  const countdownActive = Boolean(countdownEndsAt && progress > 0);
  const effectiveRingColor = countdownActive ? ringColor : neutralRing;

  const radius = useMemo(() => size / 2 - ringWidth / 2, [size, ringWidth]);
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const dashOffset = useMemo(
    () => circumference * (1 - progress),
    [circumference, progress]
  );

  // ---- toast countdown (separate from the dock's own ring countdown) ----
  const toastId = toast?.id || null;
  const toastCreatedAt = toast?.createdAt || null;
  const [toastSecondsLeft, setToastSecondsLeft] = useState(
    Math.ceil(toastDurationMs / 1000)
  );
  const [toastBarShrunk, setToastBarShrunk] = useState(false);

  useEffect(() => {
    if (!toastId) return undefined;

    const computeRemaining = () =>
      Math.max(
        0,
        Math.ceil((toastCreatedAt + toastDurationMs - Date.now()) / 1000)
      );

    setToastSecondsLeft(computeRemaining());
    setToastBarShrunk(false);
    // Kick the width transition off on the next frame so the browser
    // registers the starting (100%) width first, or the transition to 0
    // has nothing to animate from.
    const startBar = requestAnimationFrame(() =>
      requestAnimationFrame(() => setToastBarShrunk(true))
    );

    const interval = setInterval(() => {
      setToastSecondsLeft(computeRemaining());
    }, 250);

    return () => {
      cancelAnimationFrame(startBar);
      clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toastId]);

  if (!show || !src) return null;

  const handleOpen = () => {
    // prevent text selection / weird focus
    if (typeof onOpenChat === "function") onOpenChat();
    else {
      // fallback: broadcast an event that ChatBot (or parent) can listen to
      try {
        window.dispatchEvent(new CustomEvent("chatbot-open"));
      } catch {}
    }
  };

  const toastAccent = phaseColor(toast?.phase);
  const toastText = toast ? shortenNudgeText(toast.text) : "";

  const buttonBaseStyle = {
    flex: 1,
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    padding: "6px 8px",
    borderRadius: 8,
    cursor: "pointer",
    border: "1px solid transparent",
  };

  return (
    <>
      {/* Keyframes are injected inline since RobotDock has no CSS module
          of its own (everything else here is inline-styled). Scoped by
          name only, but pf-dock-* is distinctive enough not to collide. */}
      <style>{`
        @keyframes pf-dock-toast-in {
          from { opacity: 0; transform: translateX(-6px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>

      {/* Single fixed-position row holding the dock + toast side by side.
          alignItems: flex-end bottom-aligns them regardless of the
          toast's height (which varies with text length), so the toast's
          bottom edge always sits on the same line as the dock's bottom
          edge — doing this with two independently-positioned fixed divs
          would require measuring the toast's rendered height first. */}
      <div
        style={{
          position: "fixed",
          left,
          right,
          top,
          bottom,
          zIndex,
          // Fixed at exactly the dock's own height so the dock never
          // moves when the toast (a taller, variable-height sibling)
          // shows up next to it — without this, flex would size the row
          // to its tallest child and push the (shorter) dock down to stay
          // bottom-aligned with it. With the row pinned to the dock's
          // height, the dock fills it exactly (unchanged position) while
          // the taller toast still bottom-aligns to the same line and
          // simply overflows upward past the row's top edge.
          height: size,
          display: "flex",
          flexDirection: "row",
          alignItems: "flex-end",
          gap: 14,
          pointerEvents: "none",
        }}
      >
        <div
          role="button"
          tabIndex={0}
          onClick={handleOpen}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              handleOpen();
            }
          }}
          style={{
            position: "relative",
            flex: "0 0 auto",
            width: size,
            height: size,
            borderRadius: 28,
            background: "rgba(255,255,255,0.92)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "auto",

            cursor: "pointer", // ✅ looks clickable
            userSelect: "none",
            WebkitTapHighlightColor: "transparent",
            // Grows from the bottom edge (not the center) so the dock's
            // bottom — the line the toast is bottom-aligned to — never
            // moves while enlarged. Stays enlarged for as long as `bump`
            // is true, which the parent ties directly to the toast being
            // on screen, so this holds for the toast's whole visible
            // lifetime (up to 15s, or less if dismissed early via
            // accept/reject/snooze) instead of a brief one-off animation.
            transformOrigin: "50% 100%",
            transform: bump ? "scale(1.12)" : "scale(1)",
            transition: "transform 220ms ease",
          }}
          title={`Robot (${phase || "neutral"})`}
        >
          {/* Countdown ring overlay */}
          <svg
            width={size}
            height={size}
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
            }}
          >
            <circle
              cx={size / 2}
              cy={size / 2}
              r={radius}
              fill="none"
              stroke={neutralRing}
              strokeWidth={ringWidth}
            />

            {countdownEndsAt && (
              <circle
                cx={size / 2}
                cy={size / 2}
                r={radius}
                fill="none"
                stroke={effectiveRingColor}
                strokeWidth={ringWidth}
                strokeLinecap="round"
                strokeDasharray={circumference}
                strokeDashoffset={dashOffset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              />
            )}
          </svg>

          <div
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              borderRadius: 18 - ringWidth,
              overflow: "hidden",
              background: "transparent",
              pointerEvents: "none", // ✅ click goes to container, not video
            }}
          >
            <video
              key={src}
              src={src}
              autoPlay
              muted
              playsInline
              loop={loop}
              onEnded={onEnded || undefined}
              style={{
                position: "absolute",
                inset: 0,
                width: "100%",
                height: "100%",
                borderRadius: "35px",
                padding: "7px",
                top: "3px",
                objectFit: "cover",
                display: "block",
                transform: "translate(-1px, -1px)",
                pointerEvents: "none", // ✅
              }}
            />
          </div>
        </div>

        {toast && toast.text && (
          <div
            style={{
              flex: "0 0 auto",
              width: 260,
              maxWidth: "calc(100vw - 32px)",
              background: "#ffffff",
              borderRadius: 14,
              boxShadow:
                "0 10px 28px rgba(20, 22, 40, 0.18), 0 1px 2px rgba(20, 22, 40, 0.08)",
              borderLeft: `4px solid ${toastAccent}`,
              overflow: "hidden",
              fontFamily: "inherit",
              pointerEvents: "auto",
              animation: "pf-dock-toast-in 200ms ease",
            }}
          >
            <div style={{ padding: "10px 12px 8px" }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    fontSize: 10,
                    fontWeight: 700,
                    letterSpacing: "0.04em",
                    textTransform: "uppercase",
                    color: toastAccent,
                  }}
                >
                  Nudge
                </span>
                <span
                  style={{ fontSize: 11, fontWeight: 600, color: "#9aa0b1" }}
                >
                  {toastSecondsLeft}s
                </span>
              </div>

              <div
                style={{
                  fontSize: 12.5,
                  lineHeight: 1.35,
                  color: "#20222e",
                  marginBottom: 8,
                  display: "-webkit-box",
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: "vertical",
                  overflow: "hidden",
                }}
                title={toast.text}
              >
                {toastText}
              </div>

              <div style={{ display: "flex", gap: 6 }}>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof onAcceptToast === "function")
                      onAcceptToast(toast);
                  }}
                  style={{
                    ...buttonBaseStyle,
                    background: toastAccent,
                    color: "#ffffff",
                  }}
                >
                  Accept
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof onSnoozeToast === "function")
                      onSnoozeToast(toast);
                  }}
                  style={{
                    ...buttonBaseStyle,
                    background: "#f4f4f8",
                    color: "#565a6b",
                    borderColor: "#e7e7f1",
                  }}
                >
                  Snooze
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (typeof onRejectToast === "function")
                      onRejectToast(toast);
                  }}
                  style={{
                    ...buttonBaseStyle,
                    background: "transparent",
                    color: "#9aa0b1",
                    borderColor: "#e7e7f1",
                  }}
                >
                  Reject
                </button>
              </div>
            </div>

            {/* Countdown bar — width transitions from 100% to 0% over
                toastDurationMs, restarted (via key={toastId}) each time a
                new toast replaces the old one. */}
            <div
              key={toastId}
              style={{
                height: 3,
                background: "#eeeef6",
              }}
            >
              <div
                style={{
                  height: "100%",
                  width: toastBarShrunk ? "0%" : "100%",
                  background: toastAccent,
                  transition: toastBarShrunk
                    ? `width ${toastDurationMs}ms linear`
                    : "none",
                }}
              />
            </div>
          </div>
        )}
      </div>
    </>
  );
}
