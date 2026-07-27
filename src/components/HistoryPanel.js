import React, { useEffect, useMemo, useState } from "react";
import "../App.css";
import { getIndefiniteArticle } from "../utils/GetIndefiniteArticle";

const INITIAL_VISIBLE = 50;
const PAGE_SIZE = 50;

// Same sprite tldraw's own icons load from — already used elsewhere in
// this app (see .toggle-collapse-button in App.css) as the established
// way to render a real tlui icon *outside* <Tldraw>'s own component tree.
// <TldrawUiIcon> itself can't be used here: it reads an AssetUrlsProvider
// context that only exists inside <Tldraw>, and HistoryPanel is rendered
// as a plain sibling (see CollaborativeWhiteboard), not inside the editor.
//
// Pinned to the version actually installed (node_modules/tldraw is
// 3.13.1), not the older 3.10.1 the other hardcoded icon refs in App.css
// use, so every name in tldraw's icon-types list is guaranteed present.
const TLDRAW_ICON_SPRITE =
  "https://cdn.tldraw.com/3.13.1/icons/icon/0_merged.svg";

// One icon + accent color per action category, so "what kind of thing
// happened" reads at a glance before you even read the sentence.
//
// The comment category previously pointed at "speech", which isn't a
// real tlui icon name (hence it rendered as nothing) — "comment" is the
// actual speech-bubble icon in tldraw's set.
const CATEGORY_META = {
  delete: { icon: "trash", label: "Deleted" },
  comment: { icon: "comment", label: "Comment" },
  reaction: { icon: "geo-heart", label: "Reaction" },
  publish: { icon: "share-1", label: "Brought over across the portal" },
  note: { icon: "tool-note", label: "Note" },
  image: { icon: "tool-media", label: "Image" },
  text: { icon: "tool-text", label: "Text" },
  shape: { icon: "edit", label: "Shape" },
};

// Canvas-switch events used to be logged to history (see
// CollaborativeWhiteboard's handlePortalToggle); that was removed since
// switching which canvas you're looking at isn't a meaningful history
// event on its own. Existing rooms may still have those docs sitting in
// Firestore though, so they're filtered out here rather than needing a
// one-off data migration to delete them.
function isHiddenHistoryEntry(entry) {
  const verb = (entry.action || entry.verb || "").toLowerCase();
  return verb.includes("switched to");
}

// Categorize by verb first (delete/comment/reaction/publish can happen to
// *any* shape type, and should read as that action, not as whatever shape
// they happened to land on), then fall back to shapeType for plain
// add/update.
function getActionCategory(entry) {
  const verb = (entry.action || entry.verb || "").toLowerCase();
  const shapeType = entry.shapeType;

  if (verb === "deleted") return "delete";
  if (verb.includes("comment")) return "comment";
  if (verb.includes("reacted")) return "reaction";
  if (verb.includes("brought over")) return "publish";
  if (shapeType === "note") return "note";
  if (shapeType === "image") return "image";
  if (shapeType === "text") return "text";
  return "shape";
}

// Renders a tlui icon glyph as a CSS mask (tinted via currentColor) rather
// than an <img>, so each category badge can color it to match.
function ActionIcon({ name }) {
  const maskImage = `url("${TLDRAW_ICON_SPRITE}#${name}") center / 65% no-repeat`;
  return (
    <span
      aria-hidden="true"
      style={{
        display: "block",
        width: "100%",
        height: "100%",
        backgroundColor: "currentColor",
        WebkitMask: maskImage,
        mask: maskImage,
      }}
    />
  );
}

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

  const category = getActionCategory(entry);
  const { icon, label } = CATEGORY_META[category] || CATEGORY_META.shape;

  // Notes get a sticky-note-styled preview instead of the plain quoted
  // text box — but only when the note itself is what was added/updated.
  // A *comment* left on a note (category "comment") still shows its text
  // in the regular quote style, since that text is the comment, not the
  // note's own content.
  const isNotePreview = category === "note";

  return (
    <li
      className={`historyItem ${isClickable ? "historyItem--clickable" : ""}`}
      onClick={() => {
        if (isClickable) onHistoryItemClick(entry.shapeId);
      }}
    >
      <div className="historyItemRow">
        <span
          className={`historyIconBadge historyIconBadge--${category}`}
          title={label}
        >
          <ActionIcon name={icon} />
        </span>

        <div className="historyItemContent">
          <strong>{line}</strong>
          <div className="timestamp">{timeString}</div>

          {entry.text && isNotePreview && (
            <div className="historyNotePreview" title={entry.text}>
              {entry.text.length > 140
                ? entry.text.slice(0, 140) + "…"
                : entry.text}
            </div>
          )}

          {entry.text && !isNotePreview && (
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
        </div>
      </div>
    </li>
  );
});

export default function HistoryPanel({
  actionHistory = [],
  onHistoryItemClick,
  // Which canvas is currently active. The underlying "actions" collection
  // is one shared collection per team (not split per canvas), so this is
  // what filters the feed down to just the entries that happened on
  // whichever canvas is on screen right now. Defaults true so this keeps
  // working exactly as before for any caller that hasn't been updated to
  // pass it yet.
  isPublicCanvas = true,
  // Needed to further narrow private-canvas history to just this user's
  // own entries — private canvases are personal to whoever owns them, but
  // the "actions" collection has no per-owner scoping of its own.
  currentUserUid = null,
}) {
  const [visibleCount, setVisibleCount] = useState(INITIAL_VISIBLE);

  // Reset the reveal window on an actual team/canvas switch — detected as
  // the list going empty (useCanvasActionHistory clears it to [] when its
  // params change) — but NOT on every new live action, which also changes
  // actionHistory[0] and would otherwise yank an open "show older" state
  // shut while someone's mid-scroll during active editing. Checked against
  // the raw actionHistory (not the filtered one below), since that's what
  // actually goes empty on a real params change.
  useEffect(() => {
    if (actionHistory.length === 0) setVisibleCount(INITIAL_VISIBLE);
  }, [actionHistory.length]);

  // Also reset the reveal window on a canvas-mode flip, so switching
  // between public/private doesn't leave "show older" expanded past
  // however many entries the OTHER canvas happened to have.
  useEffect(() => {
    setVisibleCount(INITIAL_VISIBLE);
  }, [isPublicCanvas]);

  const expectedSpace = isPublicCanvas ? "public" : "private";

  const displayableHistory = useMemo(
    () =>
      actionHistory.filter((entry) => {
        if (isHiddenHistoryEntry(entry)) return false;
        if (entry.space !== expectedSpace) return false;
        // Private history is further scoped to this user's own actions —
        // otherwise every team member's private edits would show up in
        // each other's private canvas history.
        if (expectedSpace === "private" && entry.actorUid !== currentUserUid) {
          return false;
        }
        return true;
      }),
    [actionHistory, expectedSpace, currentUserUid]
  );

  const visibleEntries = useMemo(
    () => displayableHistory.slice(0, visibleCount),
    [displayableHistory, visibleCount]
  );

  const hasMore = visibleCount < displayableHistory.length;

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
        {displayableHistory.length === 0 ? (
          <p className="historyEmpty">
            {isPublicCanvas
              ? "No actions recorded yet."
              : "No actions recorded yet on your private canvas."}
          </p>
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
                    Math.min(c + PAGE_SIZE, displayableHistory.length)
                  )
                }
              >
                <span className="historyLoadMoreIcon" aria-hidden="true">
                  <ActionIcon name="chevron-down" />
                </span>
                <span>Show older activity</span>
                <span className="historyLoadMoreCount">
                  {displayableHistory.length - visibleCount}
                </span>
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}
