import React, { useEffect, useMemo, useState } from "react";
import "../App.css";
import { getIndefiniteArticle } from "../utils/GetIndefiniteArticle";

const INITIAL_VISIBLE = 50;
const PAGE_SIZE = 50;

// Extracted + memoized so that revealing more rows (or an unrelated parent
// re-render) doesn't re-render every row already on screen — only the ones
// that actually changed. With a few hundred entries in the list, this is
// the difference between one row's worth of work and the whole list's.
const HistoryRow = React.memo(function HistoryRow({
  entry,
  onHistoryItemClick,
}) {
  const timeString = entry.timestamp
    ? new Date(entry.timestamp).toLocaleString()
    : "Unknown Time";

  const who = entry.userId || "Unknown User";
  const action = entry.action || entry.verb || "did";
  const article = getIndefiniteArticle(entry.shapeType || "shape");
  const line = `${who} ${action} ${article} ${entry.shapeType || "shape"}`;

  const isClickable = !!(entry.shapeId && onHistoryItemClick);

  return (
    <li
      className={`historyItem ${isClickable ? "historyItem--clickable" : ""}`}
      onClick={() => {
        if (isClickable) onHistoryItemClick(entry.shapeId);
      }}
    >
      <strong>{line}</strong>
      <div className="timestamp">{timeString}</div>

      {entry.text && (
        <div className="historyTextPreview" title={entry.text}>
          “
          {entry.text.length > 160
            ? entry.text.slice(0, 160) + "…"
            : entry.text}
          ”
        </div>
      )}

      {entry.imageUrl && (
        <div className="historyThumbWrap">
          <img
            src={entry.imageUrl}
            alt="Edited image"
            className="historyThumb"
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        </div>
      )}
    </li>
  );
});

export default function HistoryPanel({
  actionHistory = [],
  onHistoryItemClick,
  // Action history only makes sense on the shared/public canvas — a
  // private canvas's edits are personal to that one user, so there's
  // nothing meaningful to list. Default true keeps existing callers that
  // don't pass this working exactly as before.
  isPublicCanvas = true,
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  // Reset the reveal window on an actual team/canvas switch — detected as
  // the list going empty (useCanvasActionHistory clears it to [] when its
  // params change) — but NOT on every new live action, which also changes
  // actionHistory[0] and would otherwise yank an open "show older" state
  // shut while someone's mid-scroll during active editing.
  useEffect(() => {
    if (actionHistory.length === 0) setVisibleCount(INITIAL_VISIBLE);
  }, [actionHistory.length]);

  const visibleEntries = useMemo(
    () => actionHistory.slice(0, visibleCount),
    [actionHistory, visibleCount]
  );

  const hasMore = visibleCount < actionHistory.length;

  if (!isPublicCanvas) {
    return (
      <div
        className="historyPanel"
        style={{ display: "flex", flexDirection: "column", height: "100%" }}
      >
        <h4 className="historyTitle" style={{ flex: "0 0 auto", margin: 0 }}>
          Action History
        </h4>
        <p className="historyEmpty" style={{ padding: "8px 12px" }}>
          Action history isn't available on your private canvas — it only tracks
          the shared canvas, since private edits are just for you.
        </p>
      </div>
    );
  }

  return (
    // display:flex + column here, with the title pinned via flex:0 0 auto
    // and the list area as the only flex:1 (scrolling) child, is what
    // keeps the title from scrolling away with the list — no dependency
    // on App.css having a matching rule, since this is self-contained.
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
        Action History
      </h4>

      <div
        className="historyScrollArea"
        style={{ flex: "1 1 auto", minHeight: 0, overflowY: "auto" }}
      >
        {actionHistory.length === 0 ? (
          <p className="historyEmpty">No actions recorded yet.</p>
        ) : (
          <>
            <ul className="historyList" style={{ margin: 0 }}>
              {visibleEntries.map((entry) => (
                <HistoryRow
                  key={entry.id ?? `${entry.shapeId}-${entry.timestamp}`}
                  entry={entry}
                  onHistoryItemClick={onHistoryItemClick}
                />
              ))}
            </ul>

            {hasMore && (
              <button
                type="button"
                className="historyLoadMore"
                onClick={() =>
                  setVisibleCount((c) =>
                    Math.min(c + PAGE_SIZE, actionHistory.length)
                  )
                }
                style={{
                  display: "block",
                  width: "calc(100% - 16px)",
                  margin: "8px",
                  padding: "6px 10px",
                  cursor: "pointer",
                }}
              >
                Show older activity ({actionHistory.length - visibleCount} more)
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
