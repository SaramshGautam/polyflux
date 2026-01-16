import React, { useEffect, useMemo, useRef, useState } from "react";
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
    const hasSelection = selectedActorSet && selectedActorSet.size > 0;
    const isSelected = actorId && hasSelection && selectedActorSet.has(actorId);

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
    });

    transformRef.current = t;
  }, [
    editor,
    allShapeIds,
    drawShapeIds,
    shapeActorIdByShapeId,
    actorColorByActorId,
    selectedSet,
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

  // const actors = useMemo(
  //   () => actorOptions.slice(0, maxActors),
  //   [actorOptions, maxActors]
  // );
  const actors = useMemo(() => {
    const unique = dedupeActors(actorOptions);
    return unique.slice(0, maxActors);
  }, [actorOptions, maxActors]);

  const [selectedActorIds, setSelectedActorIds] = useState([]);
  const [isCollapsed, setIsCollapsed] = useState(true);

  const toggleActor = (actorId) => {
    setSelectedActorIds((prev) => {
      const set = new Set(prev);
      if (set.has(actorId)) set.delete(actorId);
      else set.add(actorId);
      return Array.from(set);
    });
  };

  const clearSelection = () => setSelectedActorIds([]);

  // when collapsing, clear selection so collapsed state is "no filters"
  useEffect(() => {
    if (isCollapsed) setSelectedActorIds([]);
  }, [isCollapsed]);

  // const colorMap = buildActorColorMap(actors);
  const colorMap = useMemo(() => buildActorColorMap(actors), [actors]);

  return (
    <div
      data-navpanel="true"
      className="tlui-navigation-panel "
      style={{
        position: "relative",
        height: isCollapsed ? 50 : MINIMAP_H,
        width: isCollapsed ? 210 : MINIMAP_W,
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
          width: "90%",
          gap: 5,
          padding: 5,
        }}
      >
        {/* Zoom buttons */}
        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title="Zoom out"
          onClick={() => editor.zoomOut()}
          style={{ width: 34, height: 34, borderRadius: 10 }}
        >
          -
        </button>

        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title="Zoom to 100%"
          onClick={() =>
            editor.setCamera({
              x: editor.getCamera().x,
              y: editor.getCamera().y,
              z: 1,
            })
          }
          style={{ height: 34, borderRadius: 10, padding: "0 10px" }}
        >
          100%
        </button>

        <button
          type="button"
          className="tlui-button tlui-button__icon"
          title="Zoom in"
          onClick={() => editor.zoomIn()}
          style={{ width: 34, height: 34, borderRadius: 10 }}
        >
          +
        </button>

        {/* push participant buttons to the right */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {!isCollapsed && (
            <>
              {/* "All" reset */}
              <button
                type="button"
                className="tlui-button"
                onClick={clearSelection}
                title="Show all"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 10,
                  fontWeight: 800,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  padding: 0,
                }}
              >
                All
              </button>

              {/* participant buttons */}
              {actors.map((a) => {
                // const actorKey = a.label || a.id;
                const actorKey = a._actorKey || getActorKey(a);
                const active = selectedActorIds.includes(actorKey);

                // ✅ color based on actorKey (now matches the map)
                // const colorMap = buildActorColorMap(actors);

                const color = colorMap.get(actorKey) || "#111827";

                return (
                  <button
                    key={actorKey}
                    type="button"
                    onClick={() => toggleActor(actorKey)}
                    className="tlui-button"
                    title={actorKey}
                    aria-pressed={active}
                    style={{
                      width: 34,
                      height: 34,
                      // borderRadius: 10,
                      borderRadius: active ? 12 : 10,
                      fontWeight: 800,
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      padding: 0,

                      // border: active
                      //   ? `3px solid ${color}`
                      //   : "1px solid rgba(0,0,0,0.12)",
                      border: active
                        ? `3px solid ${color}`
                        : `2px solid ${color}`,
                      // background: active
                      //   ? `${color}22`
                      //   : "rgba(255,255,255,0.92)",
                      background: active
                        ? `${color}22`
                        : `rgba(255,255,255,0.92)`,

                      // boxShadow: active ? `0 0 0 2px ${color}22` : "none",
                      boxShadow: active ? `0 0 0 2px ${color}22` : "none",
                    }}
                  >
                    {a.label || a.id}
                  </button>
                );
              })}
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
          shapeActorIdByShapeId={shapeActorIdByShapeId}
          actorOptions={actors}
        />
      )}
    </div>
  );
}
