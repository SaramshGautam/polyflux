import React, { useMemo, useRef, useState, useEffect } from "react";
import { Tldraw, DefaultToolbar, DefaultToolbarContent } from "tldraw";

/** A lightweight floating TLDraw scratchpad */
export function MiniWhiteboard({
  shapeUtils,
  bindingUtils,
  tools,
  onClose,
  initial = { w: 420, h: 280, right: 16, bottom: 16 },
}) {
  const containerRef = useRef(null);
  const [pos, setPos] = useState({
    right: initial.right,
    bottom: initial.bottom,
  });
  const [size, setSize] = useState({ w: initial.w, h: initial.h });
  const [drag, setDrag] = useState(null);

  // simple drag for the header
  const dragPending = useRef(false);
  useEffect(() => {
    function onMove(e) {
      if (!drag) return;
      if (dragPending.current) return;
      dragPending.current = true;

      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      requestAnimationFrame(() => {
        setPos({
          right: Math.max(8, drag.startRight - dx),
          bottom: Math.max(8, drag.startBottom - dy),
        });
        dragPending.current = false;
      });
    }
    function onUp() {
      setDrag(null);
    }

    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [drag]);

  // inline styles to keep this self-contained
  const containerStyle = {
    position: "fixed",
    right: pos.right,
    bottom: pos.bottom,
    width: size.w,
    height: size.h,
    zIndex: 9999,
    background: "white",
    borderRadius: 10,
    boxShadow: "0 12px 24px rgba(0,0,0,.18)",
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    border: "1px solid rgba(0,0,0,.06)",
  };

  const headerStyle = {
    height: 36,
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "0 10px",
    cursor: "grab",
    userSelect: "none",
    background: "linear-gradient(180deg, #fff, #f7f7f7)",
    borderBottom: "1px solid rgba(0,0,0,.06)",
    fontSize: 13,
    fontWeight: 600,
  };

  const bodyStyle = { flex: 1, minHeight: 140, position: "relative" };

  const resizeHandleStyle = {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: 16,
    height: 16,
    cursor: "nwse-resize",
    background: "transparent",
  };

  // basic corner resize (drag from bottom-right)
  const resizePending = useRef(false);
  function startResize(e) {
    e.preventDefault();
    const startX = e.clientX;
    const startY = e.clientY;
    const startW = size.w;
    const startH = size.h;

    function onMove(ev) {
      if (resizePending.current) return;
      resizePending.current = true;

      const w = Math.max(280, startW + (ev.clientX - startX));
      const h = Math.max(180, startH + (ev.clientY - startY));
      setSize({ w, h });
      resizePending.current = false;
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  return (
    <div ref={containerRef} style={containerStyle}>
      <div
        style={headerStyle}
        onMouseDown={(e) =>
          setDrag({
            startX: e.clientX,
            startY: e.clientY,
            startRight: pos.right,
            startBottom: pos.bottom,
          })
        }
      >
        <span>Scratchpad</span>
        <button
          onClick={onClose}
          style={{
            border: "1px solid rgba(0,0,0,.08)",
            background: "white",
            borderRadius: 6,
            fontSize: 12,
            padding: "4px 8px",
            cursor: "pointer",
          }}
          aria-label="Close scratchpad"
        >
          Close
        </button>
      </div>

      <div style={bodyStyle}>
        <Tldraw
          // Local (ephemeral) board: no store prop, no sync
          shapeUtils={shapeUtils}
          bindingUtils={bindingUtils}
          tools={tools}
          components={{
            Toolbar: (props) => (
              <div
                style={{
                  transform: "scale(0.8)",
                  transformOrigin: "bottom",
                }}
              >
                <DefaultToolbar {...props}>
                  <DefaultToolbarContent />
                </DefaultToolbar>
              </div>
            ),
            PageMenu: () => null,
          }}
        />
        <div style={resizeHandleStyle} onMouseDown={startResize} />
      </div>
    </div>
  );
}
