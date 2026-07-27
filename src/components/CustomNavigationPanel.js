import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useEditor, useValue } from "tldraw";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faAngleDoubleUp,
  faAngleDoubleDown,
} from "@fortawesome/free-solid-svg-icons";

const MINIMAP_W = 400;
const MINIMAP_H = 240;

// ---- minimap helpers (keep your existing ones) ----
function unionBounds(editor, shapeIds) {
  let bounds = null;
  for (const id of shapeIds) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;
    bounds = bounds ? bounds.union(b) : b.clone();
  }
  return bounds;
}

function makePalette() {
  return [
    "#93c5fd", // pastel blue
    "#fdba74", // pastel orange
    "#86efac", // pastel green
    "#d8b4fe", // pastel purple
    "#fca5a5", // pastel red
    "#7dd3fc", // pastel cyan
  ];
}

function buildActorColorMap(actorOptions) {
  const palette = makePalette();
  const map = new Map();

  actorOptions.forEach((a, i) => {
    // const actorKey = a.label || a.id;
    // map.set(actorKey, palette[i % palette.length]);
    const actorKey = a._actorKey || getActorKey(a);
    map.set(actorKey, palette[i % palette.length]);
  });

  return map;
}

function drawMinimap({
  editor,
  canvas,
  allShapeIds, // ✅ new: used for bounds/scale
  drawShapeIds, // ✅ new: actually drawn
  shapeActorIdByShapeId,
  actorColorByActorId,
  selectedActorSet,
  hasSelection, // ✅ explicit: distinguishes "all" (false) from "none"/"custom" (true, set may be empty)
}) {
  if (!canvas) return null;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;

  const W = canvas.width;
  const H = canvas.height;
  ctx.clearRect(0, 0, W, H);

  ctx.fillStyle = "#f7f7f8";
  ctx.fillRect(0, 0, W, H);

  ctx.strokeStyle = "rgba(0,0,0,0.08)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);

  if (!allShapeIds?.length) return null;

  // ✅ IMPORTANT: bounds from ALL shapes (stable)
  const contentBounds = unionBounds(editor, allShapeIds);
  if (!contentBounds) return null;

  const pad = 200;
  const worldX = contentBounds.x - pad;
  const worldY = contentBounds.y - pad;
  const worldW = contentBounds.w + pad * 2;
  const worldH = contentBounds.h + pad * 2;

  const sx = W / worldW;
  const sy = H / worldH;
  const s = Math.min(sx, sy);

  const drawW = worldW * s;
  const drawH = worldH * s;
  const ox = (W - drawW) / 2;
  const oy = (H - drawH) / 2;

  ctx.lineWidth = 1.75;

  // ✅ draw only the filtered subset
  for (const id of drawShapeIds || []) {
    const b = editor.getShapePageBounds(id);
    if (!b) continue;

    const x = ox + (b.x - worldX) * s;
    const y = oy + (b.y - worldY) * s;
    const w = Math.max(2, b.w * s);
    const h = Math.max(2, b.h * s);

    const actorId = shapeActorIdByShapeId?.[id] || null;
    const isSelected =
      actorId && hasSelection && selectedActorSet?.has(actorId);

    // const color = actorId ? actorColorByActorId.get(actorId) : null;
    const baseColor = actorId ? actorColorByActorId.get(actorId) : null;

    // const mutedStroke = "rgba(0,0,0,0.35)";
    // const mutedFill = "rgba(0,0,0,0.06)";

    const mutedStroke = baseColor
      ? `${baseColor}26`
      : "rgba(141, 135, 135, 0.15)";
    const mutedFill = baseColor ? `${baseColor}0` : "rgba(146, 142, 142, 0.06)";

    const stroke = hasSelection
      ? isSelected
        ? baseColor || "rgba(175, 169, 169, 0.15)"
        : mutedStroke
      : baseColor || "rgba(134, 131, 131, 0.05)";

    // ctx.strokeStyle = color || "rgba(0,0,0,0.35)";
    ctx.strokeStyle = stroke;
    // if (color) {
    //   ctx.fillStyle = `${color}14`;
    //   ctx.fillRect(x, y, w, h);
    // }
    if (hasSelection) {
      if (isSelected && baseColor) {
        ctx.fillStyle = `${baseColor}18`; // highlight
        ctx.fillRect(x, y, w, h);
      } else {
        ctx.fillStyle = mutedFill; // keep visible but muted
        ctx.fillRect(x, y, w, h);
      }
    } else {
      // no selection: keep your current behavior
      if (baseColor) {
        ctx.fillStyle = `${baseColor}14`;
        ctx.fillRect(x, y, w, h);
      }
    }
    ctx.strokeRect(x, y, w, h);
  }

  // viewport box still works
  const vp = editor.getViewportPageBounds?.();
  if (vp) {
    ctx.strokeStyle = "rgba(0, 140, 255, 0.9)";
    ctx.lineWidth = 1.5;
    const x = ox + (vp.x - worldX) * s;
    const y = oy + (vp.y - worldY) * s;
    ctx.strokeRect(x, y, vp.w * s, vp.h * s);
  }

  return { worldX, worldY, s, ox, oy, W, H };
}

