import React, { useEffect, useMemo, useState } from "react";

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
}) {
  const { left, right, top, bottom } = position;

  const neutralRing = "rgba(0, 0, 0, 0.18)";
  const ringColor =
    phase === "divergent"
      ? "rgba(45, 130, 255, 0.95)"
      : phase === "convergent"
      ? "rgba(255, 153, 0, 0.95)"
      : neutralRing;

  // progress: 1 -> 0 during countdown
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

  // ring is colored only while countdown active
  const countdownActive = Boolean(countdownEndsAt && progress > 0);
  const effectiveRingColor = countdownActive ? ringColor : neutralRing;

  // SVG ring math (hooks must be unconditional)
  const radius = useMemo(() => size / 2 - ringWidth / 2, [size, ringWidth]);
  const circumference = useMemo(() => 2 * Math.PI * radius, [radius]);
  const dashOffset = useMemo(
    () => circumference * (1 - progress),
    [circumference, progress]
  );

  // ✅ Early return AFTER all hooks
  if (!show || !src) return null;

  return (
    <div
      style={{
        position: "fixed",
        left,
        right,
        top,
        bottom,
        width: size,
        height: size,
        zIndex,
        borderRadius: 18,
        background: "rgba(255,255,255,0.92)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto",
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
        {/* base ring */}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={neutralRing}
          strokeWidth={ringWidth}
        />

        {/* colored arc that shrinks clockwise */}
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

      {/* inner “screen” clips the video */}
      <div
        style={{
          position: "relative",
          width: "100%",
          height: "100%",
          borderRadius: 18 - ringWidth,
          overflow: "hidden",
          background: "transparent",
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
            padding: "5px",
            objectFit: "cover",
            display: "block",
            transform: "translate(-1px, -1px)",
          }}
        />
      </div>
    </div>
  );
}
