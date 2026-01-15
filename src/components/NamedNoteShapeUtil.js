import React from "react";
import { NoteShapeUtil } from "tldraw";

function NoteWithName({ base, name }) {
  return (
    <div style={{ position: "relative" }}>
      {base}
      <div
        style={{
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
        }}
        title={name}
      >
        {name}
      </div>
    </div>
  );
}

// ✅ factory that closes over your Firestore/presence getter
export function createNamedNoteShapeUtil({ getActorLabelForShape }) {
  return class NamedNoteShapeUtil extends NoteShapeUtil {
    static type = "note";

    component(shape) {
      const base = super.component(shape);

      // prefer Firestore/presence label, fallback to stamped meta
      const name =
        getActorLabelForShape?.(shape.id) ||
        shape?.meta?.createdByName ||
        shape?.meta?.createdBy ||
        "Unknown";

      return <NoteWithName base={base} name={name} />;
    }
  };
}