function ActorFilteredMinimap({
  selectedActorIds,
  allActive,
  shapeActorIdByShapeId,
  actorOptions,
}) {
  const editor = useEditor();
  const canvasRef = useRef(null);

  // holds last draw transform for mapping clicks
  const transformRef = useRef(null);

  const shapes = useValue("shapes", () => editor.getCurrentPageShapes(), [
    editor,
  ]);

  const selectedSet = useMemo(
    () => new Set(selectedActorIds || []),
    [selectedActorIds]
  );

  const drawShapeIds = useMemo(() => shapes.map((s) => s.id), [shapes]);

  // const filteredShapeIds = useMemo(() => {
  //   if (!selectedActorIds || selectedActorIds.length === 0) {
  //     return shapes.map((s) => s.id);
  //   }

  //   return shapes
  //     .map((s) => s.id)
  //     .filter((id) => {
  //       const actorId = shapeActorIdByShapeId?.[id];
  //       return actorId && selectedSet.has(actorId);
  //     });
  // }, [shapes, selectedActorIds, selectedSet, shapeActorIdByShapeId]);

  const actorColorByActorId = useMemo(
    () => buildActorColorMap(actorOptions || []),
    [actorOptions]
  );

  const allShapeIds = useMemo(() => shapes.map((s) => s.id), [shapes]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    // canvas.width = 367;
    // canvas.height = 176;
    canvas.width = MINIMAP_W;
    canvas.height = MINIMAP_H;

    const t = drawMinimap({
      editor,
      canvas,
      allShapeIds, // ✅ stable framing
      // drawShapeIds: filteredShapeIds, // ✅ filtered drawing
      drawShapeIds,
      shapeActorIdByShapeId,
      actorColorByActorId,
      selectedActorSet: selectedSet,
      hasSelection: !allActive,
    });

    transformRef.current = t;
  }, [
    editor,
    allShapeIds,
    drawShapeIds,
    shapeActorIdByShapeId,
    actorColorByActorId,
    selectedSet,
    allActive,
  ]);

  const handlePointerDown = (e) => {
    e.stopPropagation();

    const canvas = canvasRef.current;
    const t = transformRef.current;
    if (!canvas || !t) return;

    const rect = canvas.getBoundingClientRect();

    // convert CSS pixels -> canvas pixels
    const cx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const cy = (e.clientY - rect.top) * (canvas.height / rect.height);

    // canvas -> page coords using inverse transform
    const pageX = t.worldX + (cx - t.ox) / t.s;
    const pageY = t.worldY + (cy - t.oy) / t.s;

    // ✅ center camera on that page point
    // Use viewport bounds to compute current center and shift camera by delta.
    const vp = editor.getViewportPageBounds?.();
    const cam = editor.getCamera?.();
    if (!vp || !cam) return;

    const currentCenter = {
      x: vp.x + vp.w / 2,
      y: vp.y + vp.h / 2,
    };

    const dx = pageX - currentCenter.x;
    const dy = pageY - currentCenter.y;

    // This sign works for tldraw's camera in most setups:
    editor.setCamera({ x: cam.x - dx, y: cam.y - dy, z: cam.z });
  };

  return (
    <div
      className="tlui-minimap"
      style={{ height: MINIMAP_H, width: MINIMAP_W, padding: 0 }}
    >
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Minimap"
        className="tlui-minimap__canvas"
        // style={{ width: "100%", height: 176, cursor: "pointer" }}
        style={{
          width: MINIMAP_W,
          height: MINIMAP_H,
          cursor: "pointer",
          display: "block",
          padding: 2,
        }}
        onPointerDown={handlePointerDown}
      />
    </div>
  );
}

function normalizeActorKey(k) {
  return (k ?? "").toString().trim(); // optionally: .toLowerCase()
}

// Choose ONE identity rule and use it everywhere.
// If you have a stable UID (recommended), prefer it.
function getActorKey(a) {
  // Best: stable auth UID / participantId if you have it:
  // return normalizeActorKey(a.uid || a.participantId || a.id || a.label);

  // Your current behavior (label OR id), but normalized:
  return normalizeActorKey(a.label || a.id);
}

