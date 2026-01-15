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
    <div style={{ position: "relative" }}>
      {base}
      <div style={tagStyle} title={name}>
        {name}
      </div>
    </div>
  );
}
