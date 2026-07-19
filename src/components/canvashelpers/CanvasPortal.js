import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import { Tldraw } from "tldraw";
import "./CanvasPortal.css";

// ---------------------------------------------------------------------------
// Offscreen preview hook
//
// Instead of rendering a live, interactive `<Tldraw>` inside the visible
// circle (which drags in tldraw's own camera/tool state, a watermark link,
// and constant remount/resync churn), we mount a SECOND, fully offscreen
// tldraw editor pointed at the same store. Its only job is to export the
// current page's shapes to an SVG string whenever the document changes.
// The visible portal circle then just renders that SVG as a plain <img>,
// which is trivial to clip into a circle and can never show tldraw's own
// UI chrome, watermark, or camera drift.
// ---------------------------------------------------------------------------
function usePreviewImage(store) {
  const editorRef = useRef(null);
  const debounceRef = useRef(null);
  const currentUrlRef = useRef(null);

  const [imgUrl, setImgUrl] = useState(null);
  const [hasShapes, setHasShapes] = useState(false);

  const exportSvg = useCallback(async (editor, ids) => {
    // API name differs across tldraw major versions — try both.
    if (typeof editor.getSvgString === "function") {
      const res = await editor.getSvgString(ids, {
        background: false,
        padding: 16,
      });
      return res?.svg ?? null;
    }
    if (typeof editor.getSvg === "function") {
      const svgEl = await editor.getSvg(ids, {
        background: false,
        padding: 16,
      });
      return svgEl ? new XMLSerializer().serializeToString(svgEl) : null;
    }
    console.error(
      "[CanvasPortal] No SVG export method found on this tldraw editor " +
        "instance (checked getSvgString and getSvg). Check your installed " +
        "tldraw version's export API."
    );
    return null;
  }, []);

  const refresh = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;

    try {
      const allRecords = editor.store?.allRecords?.() ?? [];
      const shapeRecords = allRecords.filter((r) => r.typeName === "shape");

      if (!shapeRecords.length) {
        setHasShapes(false);
        setImgUrl(null);
        return;
      }

      setHasShapes(true);

      // Same "find the page that actually has content" heuristic as
      // before — top-level shapes have parentId === their page's id.
      const currentPageId = editor.getCurrentPageId?.();
      const shapesOnCurrentPage = shapeRecords.filter(
        (s) => s.parentId === currentPageId
      ).length;

      let targetPageId = currentPageId;
      if (shapesOnCurrentPage === 0) {
        const shapeOnOtherPage = shapeRecords.find(
          (s) =>
            typeof s.parentId === "string" && s.parentId.startsWith("page:")
        );
        if (shapeOnOtherPage) targetPageId = shapeOnOtherPage.parentId;
      }

      if (targetPageId && targetPageId !== editor.getCurrentPageId?.()) {
        editor.setCurrentPage?.(targetPageId);
      }

      const idsOnPage = Array.from(editor.getCurrentPageShapeIds?.() ?? []);

      if (!idsOnPage.length) {
        setImgUrl(null);
        return;
      }

      const svgString = await exportSvg(editor, idsOnPage);
      if (!svgString) return;

      const blob = new Blob([svgString], { type: "image/svg+xml" });
      const url = URL.createObjectURL(blob);

      // Revoke the previous object URL so we don't leak memory on every
      // edit — but only after the new one is set, to avoid a flash of
      // no-image between swaps.
      const prevUrl = currentUrlRef.current;
      currentUrlRef.current = url;
      setImgUrl(url);
      if (prevUrl) URL.revokeObjectURL(prevUrl);
    } catch (err) {
      console.error("[CanvasPortal] preview export failed:", err);
    }
  }, [exportSvg]);

  const handleHiddenMount = useCallback(
    (editor) => {
      editorRef.current = editor;
      try {
        editor.updateInstanceState?.({ isReadonly: true });
      } catch (err) {
        console.error("[CanvasPortal] readonly setup failed:", err);
      }
      refresh();

      const unlisten = editor.store?.listen(
        (entry) => {
          if (!entry?.changes) return;
          clearTimeout(debounceRef.current);
          debounceRef.current = setTimeout(() => refresh(), 500);
        },
        { source: "all", scope: "document" }
      );

      return () => {
        clearTimeout(debounceRef.current);
        unlisten?.();
      };
    },
    [refresh]
  );

  // Clean up the last object URL when the store changes or we unmount.
  useEffect(() => {
    return () => {
      if (currentUrlRef.current) {
        URL.revokeObjectURL(currentUrlRef.current);
        currentUrlRef.current = null;
      }
    };
  }, [store]);

  return { imgUrl, hasShapes, handleHiddenMount };
}