function dedupeActors(actorOptions) {
  const seen = new Set();
  const out = [];

  for (const a of actorOptions || []) {
    const key = getActorKey(a);
    if (!key) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ...a, _actorKey: key }); // cache key for reuse
  }

  return out;
}

// A short code/participant id like "P99", "P123", or a plain number ("42")
// — optionally one leading letter, then digits. These should be shown in
// full rather than reduced to a single initial.
const ID_LIKE_RE = /^[A-Za-z]?\d+[A-Za-z0-9]*$/;

// Turn a display name, email, or short id into label text for the chip, e.g.
// "jane.doe@example.com" -> "JD", "Alice" -> "AL", "P99" -> "P99"
function getActorInitials(a) {
  const raw = (a?.label || a?.id || "").toString().trim();
  if (!raw) return "?";

  const namePart = raw.includes("@") ? raw.split("@")[0] : raw;

  if (ID_LIKE_RE.test(namePart)) {
    return namePart.slice(0, 4).toUpperCase();
  }

  const cleaned = namePart.replace(/[._\-+0-9]+/g, " ").trim();
  const parts = cleaned.split(/\s+/).filter(Boolean);

  if (parts.length === 0) return namePart.slice(0, 2).toUpperCase();
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

const ACTOR_BUTTON_SIZE = 34;
const ACTOR_BUTTON_RADIUS = 10;
const ACTOR_BUTTON_GAP = 6;
const ALL_BUTTON_COLOR = "#111827";
const MAX_VISIBLE_ACTORS = 3;
const OVERFLOW_CLOSE_DELAY = 150;

const MIN_ZOOM = 0.05; // 5%
const MAX_ZOOM = 4; // 400%
const ZOOM_EPSILON = 0.0005;

/**
 * CustomNavigationPanel
 * - Collapsed: ONLY chevron + zoom controls
 * - Expanded: participant buttons moved into the TOP ROW, aligned right (34x34 each)
 */
export function CustomNavigationPanel({
  actorOptions = [],
  shapeActorIdByShapeId = {},
  maxActors = 6,
}) {
  const editor = useEditor();

  // reactive zoom level so the "100%" button can show the current scale
  const zoom = useValue("camera-zoom", () => editor.getCamera().z, [editor]);
  const zoomPct = Math.round((zoom || 1) * 100);

  const atMinZoom = zoom <= MIN_ZOOM + ZOOM_EPSILON;
  const atMaxZoom = zoom >= MAX_ZOOM - ZOOM_EPSILON;

  const handleZoomOut = () => {
    if (atMinZoom) return;
    editor.zoomOut();
    const cam = editor.getCamera();
    if (cam.z < MIN_ZOOM) editor.setCamera({ ...cam, z: MIN_ZOOM });
  };

  const handleZoomIn = () => {
    if (atMaxZoom) return;
    editor.zoomIn();
    const cam = editor.getCamera();
    if (cam.z > MAX_ZOOM) editor.setCamera({ ...cam, z: MAX_ZOOM });
  };

  // const actors = useMemo(
  //   () => actorOptions.slice(0, maxActors),
  //   [actorOptions, maxActors]
  // );
  const actors = useMemo(() => {
    const unique = dedupeActors(actorOptions);
    return unique.slice(0, maxActors);
  }, [actorOptions, maxActors]);

  const [selectedActorIds, setSelectedActorIds] = useState([]);
  // true = "All" highlighted (every actor shown/highlighted, no filtering)
  // false + empty selectedActorIds = "None" (explicitly toggled off, nothing highlighted)
  // false + non-empty selectedActorIds = custom subset selected
  const [allActive, setAllActive] = useState(true);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const toggleActor = (actorId) => {
    setAllActive(false);
    setSelectedActorIds((prev) => {
      const set = new Set(prev);
      if (set.has(actorId)) set.delete(actorId);
      else set.add(actorId);
      return Array.from(set);
    });
  };

  // "All" is a real toggle: if it's already highlighted (showing everyone),
  // pressing it again flips to "none" (nothing highlighted); pressing it
  // again from "none" flips back to "all".
  const toggleAll = () => {
    setAllActive((prev) => !prev);
    setSelectedActorIds([]);
  };

  // when collapsing, reset to the default "all" state
  useEffect(() => {
    if (isCollapsed) {
      setSelectedActorIds([]);
      setAllActive(true);
      setOverflowOpen(false);
    }
  }, [isCollapsed]);

  // const colorMap = buildActorColorMap(actors);
  const colorMap = useMemo(() => buildActorColorMap(actors), [actors]);

  // Show at most MAX_VISIBLE_ACTORS inline; the rest live behind a "+N" pill
  // that reveals a hover overlay so the top row never overflows.
  const visibleActors = useMemo(
    () => actors.slice(0, MAX_VISIBLE_ACTORS),
    [actors]
  );
  const overflowActors = useMemo(
    () => actors.slice(MAX_VISIBLE_ACTORS),
    [actors]
  );

  const [overflowOpen, setOverflowOpen] = useState(false);
  const [overlayPos, setOverlayPos] = useState(null);
  const overflowBtnRef = useRef(null);
  const closeTimeoutRef = useRef(null);

  const clearCloseTimeout = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
  };

  const openOverflow = () => {
    clearCloseTimeout();
    const el = overflowBtnRef.current;
    if (el) {
      const rect = el.getBoundingClientRect();
      setOverlayPos({ top: rect.bottom + 8, left: rect.left + rect.width / 2 });
    }
    setOverflowOpen(true);
  };

  const scheduleCloseOverflow = () => {
    clearCloseTimeout();
    closeTimeoutRef.current = setTimeout(
      () => setOverflowOpen(false),
      OVERFLOW_CLOSE_DELAY
    );
  };

  useEffect(() => clearCloseTimeout, []);

  const renderActorButton = (a, size = ACTOR_BUTTON_SIZE) => {
    const actorKey = a._actorKey || getActorKey(a);
    // When "All" is active, every actor reads as included.
    const active = allActive || selectedActorIds.includes(actorKey);
    const color = colorMap.get(actorKey) || ALL_BUTTON_COLOR;
    const initials = getActorInitials(a);
    const fontSize = Math.max(9, Math.round(size * 0.34));

    return (
      <button
        key={actorKey}
        type="button"
        onClick={() => toggleActor(actorKey)}
        className="tlui-button"
        title={actorKey}
        aria-pressed={active}
        style={{
          width: size,
          height: size,
          flex: "0 0 auto",
          borderRadius: ACTOR_BUTTON_RADIUS,
          fontWeight: 800,
          fontSize,
          letterSpacing: 0.2,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: 0,
          border: `2px solid ${active ? color : "rgba(0,0,0,0.12)"}`,
          background: active ? `${color}22` : "rgba(255,255,255,0.92)",
          boxShadow: active ? `0 0 0 2px ${color}22` : "none",
          transition: "background 0.12s ease, border-color 0.12s ease",
        }}
      >
        {initials}
      </button>
    );
  };

  return (
    <div
      data-navpanel="true"
      className="tlui-navigation-panel "
      style={{
        position: "relative",
        height: isCollapsed ? 50 : MINIMAP_H,
        width: isCollapsed ? 250 : MINIMAP_W,
      }}
      onPointerDown={(e) => e.stopPropagation()}
      onPointerUp={(e) => e.stopPropagation()}
      onPointerMove={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onMouseUp={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* ===== Top row (always visible): chevron + zoom + (expanded) participant buttons on the right ===== */}
      <div
        role="toolbar"
        aria-orientation="horizontal"
        className="tlui-toolbar-container tlui-buttons__horizontal"
        aria-label="Navigation"
        style={{
          outline: "none",
          display: "flex",
          alignItems: "center",
          width: "100%",
          gap: 5,
          padding: 5,
        }}
      >
        {/* Zoom buttons */}
        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title={atMinZoom ? "Minimum zoom (5%)" : "Zoom out"}
          onClick={handleZoomOut}
          disabled={atMinZoom}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            opacity: atMinZoom ? 0.35 : 1,
            cursor: atMinZoom ? "not-allowed" : "pointer",
          }}
        >
          -
        </button>

        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title={`${zoomPct}% — click to reset to 100%`}
          onClick={() =>
            editor.setCamera({
              x: editor.getCamera().x,
              y: editor.getCamera().y,
              z: 1,
            })
          }
          style={{
            height: 34,
            minWidth: 34,
            borderRadius: 10,
            padding: "0 10px",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {zoomPct}%
        </button>

        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title={atMaxZoom ? "Maximum zoom (400%)" : "Zoom in"}
          onClick={handleZoomIn}
          disabled={atMaxZoom}
          style={{
            width: 34,
            height: 34,
            borderRadius: 10,
            opacity: atMaxZoom ? 0.35 : 1,
            cursor: atMaxZoom ? "not-allowed" : "pointer",
          }}
        >
          +
        </button>

        {/* push participant buttons to the right */}
        <div
          style={{
            marginLeft: "auto",
            display: "flex",
            alignItems: "center",
            gap: ACTOR_BUTTON_GAP,
          }}
        >
          {isCollapsed && (
            <span
              style={{
                fontSize: 11,
                fontWeight: 700,
                color: "rgba(0,0,0,0.4)",
                letterSpacing: 0.3,
                whiteSpace: "nowrap",
                userSelect: "none",
              }}
            >
              Minimap
            </span>
          )}

          {!isCollapsed && (
            <>
              {/* "All" toggle — highlighted whenever everyone is shown; click flips to "none" and back */}
              <button
                type="button"
                className="tlui-button"
                onClick={toggleAll}
                title="Toggle all"
                aria-pressed={allActive}
                style={{
                  width: ACTOR_BUTTON_SIZE,
                  height: ACTOR_BUTTON_SIZE,
                  flex: "0 0 auto",
                  borderRadius: ACTOR_BUTTON_RADIUS,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                  border: `2px solid ${
                    allActive ? ALL_BUTTON_COLOR : "rgba(0,0,0,0.12)"
                  }`,
                  background: allActive
                    ? `${ALL_BUTTON_COLOR}1A`
                    : "rgba(255,255,255,0.92)",
                  boxShadow: allActive
                    ? `0 0 0 2px ${ALL_BUTTON_COLOR}22`
                    : "none",
                  transition: "background 0.12s ease, border-color 0.12s ease",
                }}
              >
                All
              </button>

              {/* visible participant buttons (capped) */}
              {visibleActors.map((a) => renderActorButton(a))}

              {/* overflow pill trigger — hover to reveal the rest */}
              {overflowActors.length > 0 && (
                <button
                  ref={overflowBtnRef}
                  type="button"
                  className="tlui-button"
                  title={`${overflowActors.length} more`}
                  aria-expanded={overflowOpen}
                  onMouseEnter={openOverflow}
                  onMouseLeave={scheduleCloseOverflow}
                  onClick={() =>
                    overflowOpen ? setOverflowOpen(false) : openOverflow()
                  }
                  style={{
                    width: ACTOR_BUTTON_SIZE,
                    height: ACTOR_BUTTON_SIZE,
                    flex: "0 0 auto",
                    borderRadius: ACTOR_BUTTON_RADIUS,
                    fontWeight: 800,
                    fontSize: 12,
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    padding: 0,
                    border: `2px solid ${
                      overflowOpen ? ALL_BUTTON_COLOR : "rgba(0,0,0,0.12)"
                    }`,
                    background: overflowOpen
                      ? `${ALL_BUTTON_COLOR}1A`
                      : "rgba(255,255,255,0.92)",
                    transition:
                      "background 0.12s ease, border-color 0.12s ease",
                  }}
                >
                  +{overflowActors.length}
                </button>
              )}
            </>
          )}
        </div>

        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title={isCollapsed ? "Expand minimap" : "Collapse minimap"}
          onClick={() => setIsCollapsed((v) => !v)}
          aria-label={isCollapsed ? "Expand minimap" : "Collapse minimap"}
          style={{ width: 34, height: 34, borderRadius: 10 }}
        >
          <FontAwesomeIcon
            icon={isCollapsed ? faAngleDoubleUp : faAngleDoubleDown}
          />
        </button>
      </div>

      {/* ===== Expanded mode: only minimap below (participants are now in the top row) ===== */}
      {!isCollapsed && (
        <ActorFilteredMinimap
          selectedActorIds={selectedActorIds}
          allActive={allActive}
          shapeActorIdByShapeId={shapeActorIdByShapeId}
          actorOptions={actors}
        />
      )}

      {/* ===== Overflow overlay: pill-shaped, portaled to <body> so it's never clipped ===== */}
      {overflowOpen &&
        overlayPos &&
        overflowActors.length > 0 &&
        createPortal(
          <div
            onMouseEnter={clearCloseTimeout}
            onMouseLeave={scheduleCloseOverflow}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: overlayPos.top,
              left: overlayPos.left,
              transform: "translate(-50%, 0)",
              display: "flex",
              alignItems: "center",
              gap: 6,
              padding: "6px 10px",
              borderRadius: 999,
              background: "rgba(255,255,255,0.98)",
              boxShadow:
                "0 8px 20px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.06)",
              zIndex: 10000,
            }}
          >
            {overflowActors.map((a) => renderActorButton(a, 30))}
          </div>,
          document.body
        )}
    </div>
  );
}
