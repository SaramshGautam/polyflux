import React from "react";

export function WithNameTag({ base, name, placement = "inside-bottom" }) {
  // placements: "inside-bottom" | "below"
  const tagStyle =
    placement === "below"
      ? {
          position: "absolute",
          left: 0,
          right: 0,
          top: "100%",
          marginTop: 4,
          fontSize: 11,
          opacity: 0.7,
          textAlign: "center",
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }
      : {
          position: "absolute",
          left: 8,
          right: 8,
          bottom: 6,
          fontSize: 11,
          opacity: 0.75,
          pointerEvents: "none",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          padding: "2px 6px",
          borderRadius: 6,
          background: "rgba(255,255,255,0.65)",
          backdropFilter: "blur(2px)",
          textAlign: "left",
        };

  return (
    // BUG FIX (user report): the name tag and the embed frame itself were
    // both mispositioned for map/YouTube embeds. Cause — tldraw's own
    // embed component renders via HTMLContainer, which is
    // position:absolute + inset:0, expecting its immediate parent to
    // already be the shape's real, fully-sized box. This wrapper div
    // used to have no explicit size (just position:relative), so it
    // collapsed to a tiny auto height — the iframe filled that collapsed
    // box instead of the shape's real height, and the "bottom: 6" tag
    // ended up near the bottom of that shrunken box (visually mid-frame)
    // instead of the shape's actual bottom edge. Image/note/text never
    // showed this because their content sizes itself via normal layout,
    // not absolute positioning relative to this wrapper. Explicit 100%
    // width/height makes this div match its real parent (the shape's
    // actual w x h box) again for every shape type, embeds included.
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {base}
      <div style={tagStyle} title={name}>
        {name}
      </div>
    </div>
  );
}