// ---------------------------------------------------------------------------
// Fixed render geometry
//
// The ring/canvas/text used to be redrawn at a new pixel size every time the
// portal's state changed (dormant/hover/drag-ready/arriving), which meant:
//   - the <canvas> element's width/height ATTRIBUTES changed, which clears
//     and reallocates its backing pixel buffer — an instant snap, not a
//     transition, no matter what CSS said.
//   - the portal-window <div> and arc-text <svg> sizes were recalculated
//     from the same state and jumped straight to their new values.
// Only the outer <button>'s CSS width/height had a transition, so the shell
// grew smoothly while everything inside it popped — that mismatch is what
// read as "jittery."
//
// Fix: draw everything ONCE at a single fixed resolution (RENDER_SIZE, the
// largest state) and grow/shrink the whole assembly with a single CSS
// `transform: scale()`, which the browser can animate smoothly on the
// compositor without ever touching layout or the canvas's pixel buffer.
// ---------------------------------------------------------------------------
const RENDER_SIZE = 200; // fixed drawing resolution (== old "drag-ready" size)
const HALF = RENDER_SIZE / 2;
const INNER = Math.round(RENDER_SIZE * 0.42);
const OUTER = Math.round(RENDER_SIZE * 0.485);
const PADDING = 18;
const SVG_SIZE = RENDER_SIZE + PADDING * 2;
const SVG_CX = SVG_SIZE / 2;
const SVG_CY = SVG_SIZE / 2;
const TEXT_RADIUS = HALF + PADDING * 0.55;
const WINDOW_DIAMETER = INNER * 2;

// Target visual sizes, expressed as a fraction of RENDER_SIZE — this is what
// used to be separate pixel values (88 / 130 / 180 / 200). Converting them to
// scale factors lets a single CSS transform carry the whole animation.
const DORMANT_SCALE = 88 / RENDER_SIZE;
const ARRIVING_SCALE = 130 / RENDER_SIZE;
const HOVER_SCALE = 180 / RENDER_SIZE;
const DRAG_READY_SCALE = 200 / RENDER_SIZE;

// How "energized" the ring looks (line thickness, glow, spark visibility) —
// eased continuously inside the draw loop rather than snapping with state,
// so it stays smooth even through rapid hover in/out.
const ACTIVITY_DORMANT = 0.12;
const ACTIVITY_HOVER = 0.6;
const ACTIVITY_DRAG_READY = 0.85;
const ACTIVITY_ARRIVING = 1;
const ACTIVITY_EASE = 0.08; // per-frame lerp factor

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

// Each canvas's own identity color — used to color that canvas's NAME
// wherever it appears in the ring text, regardless of which side is
// currently active. Previously the whole arc string shared one fill tied
// to the current mode, so when idle text named the *other* canvas (the
// destination), it still rendered in the current side's color — backwards.
const PUBLIC_THEME_COLOR = "#CE7E00";
const PRIVATE_THEME_COLOR = "#14c8c8";

