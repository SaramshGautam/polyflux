import * as React from "react";
import { useEffect, useRef, useState } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  useEditor,
  useValue,
  usePassThroughWheelEvents,
} from "tldraw";
import * as pdfjsLib from "pdfjs-dist";

// Required by pdf.js so it can render pages off the main thread. This
// works with webpack 5 / react-scripts 5 (CRA) via the `new URL(...,
// import.meta.url)` pattern, which bundles the worker as its own chunk.
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  "pdfjs-dist/build/pdf.worker.min.mjs",
  import.meta.url
).toString();

// Render pages at a higher resolution than their displayed CSS size so
// they stay crisp when the shape is zoomed in or viewed on a retina
// display, without re-rendering on every zoom tick.
const RENDER_SCALE_MULTIPLIER = 1.5;

export class PdfShapeUtil extends BaseBoxShapeUtil {
  static type = "pdf";

  getDefaultProps() {
    return {
      w: 420,
      h: 560,
      src: "",
      title: "Document.pdf",
    };
  }

  getGeometry(shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  component(shape) {
    return <PdfReader shape={shape} />;
  }

  indicator(shape) {
    return <rect width={shape.props.w} height={shape.props.h} rx={8} ry={8} />;
  }

  canResize() {
    return true;
  }

  isAspectRatioLocked() {
    return false;
  }

  canBind() {
    return false;
  }

  canEdit() {
    return true;
  }
}

function PdfReader({ shape }) {
  const { src, w, h, title } = shape.props;

  const editor = useEditor();
  // tldraw's own hit-test layer sits above a shape's rendered content and
  // captures pointer/wheel events for select-and-drag — that layer only
  // steps aside once the shape is "being edited" (same mechanism as
  // double-clicking a note to type into it, gated by canEdit() above).
  // Without checking this, wheel/scroll never reaches the div below at
  // all, regardless of pointerEvents or stopPropagation on it.
  const isEditing = useValue(
    "pdf shape is editing",
    () => editor.getEditingShapeId() === shape.id,
    [editor, shape.id]
  );

  const scrollRef = useRef(null);
  // A native (not React-synthetic) wheel listener: if this element can
  // still scroll internally, the browser handles it normally; once you've
  // hit the edge, it redispatches the wheel event to tldraw's own canvas
  // so zoom takes over. This is the actual mechanism that makes "scroll
  // the content, then fall through to canvas zoom" work correctly —
  // React's synthetic onWheel fires too late in the bubble phase to beat
  // tldraw's native listeners on the canvas.
  usePassThroughWheelEvents(scrollRef);

  const canvasRefs = useRef({}); // pageNum -> <canvas> element
  const renderedPages = useRef(new Set()); // pages already drawn — avoids
  // redoing expensive canvas work on every re-render (e.g. while panning
  // or zooming the outer tldraw canvas).

  const [pdfDoc, setPdfDoc] = useState(null);
  const [error, setError] = useState(null);
  const [visiblePageCount, setVisiblePageCount] = useState(1);

  // Load the document whenever its source URL changes.
  useEffect(() => {
    let cancelled = false;
    setPdfDoc(null);
    setError(null);
    setVisiblePageCount(1);
    renderedPages.current = new Set();
    canvasRefs.current = {};

    if (!src || typeof src !== "string" || src.trim() === "") {
      // No file attached yet (or a shape created before an upload
      // finished) — nothing to load, and calling pdf.js's getDocument
      // with an empty string throws rather than resolving gracefully.
      return;
    }

    pdfjsLib
      .getDocument({ url: src })
      .promise.then((doc) => {
        if (!cancelled) setPdfDoc(doc);
      })
      .catch((err) => {
        console.error("[PdfShapeUtil] failed to load PDF:", err);
        if (!cancelled) setError("Couldn't load this PDF.");
      });

    return () => {
      cancelled = true;
    };
  }, [src]);

  // Render whichever pages are now in view, skipping any already drawn.
  useEffect(() => {
    if (!pdfDoc) return;
    let cancelled = false;

    const renderPage = async (pageNum) => {
      if (renderedPages.current.has(pageNum)) return;
      const canvas = canvasRefs.current[pageNum];
      if (!canvas) return;

      try {
        const page = await pdfDoc.getPage(pageNum);
        const unscaledViewport = page.getViewport({ scale: 1 });
        const targetWidth = Math.max(1, w - 16); // minus reader's own padding
        const scale =
          (targetWidth / unscaledViewport.width) * RENDER_SCALE_MULTIPLIER;
        const viewport = page.getViewport({ scale });

        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = `${targetWidth}px`;
        canvas.style.height = `${
          targetWidth * (viewport.height / viewport.width)
        }px`;

        const ctx = canvas.getContext("2d");
        await page.render({ canvasContext: ctx, viewport }).promise;

        if (!cancelled) renderedPages.current.add(pageNum);
      } catch (err) {
        console.error(`[PdfShapeUtil] failed to render page ${pageNum}:`, err);
      }
    };

    for (let p = 1; p <= visiblePageCount; p++) {
      renderPage(p);
    }

    return () => {
      cancelled = true;
    };
  }, [pdfDoc, visiblePageCount, w]);

  // Lazily reveal more pages as the reader scrolls near the bottom,
  // instead of rendering an entire long document up front.
  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el || !pdfDoc) return;
    const nearBottom = el.scrollTop + el.clientHeight > el.scrollHeight - 400;
    if (nearBottom && visiblePageCount < pdfDoc.numPages) {
      setVisiblePageCount((c) => Math.min(c + 1, pdfDoc.numPages));
    }
  };

  return (
    <HTMLContainer
      style={{
        width: w,
        height: h,
        background: "#fff",
        border: isEditing ? "2px solid #4f6df5" : "1px solid rgba(0,0,0,0.12)",
        borderRadius: 8,
        boxShadow: isEditing
          ? "0 4px 16px rgba(79,109,245,0.25)"
          : "0 2px 8px rgba(0,0,0,0.08)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        pointerEvents: "all",
      }}
    >
      <div
        style={{
          height: 32,
          flexShrink: 0,
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "0 10px",
          borderBottom: "1px solid rgba(0,0,0,0.08)",
          fontSize: 12,
          fontWeight: 600,
          color: "#334155",
          background: "#f8f9fb",
        }}
      >
        <span
          style={{
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {pdfDoc && (
          <span
            style={{ marginLeft: "auto", color: "#94a3b8", fontWeight: 400 }}
          >
            {pdfDoc.numPages} page{pdfDoc.numPages === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* stopPropagation on pointerdown so clicking to interact doesn't
          also start dragging the shape. Wheel scrolling is handled by
          usePassThroughWheelEvents above instead of a manual handler here.
          Both only take effect while editing — see isEditing comment. */}
      <div
        ref={scrollRef}
        onScroll={isEditing ? handleScroll : undefined}
        onPointerDown={isEditing ? (e) => e.stopPropagation() : undefined}
        style={{
          flex: 1,
          overflowY: isEditing ? "auto" : "hidden",
          overflowX: "hidden",
          padding: 8,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 8,
          position: "relative",
          cursor: isEditing ? "default" : "pointer",
        }}
      >
        {!src && (
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 20 }}>
            No file attached.
          </div>
        )}

        {src && error && (
          <div style={{ color: "#b42318", fontSize: 12, marginTop: 20 }}>
            {error}
          </div>
        )}

        {src && !pdfDoc && !error && (
          <div style={{ color: "#94a3b8", fontSize: 12, marginTop: 20 }}>
            Loading PDF…
          </div>
        )}

        {pdfDoc &&
          Array.from({ length: visiblePageCount }, (_, i) => i + 1).map(
            (pageNum) => (
              <canvas
                key={pageNum}
                ref={(el) => {
                  canvasRefs.current[pageNum] = el;
                }}
                style={{
                  display: "block",
                  boxShadow: "0 1px 3px rgba(0,0,0,0.15)",
                }}
              />
            )
          )}

        {/* Affordance for entering/exiting reading mode */}
        {pdfDoc && !isEditing && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "rgba(255,255,255,0.55)",
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontWeight: 600,
                color: "#334155",
                background: "rgba(255,255,255,0.95)",
                padding: "6px 12px",
                borderRadius: 999,
                boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
              }}
            >
              Double-click to read
            </span>
          </div>
        )}

        {isEditing && (
          <div
            style={{
              position: "sticky",
              bottom: 4,
              alignSelf: "center",
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              background: "rgba(255,255,255,0.95)",
              padding: "3px 10px",
              borderRadius: 999,
              boxShadow: "0 1px 4px rgba(0,0,0,0.12)",
              pointerEvents: "none",
            }}
          >
            Esc or click outside to stop reading
          </div>
        )}
      </div>
    </HTMLContainer>
  );
}
