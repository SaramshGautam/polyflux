import React, { useMemo } from "react";
import "../App.css";

// Best-effort label for a shape so a comment reads "commented on <label>"
// instead of just a bare shape type. Firestore shape docs mirror a few
// different possible text locations depending on how/when they were
// written (flat `text`, or the original tldraw `props.text` /
// `props.richText`), so this checks them in the same fallback order the
// rest of the app already uses (see CustomContextMenu.jsx's cluster
// payload builder).
function getShapeLabel(shape) {
  const text =
    shape?.text ||
    shape?.props?.text ||
    shape?.props?.richText?.content?.[0]?.content?.[0]?.text ||
    "";
  if (text) return text.length > 60 ? text.slice(0, 60) + "…" : text;
  return shape?.shapeType || shape?.type || "shape";
}

function commentTime(c) {
  const raw = c.Timestamp || c.timestamp;
  if (!raw) return 0;
  const t = new Date(raw).getTime();
  return Number.isNaN(t) ? 0 : t;
}

const CommentPanel = ({
  shapes = [],
  // Called with a shapeId when a comment is clicked — the parent is
  // expected to both pan the canvas to that shape AND open its comment
  // box (see handleCommentItemClick in CollaborativeWhiteboard.jsx).
  onCommentItemClick,
}) => {
  // Flatten every shape's `comments` array into one list, each entry
  // tagged with which shape it belongs to, then sort newest-first across
  // the whole board — this is what makes it "comments for specific items
  // on the screen" rather than only whatever's currently selected.
  const allComments = useMemo(() => {
    const flat = [];

    (shapes || []).forEach((shape) => {
      const shapeComments = Array.isArray(shape?.comments)
        ? shape.comments
        : [];
      if (!shapeComments.length) return;

      const shapeId = shape.id || shape.shapeId;
      const shapeLabel = getShapeLabel(shape);

      shapeComments.forEach((c, idx) => {
        flat.push({
          ...c,
          _key: `${shapeId}:${idx}:${c.Timestamp || c.timestamp || idx}`,
          _shapeId: shapeId,
          _shapeLabel: shapeLabel,
        });
      });
    });

    flat.sort((a, b) => commentTime(b) - commentTime(a));
    return flat;
  }, [shapes]);

  return (
    // Same self-contained sticky-title layout as HistoryPanel — title
    // stays put as a flex sibling outside the scrolling list, rather than
    // depending on a matching rule existing in App.css.
    <div
      className="historyPanel"
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: 0,
      }}
    >
      <h4 className="historyTitle" style={{ flex: "0 0 auto", margin: 0 }}>
        Comments
      </h4>

      <div
        className="historyScrollArea"
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
      >
        {allComments.length === 0 ? (
          <p className="historyEmpty">No comments yet.</p>
        ) : (
          <ul className="historyList" style={{ margin: 0 }}>
            {allComments.map((c) => {
              const isClickable = !!(c._shapeId && onCommentItemClick);
              return (
                <li
                  key={c._key}
                  className={`historyItem ${
                    isClickable ? "historyItem--clickable" : ""
                  }`}
                  onClick={() => {
                    if (isClickable) onCommentItemClick(c._shapeId);
                  }}
                >
                  <strong>{c.userId || "Unknown User"}</strong>{" "}
                  <span style={{ color: "#888" }}>on {c._shapeLabel}</span>
                  <div className="historyTextPreview" title={c.text}>
                    “{c.text}”
                  </div>
                  <div className="timestamp">
                    {c.Timestamp ||
                      (c.timestamp
                        ? new Date(c.timestamp).toLocaleString()
                        : "Unknown time")}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
};

export default CommentPanel;