const CanvasPortal = ({
  canvasMode = "public",
  onToggle,
  isDragPublishReady = false,
  isDraggingSelection = false,
  // Pass the opposite canvas's store so we can preview it
  otherStore = null,
  shapeUtils = [],
  bindingUtils = [],
  // Bump this to any new value (e.g. Date.now()) to trigger a brief
  // "arrival" flash on the ring — used as the payoff moment when a
  // fly-into-the-portal animation finishes.
  arrivalPulse = null,
}) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const tRef = useRef(0);
  const sparksRef = useRef([]);
  const [hovered, setHovered] = useState(false);
  const [previewZoom, setPreviewZoom] = useState(1);
  const [previewPan, setPreviewPan] = useState({ x: 0, y: 0 });
  const [isPanning, setIsPanning] = useState(false);
  const [isArriving, setIsArriving] = useState(false);
  const buttonRef = useRef(null);
  const lastPulseRef = useRef(arrivalPulse);

  // Click-and-drag panning of the preview image. isPanningRef tracks
  // whether a drag is currently in progress; panStartRef captures the
  // pointer position and pan offset at drag start so movement is computed
  // as a delta, not an absolute position.
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  // Eased "how big" / "how energized" values, read every animation frame.
  // Kept as refs (not state) so easing never triggers a React re-render —
  // only the draw loop and the CSS transform (via a plain style read) touch
  // these, which is what keeps the growth buttery instead of stepped.
  const activityRef = useRef(ACTIVITY_DORMANT);
  const activityTargetRef = useRef(ACTIVITY_DORMANT);

  useEffect(() => {
    if (arrivalPulse == null || arrivalPulse === lastPulseRef.current) return;
    lastPulseRef.current = arrivalPulse;
    setIsArriving(true);
    const t = setTimeout(() => setIsArriving(false), 520);
    return () => clearTimeout(t);
  }, [arrivalPulse]);

  const isPublic = canvasMode === "public";
  const portalActive = hovered || isDragPublishReady;

  const { imgUrl, hasShapes, handleHiddenMount } = usePreviewImage(otherStore);

  // Single source of truth for both the CSS scale and the ring "activity" —
  // same precedence order as the old discrete SIZE values.
  const currentScale = isArriving
    ? ARRIVING_SCALE
    : isDragPublishReady
    ? DRAG_READY_SCALE
    : portalActive
    ? HOVER_SCALE
    : DORMANT_SCALE;

  // How "grown" the portal currently is, normalized 0 (dormant) → 1 (its
  // biggest state, drag-ready). Drives a small extra nudge — 5px right,
  // 10px down — that eases in alongside the scale itself, rather than
  // jumping straight to the full offset the instant it starts growing.
  const growth = clamp(
    (currentScale - DORMANT_SCALE) / (DRAG_READY_SCALE - DORMANT_SCALE),
    0,
    1
  );
  const growthOffsetX = 5 * growth;
  const growthOffsetY = 15 * growth;

  useEffect(() => {
    activityTargetRef.current = isArriving
      ? ACTIVITY_ARRIVING
      : isDragPublishReady
      ? ACTIVITY_DRAG_READY
      : portalActive
      ? ACTIVITY_HOVER
      : ACTIVITY_DORMANT;
  }, [isArriving, isDragPublishReady, portalActive]);

  // Idle: which canvas you'd land on if you switch. Hovering (and not
  // mid-drag-publish): a quick legend for the three gestures the portal
  // supports, naming the actual destination and coloring it with THAT
  // canvas's own theme color via <tspan> (SVG <textPath> explicitly
  // allows tspan children, unlike arbitrary nested elements such as a
  // <FontAwesomeIcon>'s <svg>). String segments are wrapped in {"..."}
  // rather than left as raw JSX text so exact spacing (the deliberate
  // double-spaces around "·") survives regardless of how this gets
  // reformatted — JSX collapses whitespace in plain text nodes, but never
  // touches a JS string literal.
  const arcText = isDragPublishReady ? (
    "· DROP TO PUBLISH · DROP TO PUBLISH ·"
  ) : isDraggingSelection ? (
    "· DRAG HERE · DRAG HERE · DRAG HERE ·"
  ) : portalActive && isPublic ? (
    <>
      {"👆🏼 DOUBLE-CLICK TO SWITCH TO "}
      <tspan fill={PRIVATE_THEME_COLOR}>PRIVATE CANVAS</tspan>
      {"  ·  🖐 DRAG TO LOOK AROUND  ·  🔍  SCROLL TO ZOOM  ·  "}
    </>
  ) : portalActive ? (
    <>
      {"👆🏼 DOUBLE-CLICK TO SWITCH TO "}
      <tspan fill={PUBLIC_THEME_COLOR}>PUBLIC CANVAS</tspan>
      {"  ·  🖐 DRAG TO LOOK AROUND  ·  🔍  SCROLL TO ZOOM  ·  "}
    </>
  ) : isPublic ? (
    <>
      {"· "}
      <tspan fill={PRIVATE_THEME_COLOR}>PRIVATE CANVAS</tspan>
      {" · "}
      <tspan fill={PRIVATE_THEME_COLOR}>PRIVATE CANVAS</tspan>
      {" ·"}
    </>
  ) : (
    <>
      {"· "}
      <tspan fill={PUBLIC_THEME_COLOR}>PUBLIC CANVAS</tspan>
      {" · "}
      <tspan fill={PUBLIC_THEME_COLOR}>PUBLIC CANVAS</tspan>
      {" · "}
    </>
  );

  const sublabel = isPublic
    ? "Enter your private space"
    : isDragPublishReady
    ? "Drop to publish"
    : isDraggingSelection
    ? "Drag here to publish"
    : "Return to shared canvas";

  const sparkColors = isPublic
    ? ["gold", "orange", "white"]
    : ["#40e0d0", "#00bfff", "white"];

  const ringColor = isPublic ? [240, 140, 20] : [20, 200, 200];
  const arcColor = isPublic ? PUBLIC_THEME_COLOR : PRIVATE_THEME_COLOR;

  const arcPath = `
    M ${SVG_CX},${SVG_CY - TEXT_RADIUS}
    a ${TEXT_RADIUS},${TEXT_RADIUS} 0 1,1 -0.01,0
  `;

  // The offscreen editor still needs the full shape/binding util set so it
  // can render the same custom shapes (audio, pdf, named notes, etc.) that
  // the real canvases use — otherwise custom shapes silently fail to draw
  // and get skipped from the export.
  const hiddenComponents = useMemo(
    () => ({
      MainMenu: () => null,
      PageMenu: () => null,
      ActionsMenu: () => null,
      Toolbar: () => null,
      HelpMenu: () => null,
      NavigationPanel: () => null,
      StylePanel: () => null,
      ZoomMenu: () => null,
      ContextMenu: () => null,
      InFrontOfTheCanvas: () => null,
    }),
    []
  );

  useEffect(() => {
    sparksRef.current = Array.from({ length: 70 }, () => ({
      angle: Math.random() * Math.PI * 2,
      speed: (Math.random() * 0.01 + 0.004) * (Math.random() > 0.5 ? 1 : -1),
      rFrac: Math.random(),
      size: Math.random() * 2 + 0.5,
      flickerSpeed: Math.random() * 0.08 + 0.02,
      flickerOffset: Math.random() * Math.PI * 2,
      colorIdx: Math.floor(Math.random() * 3),
    }));
  }, []);

  // Scroll-to-zoom on the preview. Attached as a native listener with
  // { passive: false } rather than React's onWheel — React 17+ registers
  // wheel handlers as passive at the root by default for scroll
  // performance, which silently ignores preventDefault() and lets the
  // page scroll underneath the portal instead of zooming it.
  useEffect(() => {
    const el = buttonRef.current;
    if (!el) return;

    const MIN_ZOOM = 1;
    const MAX_ZOOM = 3.5;

    const handleWheel = (e) => {
      e.preventDefault();
      setPreviewZoom((z) => {
        const next = z - e.deltaY * 0.0018;
        return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, next));
      });
    };

    el.addEventListener("wheel", handleWheel, { passive: false });
    return () => el.removeEventListener("wheel", handleWheel);
  }, []);

  // Keep the pan offset within bounds as zoom changes — e.g. panning around
  // at 3x then zooming back to 1x should recenter rather than leave the
  // image stuck off to one side with nowhere further to pan back to.
  useEffect(() => {
    const maxPan = Math.max(0, (WINDOW_DIAMETER / 2) * (previewZoom - 1));
    setPreviewPan((prev) => {
      const nextX = clamp(prev.x, -maxPan, maxPan);
      const nextY = clamp(prev.y, -maxPan, maxPan);
      if (nextX === prev.x && nextY === prev.y) return prev;
      return { x: nextX, y: nextY };
    });
  }, [previewZoom]);

  // Ring draw loop. Geometry (RENDER_SIZE/INNER/OUTER) is now fixed, so this
  // effect only needs to restart when the color palette changes (isPublic) —
  // it no longer tears down and rebuilds every time the portal grows or
  // shrinks, which was the other source of stutter.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = RENDER_SIZE,
      H = RENDER_SIZE,
      CX = HALF,
      CY = HALF;
    const [r0, g0, b0] = ringColor;

    const mandalaRings = [
      { rFrac: 0.05, dashes: 40, dashLen: 0.06, w: 1.0, speed: 0.007 },
      { rFrac: 0.2, dashes: 28, dashLen: 0.09, w: 0.7, speed: -0.005 },
      { rFrac: 0.38, dashes: 20, dashLen: 0.11, w: 1.4, speed: 0.003 },
      { rFrac: 0.55, dashes: 50, dashLen: 0.04, w: 0.5, speed: -0.009 },
      { rFrac: 0.72, dashes: 24, dashLen: 0.08, w: 0.9, speed: 0.006 },
      { rFrac: 0.9, dashes: 40, dashLen: 0.055, w: 1.6, speed: -0.004 },
    ];

    function drawMandala(t, activity) {
      const ringW = OUTER - INNER;
      // Thinner + dimmer at rest, thicker + brighter when energized —
      // this is the "dormant vs active" ring feel, driven continuously
      // instead of by a state-flip snap.
      const widthMul = 0.5 + 0.7 * activity;
      const glowMul = 0.4 + 0.9 * activity;
      const alphaFloor = 0.15 + 0.55 * activity;

      mandalaRings.forEach(({ rFrac, dashes, dashLen, w, speed }) => {
        const radius = INNER + rFrac * ringW;
        const offset = t * speed;
        const step = (Math.PI * 2) / dashes;
        ctx.save();
        ctx.lineWidth = w * widthMul;
        ctx.lineCap = "round";
        for (let i = 0; i < dashes; i++) {
          const startA = i * step + offset;
          const endA = startA + step * dashLen;
          const flicker =
            alphaFloor +
            (1 - alphaFloor) * (0.5 + 0.5 * Math.sin(t * 0.04 + i * 0.9));
          ctx.beginPath();
          ctx.arc(CX, CY, radius, startA, endA);
          ctx.strokeStyle = `rgba(${r0},${g0},${b0},${flicker})`;
          ctx.shadowColor = `rgba(${r0},${g0},${b0},0.9)`;
          ctx.shadowBlur = 5 * glowMul;
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    function drawSparks(t, activity) {
      const ringW = OUTER - INNER;
      // Fewer/dimmer sparks when dormant, full sparkle when energized.
      const visibleCount = Math.round(
        sparksRef.current.length * (0.25 + 0.75 * activity)
      );
      sparksRef.current.forEach((sp, i) => {
        sp.angle += sp.speed;
        if (i >= visibleCount) return;

        const radius = INNER + sp.rFrac * ringW;
        const flicker =
          (0.2 +
            0.8 * Math.abs(Math.sin(t * sp.flickerSpeed + sp.flickerOffset))) *
          (0.4 + 0.6 * activity);
        const x = CX + Math.cos(sp.angle) * radius;
        const y = CY + Math.sin(sp.angle) * radius;
        const col = sparkColors[sp.colorIdx];
        ctx.save();
        ctx.globalAlpha = flicker;
        ctx.beginPath();
        ctx.arc(x, y, sp.size * 0.7, 0, Math.PI * 2);
        ctx.fillStyle = col;
        ctx.shadowColor = col;
        ctx.shadowBlur = sp.size > 1.5 ? 8 : 4;
        ctx.fill();
        ctx.restore();
      });
    }

    function drawOuterGlow(activity) {
      const grad = ctx.createRadialGradient(
        CX,
        CY,
        INNER - 6,
        CX,
        CY,
        OUTER + 14
      );
      const g = 0.5 + 0.7 * activity;
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.4, `rgba(${r0},${g0},${b0},${0.05 * g})`);
      grad.addColorStop(0.75, `rgba(${r0},${g0},${b0},${0.18 * g})`);
      grad.addColorStop(1, `rgba(${r0},${g0},${b0},${0.03 * g})`);
      ctx.save();
      ctx.beginPath();
      ctx.arc(CX, CY, OUTER + 14, 0, Math.PI * 2);
      ctx.fillStyle = grad;
      ctx.fill();
      ctx.restore();
    }

    function maskRing() {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.arc(CX, CY, INNER, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fill();
      ctx.restore();

      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.beginPath();
      ctx.rect(0, 0, W, H);
      ctx.arc(CX, CY, OUTER + 2, 0, Math.PI * 2, true);
      ctx.fillStyle = "rgba(0,0,0,1)";
      ctx.fill();
      ctx.restore();
    }

    const draw = () => {
      const t = tRef.current++;

      // Ease the activity value toward its target every frame — this is
      // what makes the ring "wake up" and "settle down" smoothly instead
      // of snapping the instant hover/drag state changes.
      activityRef.current +=
        (activityTargetRef.current - activityRef.current) * ACTIVITY_EASE;
      const activity = activityRef.current;

      ctx.clearRect(0, 0, W, H);
      drawOuterGlow(activity);
      drawMandala(t, activity);
      drawSparks(t, activity);
      maskRing();
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [isPublic]);

  const glowNear = isArriving ? 44 : portalActive ? 28 : 14;
  const glowFar = isArriving ? 90 : portalActive ? 56 : 28;

  const portalGlow = isPublic
    ? `0 0 ${glowNear}px rgba(240,140,20,${
        isArriving ? 0.85 : 0.55
      }), 0 0 ${glowFar}px rgba(240,100,10,${isArriving ? 0.5 : 0.28})`
    : `0 0 ${glowNear}px rgba(20,200,200,${
        isArriving ? 0.85 : 0.55
      }), 0 0 ${glowFar}px rgba(10,160,180,${isArriving ? 0.5 : 0.28})`;

  const fallbackBg = "#ffffff";

  return (
    <>
      <div
        style={{
          position: "fixed",
          left: 22 - PADDING,
          top: 110 - PADDING,
          // zIndex: 10120,
          userSelect: "none",
          pointerEvents: "none",
        }}
      >
        {/* Scaled assembly: arc text + ring canvas + button are all drawn
            once at RENDER_SIZE and grown/shrunk together with a single
            CSS transform, so nothing inside ever snaps mid-animation. */}
        <div
          style={{
            position: "relative",
            width: SVG_SIZE,
            height: SVG_SIZE,
            // translate() listed before scale() keeps this offset in real
            // screen pixels (5px right, 10px down at full growth) rather
            // than having it multiplied by the scale factor itself.
            transform: `translate(${growthOffsetX}px, ${growthOffsetY}px) scale(${currentScale})`,
            transformOrigin: "15% 20%",
            transition: "transform 260ms cubic-bezier(0.22, 1, 0.36, 1)",
            willChange: "transform",
          }}
        >
          <svg
            width={SVG_SIZE}
            height={SVG_SIZE}
            style={{
              position: "absolute",
              top: 0,
              left: 0,
              pointerEvents: "none",
              overflow: "visible",
              animation: "portalTextSpin 18s linear infinite",
            }}
          >
            <defs>
              <path id="arcCircle" d={arcPath} />
            </defs>
            <text
              style={{
                fontSize: 8.4,
                fontWeight: 700,
                letterSpacing: "0.12em",
              }}
            >
              <textPath href="#arcCircle" startOffset="0%" fill={arcColor}>
                {arcText}
              </textPath>
            </text>
          </svg>

          <div
            style={{
              position: "absolute",
              top: PADDING,
              left: PADDING,
              pointerEvents: "auto",
            }}
          >
            <button
              ref={buttonRef}
              data-canvas-portal="true"
              type="button"
              onDoubleClick={() => {
                if (isDraggingSelection || isDragPublishReady) return;
                onToggle?.();
              }}
              onPointerDown={(e) => {
                // Only the preview-pan gesture starts here — dragging a
                // shape from the canvas onto the portal is tracked
                // separately (globally, by the parent) and never touches
                // this handler, since that drag starts on the tldraw
                // canvas element, not on this button.
                if (isDraggingSelection || isDragPublishReady) return;
                isPanningRef.current = true;
                setIsPanning(true);
                panStartRef.current = {
                  x: e.clientX,
                  y: e.clientY,
                  panX: previewPan.x,
                  panY: previewPan.y,
                };
                e.currentTarget.setPointerCapture?.(e.pointerId);
              }}
              onPointerMove={(e) => {
                if (!isPanningRef.current) return;
                const dx = e.clientX - panStartRef.current.x;
                const dy = e.clientY - panStartRef.current.y;
                // More room to pan around at higher zoom, none at 1x.
                const maxPan = Math.max(
                  0,
                  (WINDOW_DIAMETER / 2) * (previewZoom - 1)
                );
                setPreviewPan({
                  x: clamp(panStartRef.current.panX + dx, -maxPan, maxPan),
                  y: clamp(panStartRef.current.panY + dy, -maxPan, maxPan),
                });
              }}
              onPointerUp={(e) => {
                isPanningRef.current = false;
                setIsPanning(false);
                e.currentTarget.releasePointerCapture?.(e.pointerId);
              }}
              onPointerCancel={() => {
                isPanningRef.current = false;
                setIsPanning(false);
              }}
              onMouseEnter={() => setHovered(true)}
              onMouseLeave={() => {
                setHovered(false);
                // Deliberately NOT resetting previewZoom/previewPan here —
                // the explored view of the other canvas should persist
                // across hover sessions (only the ring shrinking back to
                // dormant size, via `hovered`, changes). It still gets
                // re-clamped into valid bounds by the effect above if a
                // subsequent zoom-out would otherwise strand it off-center.
              }}
              title={`${sublabel} · drag to look around · double-click to switch`}
              style={{
                width: RENDER_SIZE,
                height: RENDER_SIZE,
                borderRadius: "50%",
                border: "none",
                background: "transparent",
                cursor: isPanning ? "grabbing" : "grab",
                touchAction: "none",
                padding: 0,
                position: "relative",
                display: "block",
              }}
            >
              {/* Portal window */}
              <div
                style={{
                  position: "absolute",
                  top: "50%",
                  left: "50%",
                  width: WINDOW_DIAMETER,
                  height: WINDOW_DIAMETER,
                  marginTop: -INNER,
                  marginLeft: -INNER,
                  borderRadius: "50%",
                  boxShadow: portalGlow,
                  overflow: "hidden",
                  transition: "box-shadow 300ms ease",
                  background: fallbackBg,
                }}
              >
                {otherStore ? (
                  <>
                    {imgUrl ? (
                      <img
                        src={imgUrl}
                        alt=""
                        style={{
                          position: "absolute",
                          inset: 0,
                          width: "100%",
                          height: "100%",
                          objectFit: "contain",
                          pointerEvents: "none",
                          // translate() is listed before scale() so the pan
                          // offset stays in real screen pixels regardless of
                          // zoom level — otherwise dragging would feel like
                          // it accelerates or drags the wrong distance as
                          // previewZoom changes.
                          transform: `translate(${previewPan.x}px, ${previewPan.y}px) scale(${previewZoom})`,
                          transformOrigin: "center center",
                          transition:
                            hovered && !isPanning
                              ? "transform 60ms linear"
                              : isPanning
                              ? "none"
                              : "transform 220ms ease-out",
                        }}
                      />
                    ) : null}

                    {/* Soft vignette to blend the image edges into the ring,
                        tuned for a white background instead of a dark one. */}
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, transparent 60%, rgba(0,0,0,0.10) 100%)",
                        pointerEvents: "none",
                      }}
                    />

                    {/* Empty-state: store connected, but genuinely no shapes. */}
                    {!hasShapes && (
                      <div
                        style={{
                          position: "absolute",
                          inset: 0,
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                          textAlign: "center",
                          padding: "0 8px",
                          pointerEvents: "none",
                        }}
                      >
                        <span
                          style={{
                            fontSize: 8,
                            fontWeight: 600,
                            letterSpacing: "0.03em",
                            color: "rgba(255,255,255,0.75)",
                            textShadow: "0 1px 3px rgba(0,0,0,0.6)",
                          }}
                        >
                          Nothing here yet
                        </span>
                      </div>
                    )}

                    {/* Offscreen, export-only editor. Never visible — it's
                        positioned far off the viewport rather than
                        display:none/opacity:0, since some tldraw internals
                        skip layout work on elements with no rendered box. */}
                    <div
                      style={{
                        position: "fixed",
                        left: -9999,
                        top: -9999,
                        width: 400,
                        height: 400,
                        pointerEvents: "none",
                      }}
                      aria-hidden="true"
                    >
                      <Tldraw
                        key={canvasMode}
                        store={otherStore}
                        shapeUtils={shapeUtils}
                        bindingUtils={bindingUtils}
                        components={hiddenComponents}
                        onMount={handleHiddenMount}
                        hideUi
                      />
                    </div>
                  </>
                ) : (
                  /* Fallback starfield when no store is provided */
                  <>
                    <div style={{ position: "absolute", inset: 0 }}>
                      {Array.from({ length: 30 }, (_, i) => (
                        <div
                          key={i}
                          style={{
                            position: "absolute",
                            width: `${Math.random() * 1.5 + 0.4}px`,
                            height: `${Math.random() * 1.5 + 0.4}px`,
                            borderRadius: "50%",
                            background: "#94a3b8",
                            left: `${Math.random() * 100}%`,
                            top: `${Math.random() * 100}%`,
                            opacity: Math.random() * 0.6 + 0.2,
                            animation: `portalTwinkle ${(
                              Math.random() * 2 +
                              1
                            ).toFixed(1)}s ease-in-out infinite`,
                            animationDelay: `${(Math.random() * 3).toFixed(
                              1
                            )}s`,
                          }}
                        />
                      ))}
                    </div>
                    <div
                      style={{
                        position: "absolute",
                        inset: 0,
                        borderRadius: "50%",
                        background:
                          "radial-gradient(circle, transparent 55%, rgba(0,0,0,0.12) 100%)",
                        pointerEvents: "none",
                      }}
                    />
                  </>
                )}
              </div>

              {/* Ring canvas — on top */}
              <canvas
                ref={canvasRef}
                width={RENDER_SIZE}
                height={RENDER_SIZE}
                style={{
                  position: "absolute",
                  top: 0,
                  left: 0,
                  width: RENDER_SIZE,
                  height: RENDER_SIZE,
                  pointerEvents: "none",
                }}
              />
            </button>
          </div>
        </div>
      </div>
    </>
  );
};

export default CanvasPortal;
