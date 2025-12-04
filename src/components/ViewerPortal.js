import React, { useEffect, useMemo, useRef, useState } from "react";
import { Tldraw } from "tldraw";
import { collection, doc, onSnapshot, getDocs } from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useSync } from "@tldraw/sync";

export default function ViewerPortal({
  roomMeta,
  roomId,
  shapeUtils,
  bindingUtils,
  tools,
  onClose,
}) {
  const viewStore = useSync({
    uri: `https://tldraw-sync-server.saramshgautam.workers.dev/connect/${roomId}`,
    roomId,
    shapeUtils,
    bindingUtils,
  });

  const { className, projectName, teamName } = roomMeta;
  const [peers, setPeers] = useState([]);
  const [targetUid, setTargetUid] = useState(null);
  const [mode, setMode] = useState("viewport");

  const miniRef = useRef(null);
  //   const desiredCamRef = useRef({ x: 0, y: 0, z: 1 });
  //   const desiredPageRef = useRef(null);
  const desiredRef = useRef({
    camera: { x: 0, y: 0, z: 1 },
    pageId: null,
    cursor: null,
    viewport: null,
  });

  const rafRef = useRef(null);

  // Active peers (every 4s)
  useEffect(() => {
    let stop = false;
    const presCol = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "presence"
    );
    const tick = async () => {
      if (stop) return;
      const snap = await getDocs(presCol);
      const now = Date.now();
      const list = snap.docs
        .map((d) => ({ uid: d.id, ...d.data() }))
        .filter(
          (p) => p.lastActive?.toMillis && now - p.lastActive.toMillis() < 20000
        );
      setPeers(list);
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [className, projectName, teamName]);

  // Subscribe to target presence but DO NOT setCamera here
  useEffect(() => {
    if (!targetUid) return;
    const presDoc = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "presence",
      targetUid
    );
    const unsub = onSnapshot(presDoc, (d) => {
      const data = d.data();
      if (!data) return;
      desiredRef.current = {
        camera: data.camera || desiredRef.current.camera,
        pageId: data.pageId || desiredRef.current.pageId,
        cursor: data.cursor || null,
        viewport: data.viewport || null,
      };

      //   if (data.camera) desiredCamRef.current = data.camera;
      //   if (data.pageId) desiredPageRef.current = data.pageId;
    });
    return () => unsub();
  }, [targetUid, className, projectName, teamName]);

  function cameraFromViewport(otherCam, otherViewport, viewW, viewH) {
    // other world extents
    const worldW = otherViewport.w / otherCam.z;
    const worldH = otherViewport.h / otherCam.z;
    // center of other viewport in world
    const otherCenter = {
      x: otherCam.x + worldW / 2,
      y: otherCam.y + worldH / 2,
    };
    // choose a zoom so their whole viewport fits inside ours
    const zFit = Math.min(viewW / worldW, viewH / worldH);
    // new top-left to keep centers aligned
    const x = otherCenter.x - viewW / (2 * zFit);
    const y = otherCenter.y - viewH / (2 * zFit);
    return { x, y, z: zFit };
  }

  // Single animation loop to apply camera changes smoothly and sparsely
  useEffect(() => {
    const ed = miniRef.current;
    if (!ed) return;

    const container = () => ed.getViewportScreenBounds?.();
    let lastPageId = ed.getCurrentPageId?.();
    const k = 0.28;
    const eps = 0.4,
      zeps = 0.001;

    function step() {
      rafRef.current = requestAnimationFrame(step);

      const d = desiredRef.current;
      if (d.pageId && d.pageId !== lastPageId) {
        try {
          ed.setCurrentPage?.(d.pageId);
          lastPageId = d.pageId;
        } catch {}
      }

      const vsb = container();
      const viewW = vsb?.width || 360;
      const viewH = vsb?.height || 240;

      let targetCam;

      if (mode === "viewport" && d.viewport) {
        // Show the *entire* other user's viewport inside our viewer
        targetCam = cameraFromViewport(d.camera, d.viewport, viewW, viewH);
      } else if (mode === "cursor" && d.cursor) {
        // Center on other user's cursor; inherit their zoom for “feel”
        const z = d.camera?.z ?? 1;
        const x = d.cursor.x - viewW / (2 * z);
        const y = d.cursor.y - viewH / (2 * z);
        targetCam = { x, y, z };
      } else {
        // fallback: mirror their camera
        targetCam = d.camera || ed.getCamera();
      }

      const cam = ed.getCamera();
      const nx = cam.x + (targetCam.x - cam.x) * k;
      const ny = cam.y + (targetCam.y - cam.y) * k;
      const nz = cam.z + (targetCam.z - cam.z) * k;

      if (
        Math.abs(nx - cam.x) > eps ||
        Math.abs(ny - cam.y) > eps ||
        Math.abs(nz - cam.z) > zeps
      ) {
        ed.setCamera({ x: nx, y: ny, z: nz });
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [mode]);

  const components = useMemo(
    () => ({
      MainMenu: () => null,
      PageMenu: () => null,
      ActionsMenu: () => null,
      Toolbar: () => null,
    }),
    []
  );

  return (
    <div
      style={{
        position: "fixed",
        right: 16,
        bottom: 16,
        width: 360,
        height: 240,
        background: "white",
        borderRadius: 12,
        boxShadow: "0 12px 24px rgba(0,0,0,.18)",
        border: "1px solid rgba(0,0,0,.08)",
        overflow: "hidden",
        zIndex: 10050,
        display: "flex",
        flexDirection: "column",
        contain: "layout paint size",
        transform: "translateZ(0)",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "0 10px",
          borderBottom: "1px solid rgba(0,0,0,.06)",
          background: "linear-gradient(180deg,#fff,#f7f7f7)",
        }}
      >
        <strong style={{ fontSize: 13 }}>Viewer</strong>
        <select
          value={targetUid || ""}
          onChange={(e) => setTargetUid(e.target.value || null)}
          style={{ marginLeft: 8, flex: 1 }}
        >
          <option value="">Select a user to follow…</option>
          {peers.map((p) => (
            <option key={p.uid} value={p.uid}>
              {p.displayName || p.uid.slice(0, 6)}
            </option>
          ))}
        </select>
        <select
          value={mode}
          onChange={(e) => setMode(e.target.value)}
          style={{ fontSize: 12 }}
        >
          <option value="viewport">Viewport</option>
          <option value="cursor">Cursor</option>
        </select>
        <button
          onClick={onClose}
          style={{ padding: "4px 8px", borderRadius: 6 }}
        >
          Close
        </button>
      </div>

      <div style={{ position: "relative", flex: 1 }}>
        <Tldraw
          store={viewStore} // ok to share, see Fix 3 if still flickers
          shapeUtils={shapeUtils}
          bindingUtils={bindingUtils}
          tools={tools}
          components={components}
          onMount={(ed) => {
            miniRef.current = ed;
            try {
              ed.updateInstanceState?.({ isReadonly: true });
              ed.setCurrentTool?.("hand");
            } catch {}
          }}
        />
      </div>
    </div>
  );
}
