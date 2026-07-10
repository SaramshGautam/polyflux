import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import { Tldraw } from "tldraw";

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
  const [isArriving, setIsArriving] = useState(false);
  const buttonRef = useRef(null);
  const lastPulseRef = useRef(arrivalPulse);

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

  const SIZE = isArriving
    ? 130
    : isDragPublishReady
    ? 116
    : portalActive
    ? 112
    : 88;
  const HALF = SIZE / 2;
  const INNER = Math.round(SIZE * 0.42); // was 0.34 — bigger preview window
  const OUTER = Math.round(SIZE * 0.485);

  const arcText = isPublic
    ? "· PRIVATE CANVAS · PRIVATE CANVAS ·"
    : isDragPublishReady
    ? "· DROP TO PUBLISH · DROP TO PUBLISH ·"
    : isDraggingSelection
    ? "· DRAG HERE · DRAG HERE · DRAG HERE ·"
    : "· PUBLIC CANVAS · PUBLIC CANVAS · ";

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
  const arcColor = isPublic ? "#f0a030" : "#14c8c8";

  const PADDING = 18;
  const SVG_SIZE = SIZE + PADDING * 2;
  const SVG_CX = SVG_SIZE / 2;
  const SVG_CY = SVG_SIZE / 2;
  const TEXT_RADIUS = HALF + PADDING * 0.55;

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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    const W = SIZE,
      H = SIZE,
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

    function drawMandala(t) {
      const ringW = OUTER - INNER;
      mandalaRings.forEach(({ rFrac, dashes, dashLen, w, speed }) => {
        const radius = INNER + rFrac * ringW;
        const offset = t * speed;
        const step = (Math.PI * 2) / dashes;
        ctx.save();
        ctx.lineWidth = w;
        ctx.lineCap = "round";
        for (let i = 0; i < dashes; i++) {
          const startA = i * step + offset;
          const endA = startA + step * dashLen;
          const flicker = 0.5 + 0.5 * Math.sin(t * 0.04 + i * 0.9);
          ctx.beginPath();
          ctx.arc(CX, CY, radius, startA, endA);
          ctx.strokeStyle = `rgba(${r0},${g0},${b0},${flicker})`;
          ctx.shadowColor = `rgba(${r0},${g0},${b0},0.9)`;
          ctx.shadowBlur = 5;
          ctx.stroke();
        }
        ctx.restore();
      });
    }

    function drawSparks(t) {
      const ringW = OUTER - INNER;
      sparksRef.current.forEach((sp) => {
        sp.angle += sp.speed;
        const radius = INNER + sp.rFrac * ringW;
        const flicker =
          0.2 +
          0.8 * Math.abs(Math.sin(t * sp.flickerSpeed + sp.flickerOffset));
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

    function drawOuterGlow() {
      const grad = ctx.createRadialGradient(
        CX,
        CY,
        INNER - 6,
        CX,
        CY,
        OUTER + 14
      );
      grad.addColorStop(0, "rgba(0,0,0,0)");
      grad.addColorStop(0.4, `rgba(${r0},${g0},${b0},0.05)`);
      grad.addColorStop(0.75, `rgba(${r0},${g0},${b0},0.18)`);
      grad.addColorStop(1, `rgba(${r0},${g0},${b0},0.03)`);
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
      ctx.clearRect(0, 0, W, H);
      drawOuterGlow();
      drawMandala(t);
      drawSparks(t);
      maskRing();
      animRef.current = requestAnimationFrame(draw);
    };

    animRef.current = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(animRef.current);
  }, [SIZE, INNER, OUTER, isPublic]);

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

  const windowDiameter = INNER * 2;

  return (
    <>
      <div
        style={{
          position: "fixed",
          left: 22 - PADDING,
          top: 110 - PADDING,
          zIndex: 10120,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          userSelect: "none",
          pointerEvents: "none",
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
              fontSize: SIZE < 95 ? 6 : 7,
              fontWeight: 700,
              letterSpacing: "0.12em",
            }}
          >
            <textPath href="#arcCircle" startOffset="0%" fill={arcColor}>
              {arcText}
            </textPath>
          </text>
        </svg>

        <div style={{ margin: PADDING, pointerEvents: "auto" }}>
          <button
            ref={buttonRef}
            data-canvas-portal="true"
            type="button"
            onClick={() => {
              if (isDraggingSelection || isDragPublishReady) return;
              onToggle?.();
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => {
              setHovered(false);
              setPreviewZoom(1);
            }}
            title={sublabel}
            style={{
              width: SIZE,
              height: SIZE,
              borderRadius: "50%",
              border: "none",
              background: "transparent",
              cursor: "pointer",
              padding: 0,
              position: "relative",
              transition: "width 200ms ease, height 200ms ease",
              display: "block",
            }}
          >
            {/* Portal window */}
            <div
              style={{
                position: "absolute",
                top: "50%",
                left: "50%",
                width: windowDiameter,
                height: windowDiameter,
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
                        transform: `scale(${previewZoom})`,
                        transformOrigin: "center center",
                        transition: hovered
                          ? "transform 60ms linear"
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
                          animationDelay: `${(Math.random() * 3).toFixed(1)}s`,
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
              width={SIZE}
              height={SIZE}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: SIZE,
                height: SIZE,
                pointerEvents: "none",
              }}
            />
          </button>
        </div>
      </div>

      <style>{`
        @keyframes portalTwinkle {
          0%, 100% { opacity: 0.5; transform: scale(1); }
          50%       { opacity: 0.05; transform: scale(0.5); }
        }
        @keyframes portalTextSpin {
          from { transform: rotate(0deg); }
          to   { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
};

export default CanvasPortal;
