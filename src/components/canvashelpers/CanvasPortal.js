import React, {
  useEffect,
  useRef,
  useMemo,
  useState,
  useCallback,
} from "react";
import { Tldraw } from "tldraw";

const CanvasPortal = ({
  canvasMode = "public",
  onToggle,
  isDragPublishReady = false,
  isDraggingSelection = false,
  // Pass the opposite canvas's store so we can preview it
  otherStore = null,
  shapeUtils = [],
  bindingUtils = [],
}) => {
  const canvasRef = useRef(null);
  const animRef = useRef(null);
  const tRef = useRef(0);
  const sparksRef = useRef([]);
  const miniEditorRef = useRef(null);
  const [hovered, setHovered] = useState(false);
  const [previewHasShapes, setPreviewHasShapes] = useState(false);
  const [debugInfo, setDebugInfo] = useState(null);

  const isPublic = canvasMode === "public";
  const portalActive = hovered || isDragPublishReady;

  // --- DEBUG: fires on every render, so you can see if/when `otherStore`
  // actually becomes non-null, and whether it's a new object each time
  // (which would force the mini <Tldraw> to remount and lose its fit).
  // Remove once resolved.
  useEffect(() => {
    console.log("[CanvasPortal] otherStore prop changed", {
      canvasMode,
      otherStoreProvided: !!otherStore,
      otherStoreType: otherStore?.constructor?.name,
    });
    setPreviewHasShapes(false);
  }, [otherStore, canvasMode]);
  const SIZE = isDragPublishReady ? 116 : portalActive ? 100 : 88;
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

  const miniComponents = useMemo(
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

  const handleMiniMount = useCallback(
    (editor) => {
      miniEditorRef.current = editor;

      try {
        editor.updateInstanceState?.({ isReadonly: true });
        editor.setCurrentTool?.("hand");
      } catch (err) {
        console.error("[CanvasPortal] readonly/tool setup failed:", err);
      }

      // The previous version only checked getCurrentPageShapeIds() — if the
      // shapes actually live on a different page than the one this fresh
      // mini-editor instance defaults to, that check reports zero even
      // though the store genuinely has content. This version checks ALL
      // shape records in the store (not just the current page), and if it
      // finds shapes living on a page other than the current one, switches
      // the mini editor to that page before fitting.
      let fitTimer = null;
      const scheduleFit = (reason) => {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(() => {
          try {
            const allRecords = editor.store?.allRecords?.() ?? [];
            const shapeRecords = allRecords.filter(
              (r) => r.typeName === "shape"
            );
            const currentPageId = editor.getCurrentPageId?.();
            const shapesOnCurrentPage =
              editor.getCurrentPageShapeIds?.().size ?? 0;

            // Top-level shapes have parentId === their page's id (e.g.
            // "page:page"). Nested shapes (inside frames/groups) point at
            // another shape instead, so this only catches top-level ones —
            // enough to tell us which page(s) actually have content.
            let targetPageId = currentPageId;
            if (shapesOnCurrentPage === 0 && shapeRecords.length > 0) {
              const shapeOnOtherPage = shapeRecords.find(
                (s) =>
                  typeof s.parentId === "string" &&
                  s.parentId.startsWith("page:")
              );
              if (shapeOnOtherPage) targetPageId = shapeOnOtherPage.parentId;
            }

            const debugSnapshot = {
              canvasMode,
              reason,
              totalRecords: allRecords.length,
              totalShapeRecords: shapeRecords.length,
              shapesOnCurrentPage,
              currentPageId,
              targetPageId,
            };
            console.log("[CanvasPortal] shape check", debugSnapshot);

            const hasContent = shapeRecords.length > 0;
            setPreviewHasShapes(hasContent);

            if (hasContent) {
              if (
                targetPageId &&
                targetPageId !== editor.getCurrentPageId?.()
              ) {
                try {
                  editor.setCurrentPage?.(targetPageId);
                  console.log(
                    "[CanvasPortal] switched mini editor to page with content:",
                    targetPageId
                  );
                } catch (err) {
                  console.error("[CanvasPortal] setCurrentPage failed:", err);
                }
              }

              editor.zoomToFit?.();

              // At this window size (roughly 70-140px), zoomToFit can end up
              // zooming out so far to fit everything that individual shapes
              // shrink to sub-pixel smears — which looks identical to a flat
              // dark circle. Cap how far out it can go and show a legible
              // crop instead. (zoomToBounds's targetZoom option turned out
              // not to take effect in this tldraw version, so this sets the
              // camera directly instead, using the same x/y = page-space
              // top-left-corner convention already used in ViewerPortal.jsx's
              // cameraFromViewport().)
              const MIN_PREVIEW_ZOOM = 0.2;
              const camAfterFit = editor.getCamera?.();
              if (camAfterFit && camAfterFit.z < MIN_PREVIEW_ZOOM) {
                try {
                  const bounds = editor.getCurrentPageBounds?.();
                  const vsb = editor.getViewportScreenBounds?.();
                  if (bounds && vsb && vsb.width && vsb.height) {
                    const z = MIN_PREVIEW_ZOOM;
                    const cx = (bounds.minX + bounds.maxX) / 2;
                    const cy = (bounds.minY + bounds.maxY) / 2;
                    const camX = cx - vsb.width / 2 / z;
                    const camY = cy - vsb.height / 2 / z;
                    editor.setCamera?.({ x: camX, y: camY, z });
                  }
                } catch (err) {
                  console.error(
                    "[CanvasPortal] min-zoom override failed:",
                    err
                  );
                }
              }

              console.log(
                "[CanvasPortal] zoomToFit done, camera now:",
                editor.getCamera?.()
              );
              setDebugInfo({
                ...debugSnapshot,
                cameraZ: editor.getCamera?.()?.z,
              });
            } else {
              setDebugInfo(debugSnapshot);
            }
          } catch (err) {
            console.error("[CanvasPortal] shape check / zoomToFit threw:", err);
          }
        }, 250);
      };

      scheduleFit("initial mount"); // attempt immediately in case shapes are already there

      let unlisten;
      try {
        unlisten = editor.store?.listen(
          (entry) => {
            // Only re-fit on real document changes (new/moved/removed shapes),
            // not on every camera or pointer update.
            if (entry?.changes) scheduleFit("store change");
          },
          { source: "all", scope: "document" }
        );
      } catch (err) {
        console.error("[CanvasPortal] store.listen failed to attach:", err);
      }

      // tldraw calls this cleanup automatically when the mini editor unmounts
      // (e.g. when `canvasMode` flips and the `key` changes).
      return () => {
        clearTimeout(fitTimer);
        unlisten?.();
      };
    },
    [canvasMode, otherStore]
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

  const portalGlow = isPublic
    ? `0 0 ${portalActive ? 28 : 14}px rgba(240,140,20,0.55), 0 0 ${
        portalActive ? 56 : 28
      }px rgba(240,100,10,0.28)`
    : `0 0 ${portalActive ? 28 : 14}px rgba(20,200,200,0.55), 0 0 ${
        portalActive ? 56 : 28
      }px rgba(10,160,180,0.28)`;

  const fallbackBg = isPublic
    ? "radial-gradient(ellipse at 30% 25%, #1a2a5e 0%, #0d1a3a 40%, #060d1f 75%, #020408 100%)"
    : "radial-gradient(ellipse at 30% 25%, #0d2a1a 0%, #081a10 40%, #030e07 75%, #010501 100%)";

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
            data-canvas-portal="true"
            type="button"
            onClick={() => {
              if (isDraggingSelection || isDragPublishReady) return;
              onToggle?.();
            }}
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
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
                  {/* Live read-only mini canvas */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      pointerEvents: "none",
                    }}
                  >
                    <Tldraw
                      key={canvasMode}
                      store={otherStore}
                      shapeUtils={shapeUtils}
                      bindingUtils={bindingUtils}
                      components={miniComponents}
                      onMount={handleMiniMount}
                      hideUi
                    />
                  </div>

                  {/* Colour tint — makes it look like another world.
                      Kept light (was 0.3) so real content isn't washed out. */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      background: isPublic
                        ? "rgba(10, 20, 60, 0.12)"
                        : "rgba(5, 30, 20, 0.12)",
                      pointerEvents: "none",
                    }}
                  />

                  {/* Vignette to blend edges into the ring — pushed further
                      out and lightened (was transparent 38% / 0.75 black)
                      so it only darkens the rim, not the whole preview. */}
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      borderRadius: "50%",
                      background:
                        "radial-gradient(circle, transparent 55%, rgba(0,0,0,0.45) 100%)",
                      pointerEvents: "none",
                    }}
                  />

                  {/* Empty-state: the store is connected but genuinely has
                      no shapes on it yet. Without this, an empty store and
                      a broken preview look identical (a plain dark circle). */}
                  {!previewHasShapes && (
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
                          background: "white",
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
                        "radial-gradient(circle, transparent 38%, rgba(0,0,0,0.75) 100%)",
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

          {/* TEMPORARY DEBUG READOUT — remove once the preview is confirmed
              working. No devtools needed to read this. */}
          {debugInfo && (
            <div
              style={{
                marginTop: 6,
                pointerEvents: "none",
                background: "rgba(0,0,0,0.75)",
                color: "#fff",
                fontSize: 9,
                lineHeight: 1.4,
                padding: "4px 6px",
                borderRadius: 6,
                whiteSpace: "nowrap",
                fontFamily: "monospace",
              }}
            >
              mode:{debugInfo.canvasMode} shapes:{debugInfo.totalShapeRecords}{" "}
              onPage:{debugInfo.shapesOnCurrentPage} zoom:
              {debugInfo.cameraZ?.toFixed(3) ?? "n/a"}
              <br />
              page:{String(debugInfo.currentPageId).replace("page:", "")}
              {"->"}
              {String(debugInfo.targetPageId).replace("page:", "")}
            </div>
          )}
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
