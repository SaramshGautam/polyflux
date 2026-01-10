import React, { useEffect, useMemo, useRef, useState } from "react";
import { useEditor, useValue } from "tldraw";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faRobot } from "@fortawesome/free-solid-svg-icons";

/**
 * NOTE:
 * - Outer clickable badge is now a <div role="button"> to avoid nesting <button> inside <button>.
 * - Close (×) dismisses the badge for the current shapeIds "signature".
 * - When shapeIds changes, dismissal resets automatically.
 */

function TypingDots() {
  return (
    <span style={{ display: "inline-flex", gap: 4, alignItems: "center" }}>
      <span style={dotStyle} />
      <span style={{ ...dotStyle, animationDelay: "120ms" }} />
      <span style={{ ...dotStyle, animationDelay: "240ms" }} />
    </span>
  );
}

const dotStyle = {
  width: 6,
  height: 6,
  borderRadius: 999,
  background: "rgba(0,0,0,.45)",
  display: "inline-block",
  animation: "typingDot 900ms infinite ease-in-out",
};

function PhaseNudgeBadges({ shapeIds, onClickShape, previewText }) {
  const editor = useEditor();
  const camera = useValue("camera", () => editor?.getCamera?.() ?? null, [
    editor,
  ]);

  const [badge, setBadge] = useState(null);
  const [highlight, setHighlight] = useState(false);

  // tooltip state
  const [isHovering, setIsHovering] = useState(false);
  const [typing, setTyping] = useState(false);

  // ✅ dismissal
  const [dismissedKey, setDismissedKey] = useState(null);

  // Create a stable signature for "this current badge"
  const shapeKey = useMemo(() => {
    if (!Array.isArray(shapeIds) || shapeIds.length === 0) return null;
    // order-independent, stable key
    return [...shapeIds].sort().join("|");
  }, [shapeIds]);

  // When hover starts, show typing briefly
  useEffect(() => {
    if (!isHovering) return;
    setTyping(true);
    const t = setTimeout(() => setTyping(false), 550);
    return () => clearTimeout(t);
  }, [isHovering]);

  // Reset dismissal when the shapeIds set changes
  useEffect(() => {
    setDismissedKey(null);
  }, [shapeKey]);

  useEffect(() => {
    if (!editor || !Array.isArray(shapeIds) || shapeIds.length === 0) {
      setBadge(null);
      return;
    }

    // If dismissed for this set of shapes, don't show
    if (shapeKey && dismissedKey === shapeKey) {
      setBadge(null);
      return;
    }

    const boundsList = [];
    shapeIds.forEach((id) => {
      const bounds =
        editor.getShapePageBounds?.(id) ?? editor.getPageBounds?.(id) ?? null;
      if (!bounds) return;
      boundsList.push({ id, bounds });
    });

    if (!boundsList.length) {
      setBadge(null);
      return;
    }

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;

    for (const { bounds } of boundsList) {
      if (bounds.minX < minX) minX = bounds.minX;
      if (bounds.minY < minY) minY = bounds.minY;
      if (bounds.maxX > maxX) maxX = bounds.maxX;
      if (bounds.maxY > maxY) maxY = bounds.maxY;
    }

    if (
      !isFinite(minX) ||
      !isFinite(minY) ||
      !isFinite(maxX) ||
      !isFinite(maxY)
    ) {
      setBadge(null);
      return;
    }

    // ✅ TOP-LEFT placement (slightly outside the cluster box)
    const cornerPagePoint = {
      x: minX - 10,
      y: minY - 10,
    };

    // closest shape id to anchor click behavior
    let closestShapeId = boundsList[0].id;
    let bestDist2 = Infinity;

    for (const { id, bounds } of boundsList) {
      const cx = (bounds.minX + bounds.maxX) / 2;
      const cy = (bounds.minY + bounds.maxY) / 2;
      const dx = cx - cornerPagePoint.x;
      const dy = cy - cornerPagePoint.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestDist2) {
        bestDist2 = d2;
        closestShapeId = id;
      }
    }

    const screenPoint =
      editor.pageToScreen?.(cornerPagePoint) ?? cornerPagePoint;

    setBadge({
      shapeId: closestShapeId,
      left: screenPoint.x,
      top: screenPoint.y,
    });

    setHighlight(true);
    const t = setTimeout(() => setHighlight(false), 2500);
    return () => clearTimeout(t);
  }, [editor, shapeIds, camera, shapeKey, dismissedKey]);

  if (!badge) return null;

  const text =
    (previewText || "").trim() ||
    "I noticed a pattern in your recent activity. Want a quick suggestion?";

  return (
    <div
      style={{
        position: "fixed",
        left: badge.left,
        top: badge.top,
        zIndex: 10050,
        pointerEvents: "none",
      }}
    >
      {/* ✅ OUTER IS NOT A <button> ANYMORE (avoids nested button warning) */}
      <div
        role="button"
        tabIndex={0}
        className={
          "tlui-button tlui-button--icon phase-nudge-badge" +
          (highlight ? " phase-nudge-badge--bounce" : "")
        }
        style={{
          pointerEvents: "auto",
          width: 32,
          height: 32,
          borderRadius: 999,
          background: "white",
          boxShadow: "0 6px 16px rgba(0,0,0,.20)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          position: "relative",
          cursor: "pointer",
          userSelect: "none",
        }}
        title="AI nudge"
        onClick={(e) => {
          e.stopPropagation();
          onClickShape?.(badge.shapeId);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onClickShape?.(badge.shapeId);
          }
        }}
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
      >
        <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} />

        {/* Tooltip */}
        {isHovering && (
          <div
            style={{
              position: "absolute",
              left: 40,
              top: -8,
              width: 260,
              pointerEvents: "auto",
            }}
            onMouseEnter={() => setIsHovering(true)}
            onMouseLeave={() => setIsHovering(false)}
            onClick={(e) => e.stopPropagation()} // ✅ prevent clicking tooltip from triggering badge click
          >
            <div
              style={{
                background: "white",
                borderRadius: 14,
                boxShadow: "0 10px 28px rgba(0,0,0,.22)",
                border: "1px solid rgba(0,0,0,.08)",
                padding: "10px 12px",
                textAlign: "left",
                position: "relative", // ✅ for the close button
              }}
            >
              {/* ✅ Close (dismiss) */}
              <button
                type="button"
                className="tlui-button tlui-button--icon"
                title="Dismiss nudge"
                style={{
                  position: "absolute",
                  top: 6,
                  right: 6,
                  width: 26,
                  height: 26,
                  borderRadius: 999,
                  background: "rgba(0,0,0,.06)",
                  border: "1px solid rgba(0,0,0,.10)",
                  display: "grid",
                  placeItems: "center",
                  cursor: "pointer",
                  lineHeight: 1,
                }}
                onClick={(e) => {
                  e.stopPropagation();
                  if (shapeKey) setDismissedKey(shapeKey); // ✅ hide until shapeIds changes
                  setIsHovering(false);
                }}
              >
                ×
              </button>

              {/* little “tail” */}
              <div
                style={{
                  position: "absolute",
                  left: -6,
                  top: 14,
                  width: 12,
                  height: 12,
                  background: "white",
                  transform: "rotate(45deg)",
                  borderLeft: "1px solid rgba(0,0,0,.08)",
                  borderBottom: "1px solid rgba(0,0,0,.08)",
                }}
              />

              <div
                style={{ display: "flex", gap: 10, alignItems: "flex-start" }}
              >
                {/* tiny bot avatar */}
                <div
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: "rgba(0,0,0,.06)",
                    display: "grid",
                    placeItems: "center",
                    flex: "0 0 auto",
                    marginTop: 2,
                  }}
                >
                  <FontAwesomeIcon icon={faRobot} style={{ fontSize: 12 }} />
                </div>

                <div style={{ flex: 1, minWidth: 0, textAlign: "left" }}>
                  <div
                    style={{
                      fontSize: 13,
                      lineHeight: 1.35,
                      whiteSpace: "normal",
                      wordBreak: "break-word",
                      textAlign: "left",
                      paddingRight: 28, // ✅ room for the close button
                    }}
                  >
                    {typing ? <TypingDots /> : text}
                  </div>

                  <div
                    style={{
                      display: "flex",
                      justifyContent: "flex-end",
                      marginTop: 10,
                      gap: 8,
                    }}
                  >
                    <button
                      type="button"
                      className="tlui-button"
                      style={{
                        height: 28,
                        padding: "0 10px",
                        borderRadius: 10,
                        background: "rgba(0,0,0,.06)",
                        border: "1px solid rgba(0,0,0,.08)",
                      }}
                      onClick={(e) => {
                        e.stopPropagation();
                        onClickShape?.(badge.shapeId);
                      }}
                      title="Open the nudge in chat"
                    >
                      Open Nudge
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export default PhaseNudgeBadges;
