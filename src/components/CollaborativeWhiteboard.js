import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Tldraw,
  DefaultToolbar,
  DefaultStylePanel,
  TldrawUiMenuItem,
  useTools,
  useIsToolSelected,
  DefaultToolbarContent,
  defaultTools,
  createTLStore,
  defaultShapeUtils,
  createTLSchema,
  defaultBindingUtils,
  useEditor,
  useValue,
  createShapeId,
} from "tldraw";
import { useSync } from "@tldraw/sync";
import "tldraw/tldraw.css";
import { useParams } from "react-router-dom";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faMicrophone,
  faRobot,
  faCircle,
  faCircleStop,
  faFilePdf,
} from "@fortawesome/free-solid-svg-icons";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  orderBy,
  query,
  setDoc,
  serverTimestamp,
  onSnapshot,
} from "firebase/firestore";

import { app, db, auth, storage } from "../firebaseConfig";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import Navbar from "./navbar/Navbar";
import ChatBot from "./ChatBot";
import ChatSidebar from "./chatsidebar/ChatSidebar";
import CustomContextMenu from "./CustomContextMenu";
import HistoryCommentPanel from "./HistoryCommentPanel";
import ToggleExpandButton from "./ToggleExpandButton";
import ContextToolbarComponent from "./ContextToolbarComponent";
import { AudioShapeUtil } from "../shapes/AudioShapeUtil";
import { PdfShapeUtil } from "../shapes/Pdfshapeutil";
import { MicrophoneTool } from "../tools/MicrophoneTool";
import CustomActionsMenu from "./CustomActionsMenu";
import { upsertImageUrl } from "../utils/registershapes";
import { createToggleRecorder } from "../utils/audioRecorder";
import { useCanvasActionHistory } from "./useCanvasActionHistory";
import RobotDock from "./RobotDock";
import UnderExploreDivegence from "../assets/UnderExploreDivegence.mp4";
import LongRunningDivergence from "../assets/LongRunningDivergence.mp4";
import EarlyConvergence from "../assets/EarlyConvergence.mp4";
import RefinementLoop from "../assets/RefinementLoop.mp4";
import LongLull from "../assets/LongLull.mp4";
import ParticipationImbalance from "../assets/ParticipationImbalance.mp4";
import DefaultMp4 from "../assets/Default.mp4";
import { CustomNavigationPanel } from "./CustomNavigationPanel";
import PhaseNudgeBadges from "./whiteboard/PhaseNudgeBadges";
import { createNamedNoteShapeUtil } from "./NamedNoteShapeUtil";
import { createNamedShapeUtils } from "./NamedShapeUtils";
import { UserContext } from "./UserContext";
import SessionSpeechCapture from "./whiteboard/SessionSpeechCapture";
import CanvasPortal from "./canvashelpers/CanvasPortal";
import PortalSuckOverlay from "./PortalSuckOverlay";
import { restoreShapeMetadata } from "../utils/registershapes";

import {
  resolveImageUrl,
  extractShapeText,
  makeSelectionSummary,
  buildAiPayloadFromSelection,
} from "./helpers/askai";
import { useProactiveNudges } from "./whiteboard/UseProactiveNudge";

const CUSTOM_TOOLS = [MicrophoneTool];
const BINDING_UTILS = [...defaultBindingUtils];

function useCameraPresence(
  editorRef,
  { className, projectName, teamName, enabled = true }
) {
  const lastWrite = useRef(0);
  const rafRef = useRef(null);

  useEffect(() => {
    if (!enabled) return;

    const editor = editorRef.current;
    const user = auth.currentUser;
    if (!editor || !user) return;

    const presRef = doc(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "presence",
      user.uid
    );

    let prev = "";
    const loop = () => {
      rafRef.current = requestAnimationFrame(loop);
      if (document.hidden) return;

      const now = performance.now();
      if (now - lastWrite.current < 120) return;
      lastWrite.current = now;

      const cam = editor.getCamera();
      const pageId = editor.getCurrentPageId?.();

      const cp = editor.inputs?.currentPagePoint;
      const cursor = cp ? { x: Number(cp.x) || 0, y: Number(cp.y) || 0 } : null;

      const vsb = editor.getViewportScreenBounds?.();
      const viewport = vsb
        ? {
            w: Math.max(0, Math.round(vsb.width)),
            h: Math.max(0, Math.round(vsb.height)),
          }
        : null;

      const payloadObj = {
        camera: {
          x: Number(cam.x) || 0,
          y: Number(cam.y) || 0,
          z: Number(cam.z) || 1,
        },
        pageId: pageId || null,
        cursor,
        viewport,
        displayName: user.displayName || user.email || "anon",
        email: user.email || null,
        photoURL: user.photoURL || null,
      };

      const payload = JSON.stringify(payloadObj);
      if (payload === prev) return;
      prev = payload;

      setDoc(
        presRef,
        { ...payloadObj, lastActive: serverTimestamp() },
        { merge: true }
      ).catch((e) => {
        console.error("[presence] write failed", e);
      });
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, editorRef, className, projectName, teamName]);
}

const TRIGGER_TO_VIDEO = {
  stagnant_divergence: UnderExploreDivegence,
  scattered_divergence: LongRunningDivergence,
  early_convergence: EarlyConvergence,
  refinement_loop: RefinementLoop,
  long_lull: LongLull,
  participation_imbalance_group: ParticipationImbalance,
};

const TRIGGER_TO_PHASE = {
  stagnant_divergence: "divergent",
  scattered_divergence: "divergent",
  early_convergence: "convergent",
  refinement_loop: "convergent",
  long_lull: "divergent",
  participation_imbalance_group: "convergent",
};

function normalizeShapeId(id) {
  if (!id) return id;
  return id.startsWith("shape:") ? id : `shape:${id}`;
}

function useShapeCreatedByMap(db, classroomId, projectId, teamName) {
  const [shapeActorIdByShapeId, setShapeActorIdByShapeId] = useState({});

  useEffect(() => {
    if (!db || !classroomId || !projectId || !teamName) return;

    const shapesCol = collection(
      db,
      "classrooms",
      classroomId,
      "Projects",
      projectId,
      "teams",
      teamName,
      "shapes"
    );

    const unsub = onSnapshot(shapesCol, (snap) => {
      const next = {};
      snap.forEach((doc) => {
        const data = doc.data();
        const shapeId = normalizeShapeId(data.shapeId || doc.id);
        const createdBy = data.createdBy;
        if (shapeId && createdBy) next[shapeId] = createdBy;
      });
      setShapeActorIdByShapeId(next);
    });

    return () => unsub();
  }, [db, classroomId, projectId, teamName]);

  return shapeActorIdByShapeId;
}

function HoverActionBadge({ onIconClick }) {
  const editor = useEditor();

  const hoveredId = useValue(
    "hovered shape id",
    () => editor.getHoveredShapeId?.() ?? null,
    [editor]
  );

  const selectedIds = useValue(
    "selected ids",
    () => editor.getSelectedShapeIds(),
    [editor]
  );

  const [visibleId, setVisibleId] = useState(null);
  useEffect(() => {
    const t = setTimeout(() => setVisibleId(hoveredId), hoveredId ? 120 : 0);
    return () => clearTimeout(t);
  }, [hoveredId]);

  const isBusy =
    editor?.inputs?.isDragging ||
    editor?.inputs?.isPanning ||
    Boolean(editor?.getEditingShapeId?.());

  if (!isBusy && selectedIds.length > 1) {
    const bounds =
      editor.getSelectionPageBounds?.() ??
      editor.getSelectedPageBounds?.() ??
      null;
    if (!bounds) return null;

    const pagePoint = { x: bounds.maxX + 12, y: bounds.minY };
    const screenPoint = editor.pageToScreen?.(pagePoint) ?? pagePoint;

    return (
      <div
        style={{
          position: "fixed",
          left: screenPoint.x,
          top: screenPoint.y,
          pointerEvents: "none",
        }}
      >
        <button
          className="tlui-button tlui-button--icon"
          onClick={(e) => {
            e.stopPropagation();
            onIconClick?.(null);
          }}
          style={{
            pointerEvents: "auto",
            width: 140,
            height: 38,
            borderRadius: 5,
            background: "white",
            boxShadow: "0 6px 16px rgba(0,0,0,.2)",
            display: "grid",
            placeItems: "center",
            opacity: 0.9,
          }}
          title={`Ask AI about ${selectedIds.length} items`}
        >
          <span>
            <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} /> Ask AI (
            {selectedIds.length})
          </span>
        </button>
      </div>
    );
  }

  if (!visibleId || isBusy) return null;

  const isSelected = selectedIds.includes(visibleId);
  if (isSelected) return null;

  const pageBounds =
    editor.getShapePageBounds?.(visibleId) ??
    editor.getPageBounds?.(visibleId) ??
    null;
  if (!pageBounds) return null;

  const anchorPage = { x: pageBounds.maxX - 20, y: pageBounds.minY };
  const anchorScreen = editor.pageToScreen?.(anchorPage) ?? anchorPage;

  return (
    <div
      style={{
        position: "fixed",
        left: anchorScreen.x + 12,
        top: anchorScreen.y,
        pointerEvents: "none",
      }}
    >
      <button
        className="tlui-button tlui-button--icon"
        onClick={(e) => {
          e.stopPropagation();
          editor.setSelectedShapes?.([visibleId]);
          onIconClick?.(visibleId);
        }}
        style={{
          pointerEvents: "auto",
          width: 120,
          height: 38,
          borderRadius: 5,
          background: "white",
          boxShadow: "0 6px 16px rgba(0,0,0,.2)",
          display: "grid",
          placeItems: "center",
          opacity: 0.8,
        }}
        title="Quick Ask AI"
      >
        <span>
          <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} /> Ask AI
        </span>
      </button>
    </div>
  );
}

function SelectionLogger({ selectionModeActive, roomMeta, upsertImageUrlFn }) {
  const editor = useEditor();
  const prevIdsRef = useRef([]);

  const selectedIds = useValue(
    "selected ids",
    () => editor.getSelectedShapeIds(),
    [editor]
  );

  useEffect(() => {
    const editingId = editor.getEditingShapeId?.();
    if (editingId) {
      prevIdsRef.current = selectedIds;
      return;
    }

    if (selectionModeActive) {
      const prev = new Set(prevIdsRef.current);
      const curr = new Set(selectedIds);
      const newlySelected = [...curr].filter((id) => !prev.has(id));

      if (newlySelected.length) {
        const clips = newlySelected
          .map((id) => {
            const shape = editor.getShape(id);
            if (!shape) return null;

            const isImage = shape.type === "image";
            const url = isImage ? resolveImageUrl(editor, shape) : null;
            const text = extractShapeText(shape);

            return {
              id: shape.id,
              snip: isImage ? url || "" : text || "",
              kind: isImage ? "image" : "note",
            };
          })
          .filter(Boolean);

        if (clips.length) {
          window.dispatchEvent(
            new CustomEvent("chatbot-add-clip", { detail: { clips } })
          );
        }
      }
    }

    selectedIds.forEach((id) => {
      const shape = editor.getShape(id);
      if (!shape || shape.type !== "image") return;

      const url = resolveImageUrl(editor, shape);
      if (!url) return;

      if (/^https?:\/\//i.test(url)) {
        upsertImageUrlFn?.(roomMeta, shape.id, url).then((firebaseUrl) => {
          if (!firebaseUrl) return;
          const current = editor.getShape(shape.id);
          if (!current) return;
          editor.updateShape({
            id: current.id,
            type: "image",
            props: { ...current.props, url: firebaseUrl },
          });
        });
      }
    });

    prevIdsRef.current = selectedIds;
  }, [selectedIds, editor, selectionModeActive, roomMeta, upsertImageUrlFn]);

  return null;
}

const CollaborativeWhiteboard = () => {
  const { className, projectName, teamName } = useParams();
  const [externalMessages, setExternalMessages] = useState([]);
  const [shapeReactions, setShapeReactions] = useState({});
  const [selectedShape, setSelectedShape] = useState(null);
  const [selectedTargets, setSelectedTargets] = useState([]);

  const [commentCounts, setCommentCounts] = useState({});
  const [comments, setComments] = useState({});
  const [userRole, setUserRole] = useState(null);
  const editorInstance = useRef(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [messages, setMessages] = useState([]);
  const [shapesForAnalysis, setShapesForAnalysis] = useState([]);
  const [speechForAnalysis, setSpeechForAnalysis] = useState([]);

  const recorderRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState(null);
  const [elapsed, setElapsed] = useState("0:00");

  const [showMini, setShowMini] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [editorReady, setEditorReady] = useState(false);

  const [sessionActors, setSessionActors] = useState([]);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  const [aiEnabled, setAiEnabled] = useState(true);

  const prevSpeechCountRef = useRef(0);
  const speechBootstrapDoneRef = useRef(false);

  const [canvasMode, setCanvasMode] = useState("public");
  const currentUserId =
    auth.currentUser?.uid || auth.currentUser?.email || "anon";
  const isPublicMode = canvasMode === "public";

  const [isDraggingSelection, setIsDraggingSelection] = useState(false);
  const [isPortalDropReady, setIsPortalDropReady] = useState(false);

  const pendingPublishShapesRef = useRef(null);
  const pointerScreenRef = useRef({ x: 0, y: 0 });
  const dragGhostElRef = useRef(null);
  const dragGhostImgUrlRef = useRef(null);
  const dragGhostCaptureInFlightRef = useRef(false);
  const dragGhostShapeIdsRef = useRef([]);
  const wasDraggingRef = useRef(false);

  const PORTAL_PULL_RADIUS = 260; // px — distance at which shrinking starts
  const PORTAL_MIN_SCALE = 0.12; // smallest the ghost shrinks to at dead-center

  const exportSelectionSvg = useCallback(async (editor, ids) => {
    try {
      const exportSvg = editor.getSvgString
        ? (i, o) => editor.getSvgString(i, o).then((r) => r?.svg ?? null)
        : editor.getSvg
        ? (i, o) =>
            editor
              .getSvg(i, o)
              .then((el) =>
                el ? new XMLSerializer().serializeToString(el) : null
              )
        : null;
      if (!exportSvg) return null;
      return await exportSvg(ids, { background: false, padding: 8 });
    } catch (err) {
      console.error("[portal] drag-ghost snapshot failed:", err);
      return null;
    }
  }, []);

  const clearDimmedShapes = useCallback(() => {
    dragGhostShapeIdsRef.current.forEach((id) => {
      try {
        const el = document.querySelector(`[data-shape-id="${id}"]`);
        if (el) el.style.opacity = "";
      } catch {}
    });
    dragGhostShapeIdsRef.current = [];
  }, []);

  const portalDropReadyRef = useRef(false);
  useEffect(() => {
    portalDropReadyRef.current = isPortalDropReady;
  }, [isPortalDropReady]);

  const [portalSuckEffect, setPortalSuckEffect] = useState(null);

  const [portalArrivalPulse, setPortalArrivalPulse] = useState(null);

  const handleSuckAnimationDone = useCallback(() => {
    setPortalArrivalPulse(Date.now());
    setPortalSuckEffect((prev) => {
      if (prev?.imgUrl) URL.revokeObjectURL(prev.imgUrl);
      return null;
    });
  }, []);

  const [selectionModeActive, setSelectionModeActive] = useState(false);

  const [phaseTailShapeIds, setPhaseTailShapeIds] = useState([]);

  const [nudgeFocusShapeId, setNudgeFocusShapeId] = useState(null);
  // Tells ContextToolbarComponent (rendered inside tldraw's
  // InFrontOfTheCanvas slot) to open its comment box for this shape once
  // selection catches up to it — set from the Comments panel's click
  // handler, cleared once consumed.
  const [commentFocusShapeId, setCommentFocusShapeId] = useState(null);
  const [currentPhaseName, setCurrentPhaseName] = useState(null);
  const [currentPhaseDetail, setCurrentPhaseDetail] = useState(null);
  const [isPhasePulsing, setIsPhasePulsing] = useState(false);
  const [phaseNudgePreview, setPhaseNudgePreview] = useState("");

  const [robotSrc, setRobotSrc] = useState(DefaultMp4);
  const [robotLoop, setRobotLoop] = useState(true);
  const [robotPhase, setRobotPhase] = useState(null);
  const ROBOT_GAP_PX = 10;
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const ROBOT_SIZE = 50;

  const [robotPosition, setRobotPosition] = useState({ left: 16, bottom: 158 });

  const actorLabelById = useMemo(() => {
    const m = {};
    (sessionActors || []).forEach((a) => {
      m[a.id] = a.label || a.email || a.id;
    });
    return m;
  }, [sessionActors]);

  const shapeActorIdByShapeId = useShapeCreatedByMap(
    db,
    className,
    projectName,
    teamName
  );

  const shapeActorIdByShapeIdRef = useRef({});
  useEffect(() => {
    shapeActorIdByShapeIdRef.current = shapeActorIdByShapeId || {};
  }, [shapeActorIdByShapeId]);

  const actorLabelByIdRef = useRef({});
  useEffect(() => {
    actorLabelByIdRef.current = actorLabelById || {};
  }, [actorLabelById]);

  const shapeUtilsMemo = useMemo(() => {
    const getActorLabelForShape = (shapeId) => {
      const actorId = shapeActorIdByShapeIdRef.current?.[shapeId];
      if (!actorId) return null;
      return actorLabelByIdRef.current?.[actorId] || actorId;
    };

    const { NamedNote, NamedText, NamedImage } = createNamedShapeUtils({
      getActorLabelForShape,
    });

    return [
      ...defaultShapeUtils.filter(
        (u) => !["note", "text", "image"].includes(u.type)
      ),
      NamedNote,
      NamedText,
      NamedImage,
      AudioShapeUtil,
      PdfShapeUtil,
    ];
  }, []);

  useEffect(() => {
    if (!editorReady) return;

    let el = null;
    let ro = null;
    let raf = 0;

    const update = () => {
      if (!el) return;

      const rect = el.getBoundingClientRect();

      const left = Math.round(rect.left);
      const top = Math.round(rect.top - ROBOT_GAP_PX - ROBOT_SIZE);

      const safeLeft = Math.max(
        8,
        Math.min(left, window.innerWidth - ROBOT_SIZE - 8)
      );
      const safeTop = Math.max(8, top);

      setRobotPosition({ left: safeLeft, top: safeTop });
    };

    const bind = () => {
      el = document.querySelector('[data-navpanel="true"]');
      if (!el) return false;

      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
      ro.observe(el);

      window.addEventListener("resize", update);

      update();
      return true;
    };

    if (!bind()) {
      const id = setInterval(() => {
        if (bind()) clearInterval(id);
      }, 150);
      return () => clearInterval(id);
    }

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", update);
      ro?.disconnect?.();
    };
    // canvasMode is included here (not just editorReady) because
    // <Tldraw key={canvasMode}> fully remounts on every switch, which
    // destroys and recreates the [data-navpanel="true"] node. Without
    // this, the ResizeObserver above keeps watching the old, now-detached
    // node forever, robotPosition freezes at its last value, and the dock
    // ends up pinned somewhere stale (looking like it vanished) instead
    // of tracking the freshly mounted nav panel.
  }, [editorReady, canvasMode]);

  const lastTriggerRef = useRef(null);
  const NUDGE_COOLDOWN_MS = 120_000;

  const autoGlobalCooldownUntilRef = useRef(0);

  const autoTriggerCooldownMapRef = useRef({});

  const [robotCountdownEndsAt, setRobotCountdownEndsAt] = useState(null);

  const triggerLoopTimerRef = useRef(null);

  const actorIdRef = useRef("anon");
  useEffect(() => {
    actorIdRef.current =
      auth.currentUser?.displayName || auth.currentUser?.email || "anon";
  }, []);

  const stampingRef = useRef(false);

  useEffect(() => {
    if (!editorReady) return;
    const editor = editorInstance.current;
    if (!editor) return;

    const unlisten = editor.store.listen(
      (entry) => {
        if (stampingRef.current) return;

        const actorId = actorIdRef.current;

        const added = entry?.changes?.added
          ? Object.values(entry.changes.added)
          : [];
        const updated = entry?.changes?.updated
          ? Object.values(entry.changes.updated)
          : [];

        const maybeStamp = (rec) => {
          if (!rec) return;
          const isShapeRecord =
            rec.typeName === "shape" ||
            rec.type === "shape" ||
            rec.kind === "shape";
          if (!isShapeRecord) return;

          const ownerId =
            auth.currentUser?.uid || auth.currentUser?.email || "anon";

          const shape = editor.getShape(rec.id);
          if (!shape) return;

          const nextMeta = { ...(shape.meta || {}) };

          if (!nextMeta.createdBy) nextMeta.createdBy = actorId;
          nextMeta.updatedBy = actorId;
          nextMeta.updatedAt = Date.now();

          if (!nextMeta.ownerId) {
            nextMeta.ownerId = ownerId;
          }

          const same =
            shape.meta?.createdBy === nextMeta.createdBy &&
            shape.meta?.updatedBy === nextMeta.updatedBy &&
            shape.meta?.updatedAt === nextMeta.updatedAt;

          if (same) return;

          stampingRef.current = true;
          try {
            editor.updateShape({
              id: shape.id,
              type: shape.type,
              meta: nextMeta,
            });
          } finally {
            setTimeout(() => {
              stampingRef.current = false;
            }, 0);
          }
        };

        for (const rec of added) maybeStamp(rec);

        for (const rec of updated) maybeStamp(rec);
      },
      { scope: "user" }
    );

    return () => {
      try {
        unlisten?.();
      } catch {}
    };
  }, [editorReady]);

  const revertRobotToDefault = useCallback(() => {
    if (triggerLoopTimerRef.current) {
      clearTimeout(triggerLoopTimerRef.current);
      triggerLoopTimerRef.current = null;
    }
    setRobotLoop(true);
    setRobotSrc(DefaultMp4);
    setRobotPhase(null);
    setRobotCountdownEndsAt(null);
    lastTriggerRef.current = null;
  }, []);

  const TRIGGER_DURATION_MS = 30000;

  const playTriggerAnimation = useCallback(
    (triggerId) => {
      if (!triggerId) return;

      lastTriggerRef.current = triggerId;

      const vid = TRIGGER_TO_VIDEO[triggerId];
      if (!vid) return;

      if (triggerLoopTimerRef.current) {
        clearTimeout(triggerLoopTimerRef.current);
        triggerLoopTimerRef.current = null;
      }

      lastTriggerRef.current = triggerId;
      setRobotPhase(TRIGGER_TO_PHASE[triggerId] || null);

      const endsAt = Date.now() + TRIGGER_DURATION_MS;
      setRobotCountdownEndsAt(endsAt);

      setRobotSrc(vid);
      setRobotLoop(true);

      triggerLoopTimerRef.current = setTimeout(() => {
        revertRobotToDefault();
      }, TRIGGER_DURATION_MS);
    },
    [revertRobotToDefault]
  );

  const handlePortalToggle = useCallback(() => {
    setCanvasMode((prev) => (prev === "public" ? "private" : "public"));
  }, []);

  const roomId = useMemo(
    () =>
      className && projectName && teamName
        ? `collaBoard-${className}-${projectName}-${teamName}`
        : null,
    [className, projectName, teamName]
  );

  const store = useSync({
    uri: roomId
      ? `https://tldraw-sync-server.saramshgautam.workers.dev/connect/${roomId}`
      : "",
    roomId: roomId || "",
    shapeUtils: shapeUtilsMemo,
    bindingUtils: BINDING_UTILS,
  });

  // Give the private canvas its own synced room, scoped to this user and
  // this team room, instead of a local-only createTLStore(). This is what
  // makes the private canvas (a) survive a page reload and (b) actually
  // have something in it for the CanvasPortal preview to show.
  const privateRoomId = useMemo(
    () => (roomId ? `${roomId}-private-${currentUserId}` : ""),
    [roomId, currentUserId]
  );

  const privateStore = useSync({
    uri: privateRoomId
      ? `https://tldraw-sync-server.saramshgautam.workers.dev/connect/${privateRoomId}`
      : "",
    roomId: privateRoomId,
    shapeUtils: shapeUtilsMemo,
    bindingUtils: BINDING_UTILS,
  });

  const getPortalRect = useCallback(() => {
    const el = document.querySelector('[data-canvas-portal="true"]');
    return el ? el.getBoundingClientRect() : null;
  }, []);

  const isPointNearPortal = useCallback(
    (x, y) => {
      const rect = getPortalRect();
      if (!rect) return false;

      const expand = 90;
      return (
        x >= rect.left - expand &&
        x <= rect.right + expand &&
        y >= rect.top - expand &&
        y <= rect.bottom + expand
      );
    },
    [getPortalRect]
  );

  // Works from either side of the portal: whichever canvas is currently
  // mounted (canvasMode) is the source, and the other one is always the
  // destination. Previously this was hardcoded private->public only; the
  // only truly direction-specific pieces are the destination mode itself
  // and a couple of metadata tags, both computed below.
  const publishSelectionAcrossPortal = useCallback(
    async (shapeIds) => {
      const editor = editorInstance.current;
      if (!editor || !shapeIds?.length) return;

      const sourceMode = canvasMode;
      const destinationMode = sourceMode === "private" ? "public" : "private";

      const shapes = shapeIds.map((id) => editor.getShape(id)).filter(Boolean);
      if (!shapes.length) return;

      // Anchor point for relative layout: center of the whole selection in
      // PAGE space on the source canvas. Every shape's offset from this
      // center is preserved so a multi-shape selection keeps its layout
      // when it reappears on the destination canvas — recentered around
      // wherever that canvas's own viewport happens to be looking, computed
      // later in onMount using the DESTINATION editor's viewport (using
      // THIS editor's viewport was the earlier bug — it placed shapes
      // based on the source canvas's camera, unrelated to where anyone
      // is looking on the destination side).
      const selBoundsForLayout =
        editor.getSelectionPageBounds?.() ?? editor.getSelectedPageBounds?.();
      const groupCenterX = selBoundsForLayout
        ? (selBoundsForLayout.minX + selBoundsForLayout.maxX) / 2
        : shapes[0]?.x ?? 0;
      const groupCenterY = selBoundsForLayout
        ? (selBoundsForLayout.minY + selBoundsForLayout.maxY) / 2
        : shapes[0]?.y ?? 0;

      // Snapshot each shape's CURRENT Firestore metadata before touching
      // anything. If something else in the app deletes the Firestore doc
      // in response to editor.deleteShapes() below (a generic "shape
      // removed" listener elsewhere, not something this file controls),
      // this is our only copy of createdBy/createdAt/comments/reactions —
      // we'll write it back explicitly once the shape exists again on the
      // public side, as the very last step, so it always wins.
      const firestoreMetaByShapeId = {};
      try {
        await Promise.all(
          shapeIds.map(async (id) => {
            const ref = doc(
              db,
              "classrooms",
              className,
              "Projects",
              projectName,
              "teams",
              teamName,
              "shapes",
              id
            );
            const snap = await getDoc(ref);
            if (snap.exists()) {
              const data = snap.data();
              firestoreMetaByShapeId[id] = {
                createdBy: data.createdBy,
                createdAt: data.createdAt,
                comments: data.comments,
                reactions: data.reactions,
              };
            }
          })
        );
      } catch (err) {
        console.error(
          "[portal] failed to snapshot Firestore metadata before publish:",
          err
        );
      }

      const preparedShapes = shapes.map((shape) => ({
        ...shape,
        // Reusing the ORIGINAL id instead of minting a new one with
        // createShapeId(). Private and public canvases are separate sync
        // rooms with independent id namespaces, so this can't collide.
        // Keeping the id means anything keyed by shapeId outside tldraw
        // itself (e.g. a Firestore "shapes" collection) keeps pointing at
        // the same key instead of silently switching ids on publish.
        id: shape.id,
        meta: {
          ...(shape.meta || {}),
          publishedFromPortal: true,
          publishedFromMode: sourceMode,
          publishedAt: Date.now(),
        },
      }));

      // Snapshot the selection as an image + capture its on-screen rect
      // BEFORE deleting anything, so the fly-into-the-portal clone is an
      // exact match for what the user was just looking at.
      let suckImgUrl = null;
      let startRect = null;
      try {
        if (selBoundsForLayout) {
          const p1 = editor.pageToScreen({
            x: selBoundsForLayout.minX,
            y: selBoundsForLayout.minY,
          });
          const p2 = editor.pageToScreen({
            x: selBoundsForLayout.maxX,
            y: selBoundsForLayout.maxY,
          });
          startRect = {
            left: Math.min(p1.x, p2.x),
            top: Math.min(p1.y, p2.y),
            width: Math.max(4, Math.abs(p2.x - p1.x)),
            height: Math.max(4, Math.abs(p2.y - p1.y)),
          };
        }

        const exportSvg = editor.getSvgString
          ? (ids, opts) =>
              editor.getSvgString(ids, opts).then((r) => r?.svg ?? null)
          : editor.getSvg
          ? (ids, opts) =>
              editor
                .getSvg(ids, opts)
                .then((el) =>
                  el ? new XMLSerializer().serializeToString(el) : null
                )
          : null;

        if (exportSvg) {
          const svgString = await exportSvg(shapeIds, {
            background: false,
            padding: 8,
          });
          if (svgString) {
            const blob = new Blob([svgString], { type: "image/svg+xml" });
            suckImgUrl = URL.createObjectURL(blob);
          }
        }
      } catch (err) {
        console.error("[portal] snapshot for publish animation failed:", err);
      }

      // Real shapes disappear now — the animation clone (same image) takes
      // over visually at the exact same screen position, so there's no
      // visible pop between "real shape" and "flying clone."
      editor.deleteShapes(shapeIds);
      pendingPublishShapesRef.current = {
        shapes: preparedShapes,
        groupCenterX,
        groupCenterY,
        firestoreMetaByShapeId,
        destinationMode,
      };
      setCanvasMode(destinationMode);

      if (suckImgUrl && startRect) {
        const portalRect = getPortalRect();
        if (portalRect) {
          setPortalSuckEffect({
            id: Date.now(),
            imgUrl: suckImgUrl,
            startRect,
            target: {
              x: portalRect.left + portalRect.width / 2,
              y: portalRect.top + portalRect.height / 2,
            },
            duration: 480,
          });
        } else {
          URL.revokeObjectURL(suckImgUrl);
        }
      }
    },
    [canvasMode, getPortalRect]
  );

  useEffect(() => {
    const handlePointerMove = (e) => {
      pointerScreenRef.current = {
        x: e.clientX,
        y: e.clientY,
      };
    };

    window.addEventListener("pointermove", handlePointerMove, {
      passive: true,
    });

    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
    };
  }, []);

  useEffect(() => {
    if (!editorReady) return;
    // Runs regardless of which canvas is active — dragging into the portal
    // is symmetric now: private canvas targets public, public targets
    // private. (Previously this bailed out entirely unless canvasMode was
    // "private", which is why publish-by-drag only ever worked one way.)

    let rafId = 0;

    const hideGhost = () => {
      const el = dragGhostElRef.current;
      if (el) el.style.opacity = "0";
      clearDimmedShapes();
    };

    const tick = () => {
      const editor = editorInstance.current;

      if (!editor) {
        rafId = requestAnimationFrame(tick);
        return;
      }

      const selectedIds = editor.getSelectedShapeIds?.() || [];
      const isDragging = !!editor.inputs?.isDragging;

      if (!selectedIds.length || !isDragging) {
        setIsDraggingSelection((prev) => (prev ? false : prev));
        setIsPortalDropReady((prev) => (prev ? false : prev));

        if (wasDraggingRef.current) {
          hideGhost();
          if (dragGhostImgUrlRef.current) {
            URL.revokeObjectURL(dragGhostImgUrlRef.current);
            dragGhostImgUrlRef.current = null;
          }
        }
        wasDraggingRef.current = false;

        rafId = requestAnimationFrame(tick);
        return;
      }

      setIsDraggingSelection((prev) => (prev ? prev : true));

      const { x, y } = pointerScreenRef.current || { x: 0, y: 0 };
      const ready = isPointNearPortal(x, y);
      setIsPortalDropReady((prev) => (prev === ready ? prev : ready));

      // --- continuous shrink-toward-portal ghost, purely visual ---
      const justStartedDragging = !wasDraggingRef.current;
      wasDraggingRef.current = true;

      if (justStartedDragging && !dragGhostCaptureInFlightRef.current) {
        dragGhostCaptureInFlightRef.current = true;
        exportSelectionSvg(editor, selectedIds).then((svgString) => {
          dragGhostCaptureInFlightRef.current = false;
          if (!svgString) return;
          const blob = new Blob([svgString], { type: "image/svg+xml" });
          const url = URL.createObjectURL(blob);
          if (dragGhostImgUrlRef.current) {
            URL.revokeObjectURL(dragGhostImgUrlRef.current);
          }
          dragGhostImgUrlRef.current = url;
          const el = dragGhostElRef.current;
          if (el) el.src = url;
        });
      }

      const selBounds =
        editor.getSelectionPageBounds?.() ?? editor.getSelectedPageBounds?.();
      const portalRect = getPortalRect();

      if (selBounds && portalRect) {
        const p1 = editor.pageToScreen({
          x: selBounds.minX,
          y: selBounds.minY,
        });
        const p2 = editor.pageToScreen({
          x: selBounds.maxX,
          y: selBounds.maxY,
        });
        const rect = {
          left: Math.min(p1.x, p2.x),
          top: Math.min(p1.y, p2.y),
          width: Math.max(4, Math.abs(p2.x - p1.x)),
          height: Math.max(4, Math.abs(p2.y - p1.y)),
        };

        const portalCenter = {
          x: portalRect.left + portalRect.width / 2,
          y: portalRect.top + portalRect.height / 2,
        };
        const shapeCenter = {
          x: rect.left + rect.width / 2,
          y: rect.top + rect.height / 2,
        };
        const dist = Math.hypot(
          shapeCenter.x - portalCenter.x,
          shapeCenter.y - portalCenter.y
        );

        const proximity = Math.max(
          0,
          Math.min(1, 1 - dist / PORTAL_PULL_RADIUS)
        );
        const scale = 1 - proximity * (1 - PORTAL_MIN_SCALE);

        const el = dragGhostElRef.current;
        if (el && dragGhostImgUrlRef.current) {
          el.style.left = `${rect.left}px`;
          el.style.top = `${rect.top}px`;
          el.style.width = `${rect.width}px`;
          el.style.height = `${rect.height}px`;
          el.style.transformOrigin = "center center";
          el.style.transform = `scale(${scale})`;
          el.style.opacity = String(proximity);
        }

        // Best-effort: dim the real shape(s) as the ghost takes over
        // visually, so you don't see two overlapping copies. Depends on
        // tldraw exposing data-shape-id on its rendered DOM node — if a
        // future tldraw version changes that, this just silently no-ops
        // (you'd see both layers, a harmless visual downgrade, not a bug).
        const nextDimmed = [];
        selectedIds.forEach((id) => {
          try {
            const shapeEl = document.querySelector(`[data-shape-id="${id}"]`);
            if (shapeEl) {
              shapeEl.style.opacity = String(1 - proximity * 0.9);
              nextDimmed.push(id);
            }
          } catch {}
        });
        dragGhostShapeIdsRef.current = nextDimmed;
      }

      rafId = requestAnimationFrame(tick);
    };

    const onPointerUp = () => {
      const editor = editorInstance.current;
      if (!editor) return;

      const selectedIds = editor.getSelectedShapeIds() || [];

      if (portalDropReadyRef.current && selectedIds.length) {
        publishSelectionAcrossPortal(selectedIds);
      }

      hideGhost();
      if (dragGhostImgUrlRef.current) {
        URL.revokeObjectURL(dragGhostImgUrlRef.current);
        dragGhostImgUrlRef.current = null;
      }
      wasDraggingRef.current = false;

      setIsDraggingSelection(false);
      setIsPortalDropReady(false);
    };

    rafId = requestAnimationFrame(tick);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointerup", onPointerUp);
      hideGhost();
    };
  }, [
    editorReady,
    canvasMode,
    isPointNearPortal,
    publishSelectionAcrossPortal,
    exportSelectionSvg,
    getPortalRect,
    clearDimmedShapes,
  ]);

  const nudgeHoverPrevSelectionRef = useRef(null);

  const [nudgeModal, setNudgeModal] = useState({
    open: false,
    shapeId: null,
    nudges: [],
  });

  // Action history only makes sense on the public/shared canvas — a
  // private canvas's edits are personal to that user, so there's nothing
  // meaningful to show, and no reason to pay for a live Firestore listener
  // while on that side.
  const { actionHistory, setActionHistory, fetchActionHistory } =
    useCanvasActionHistory({
      className,
      projectName,
      teamName,
      enabled: isPublicMode,
    });

  useCameraPresence(editorInstance, {
    className,
    projectName,
    teamName,
    enabled: editorReady && isPublicMode,
  });

  useEffect(() => {
    if (!isPhasePulsing) return;

    const id = setTimeout(() => {
      setIsPhasePulsing(false);
    }, 3000);

    return () => clearTimeout(id);
  }, [isPhasePulsing]);

  useEffect(() => {
    if (!className || !projectName || !teamName) return;

    const shapesCol = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "shapes"
    );

    const q = query(
      shapesCol,
      orderBy("updatedAt", "desc"),
      orderBy("createdAt", "desc")
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const shapes = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        setShapesForAnalysis(shapes);
      },
      (error) => {
        console.error("Error listening to shapes:", error);
      }
    );

    return () => unsubscribe();
  }, [className, projectName, teamName]);

  useEffect(() => {
    if (!className || !projectName || !teamName) return;

    const speechCol = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "speech_events"
    );

    const q = query(speechCol, orderBy("createdAt", "desc"));

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const speech = snapshot.docs.map((docSnap) => ({
          id: docSnap.id,
          ...docSnap.data(),
        }));

        setSpeechForAnalysis(speech);
      },
      (error) => {
        console.error("Error listening to speech_events:", error);
      }
    );

    return () => unsubscribe();
  }, [className, projectName, teamName]);

  useEffect(() => {
    if (!className || !projectName || !teamName) return;

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

    const unsub = onSnapshot(
      presCol,
      (snap) => {
        const actors = snap.docs.map((d) => {
          const data = d.data() || {};

          return {
            id: d.id,
            label: data.displayName || data.email || d.id,
            email: data.email || null,
            photoURL: data.photoURL || null,
            lastActive: data.lastActive || null,
          };
        });

        actors.sort((a, b) => (a.label || "").localeCompare(b.label || ""));

        setSessionActors(actors);
      },
      (err) => console.error("[presence] listen error", err)
    );

    return () => unsub();
  }, [className, projectName, teamName]);

  const normalizedSpeechForAnalysis = useMemo(() => {
    return (speechForAnalysis || [])
      .filter((item) => {
        if (!item) return false;
        if (item.type !== "utterance") return false;
        if (item.isFinal === false) return false;

        const text = String(item.text || "").trim();
        return text.length > 0;
      })
      .map((item) => ({
        id: item.id || null,
        type: item.type || "utterance",
        text: String(item.text || "").trim(),
        speakerId: item.speakerId || "unknown",
        speakerLabel: item.speakerLabel || "Unknown speaker",
        capturedBy: item.capturedBy || null,
        source: item.source || "browser_speech_recognition",
        startedAt: typeof item.startedAt === "number" ? item.startedAt : null,
        endedAt: typeof item.endedAt === "number" ? item.endedAt : null,
        durationMs:
          typeof item.durationMs === "number" ? item.durationMs : null,
        createdAt:
          typeof item.createdAt?.toMillis === "function"
            ? item.createdAt.toMillis()
            : typeof item.createdAt === "number"
            ? item.createdAt
            : null,
      }))
      .sort((a, b) => {
        const ta = a.startedAt ?? a.createdAt ?? 0;
        const tb = b.startedAt ?? b.createdAt ?? 0;
        return ta - tb;
      });
  }, [speechForAnalysis]);

  useEffect(() => {
    if (!className || !projectName || !teamName) return;

    const nudgesRef = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "nudges"
    );

    const q = query(nudgesRef, orderBy("createdAt", "desc"));
    const myUid = auth.currentUser?.uid;
    const SEEN_IDS = new Set();

    const unsub = onSnapshot(q, (snap) => {
      snap.docChanges().forEach((change) => {
        if (change.type !== "added") return;

        const docId = change.doc.id;
        if (SEEN_IDS.has(docId)) return;
        SEEN_IDS.add(docId);

        const data = change.doc.data();

        if (data.expiresAt && Date.now() > data.expiresAt) return;

        if (data.publishedBy === myUid) return;

        const trigger = data.trigger || {};
        const text = (trigger.user_text || "").trim();
        const chips = Array.isArray(trigger.chips) ? trigger.chips : [];

        setPhaseTailShapeIds(data.tailShapeIds || []);
        setCurrentPhaseDetail(data.metrics || null);
        setIsPhasePulsing(true);
        playTriggerAnimation(trigger.id);
        const phaseName =
          data.metrics?.current_phase_dc ||
          data.metrics?.current_phase_full ||
          null;
        if (phaseName) setCurrentPhaseName(phaseName);
        if (text) setPhaseNudgePreview(text);

        if (text) {
          window.dispatchEvent(
            new CustomEvent("trigger-chatbot", {
              detail: {
                text,
                chips,
                role: trigger.role || null,
                phase: data.metrics?.current_phase_dc || null,
                meta: {
                  trigger,
                  scope: "public",
                  triggerId: trigger.id,
                  tailShapeIds: data.tailShapeIds || [],
                  currentPhase: data.metrics || null,
                },
                source: "public-nudge",
              },
            })
          );
        }
      });
    });

    return () => unsub();
  }, [className, projectName, teamName, playTriggerAnimation]);

  const actorsFromFS = useMemo(() => {
    const set = new Set();
    (shapesForAnalysis || []).forEach((s) => {
      if (s.createdBy) set.add(s.createdBy);
    });
    return Array.from(set).sort();
  }, [shapesForAnalysis]);

  useEffect(() => {
    const handler = (e) => {
      const { enabled } = e.detail || {};
      setSelectionModeActive(Boolean(enabled));
    };

    window.addEventListener("chatbot-selection-mode", handler);
    return () => window.removeEventListener("chatbot-selection-mode", handler);
  }, []);

  useEffect(() => {
    const handleNudgeHover = (e) => {
      const detail = e.detail || {};

      const editor = editorInstance.current;
      if (!editor) return;

      const active = !!detail.active;
      const tailShapeIds = Array.isArray(detail.tailShapeIds)
        ? detail.tailShapeIds
        : [];

      if (active && tailShapeIds.length) {
        if (!nudgeHoverPrevSelectionRef.current) {
          try {
            const currentSel = editor.getSelectedShapeIds();
            nudgeHoverPrevSelectionRef.current = currentSel;
          } catch (err) {
            nudgeHoverPrevSelectionRef.current = [];
          }
        }

        const validIds = tailShapeIds.filter((id) => !!editor.getShape(id));

        try {
          editor.setSelectedShapes(validIds);
        } catch (err) {}

        return;
      }

      const prev = nudgeHoverPrevSelectionRef.current;

      if (prev && prev.length) {
        const validPrev = prev.filter((id) => !!editor.getShape(id));
        try {
          editor.setSelectedShapes(validPrev);
        } catch (err) {}
      } else {
        try {
          editor.setSelectedShapes([]);
        } catch (err) {}
      }

      nudgeHoverPrevSelectionRef.current = null;
    };

    window.addEventListener("chatbot-nudge-hover", handleNudgeHover);
    return () => {
      window.removeEventListener("chatbot-nudge-hover", handleNudgeHover);
    };
  }, []);

  useEffect(() => {
    if (!editorReady) return;
    const editor = editorInstance.current;
    if (!editor) return;

    const handleRequestSelection = () => {
      const selection = makeSelectionSummary(editor);

      if (!selection.ids || selection.ids.length === 0) return;

      const payload = buildAiPayloadFromSelection(selection, editor);

      window.dispatchEvent(
        new CustomEvent("trigger-chatbot", {
          detail: payload,
        })
      );
    };

    window.addEventListener(
      "chatbot-request-selection",
      handleRequestSelection
    );
    return () => {
      window.removeEventListener(
        "chatbot-request-selection",
        handleRequestSelection
      );
    };
  }, [editorReady]);

  const handleToggleSidebar = useCallback(() => {
    setShowSidebar((prev) => !prev);
  }, []);

  const handleNudgeFromContextMenu = useCallback((nudgeMessage) => {
    setExternalMessages((prev) => [...prev, nudgeMessage]);
  }, []);

  useEffect(() => {
    const currentUser = auth.currentUser;
    if (!currentUser) return;

    const userRef = doc(db, "users", currentUser.uid);
    getDoc(userRef).then((docSnap) => {
      if (docSnap.exists()) {
        setUserRole(docSnap.data().role);
      }
    });
  }, []);

  const togglePanel = useCallback(() => {
    setIsPanelCollapsed((p) => !p);
  }, []);

  // Ported from CustomContextMenu.jsx, now that the History/Comments panel
  // renders as a normal sibling instead of from inside tldraw's
  // components.ContextMenu slot: useEditor() only works for components
  // actually rendered inside <Tldraw>, so this uses the same
  // editorInstance.current ref every other sibling (ChatBot, RobotDock,
  // etc.) already relies on for editor access.
  // Shared by both the History and Comments panels: select the given
  // shape and recenter the camera on it, without changing zoom. Returns
  // the shape (or null) so callers that need to know whether it actually
  // existed — e.g. to decide whether to also open its comment box — don't
  // have to look it up a second time.
  const panToShape = useCallback((shapeId) => {
    const editor = editorInstance.current;
    if (!editor || !shapeId) return null;

    const shape = editor.getShape(shapeId);
    if (!shape) {
      console.error("[Canvas] Shape not found for id:", shapeId);
      return null;
    }

    editor.select(shapeId);

    const bounds = editor.getShapePageBounds(shapeId);
    if (bounds) {
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };
      editor.centerOnPoint(center);
    }

    return shape;
  }, []);

  const handleHistoryItemClick = useCallback(
    (shapeId) => {
      panToShape(shapeId);
    },
    [panToShape]
  );

  // Comments panel: pan to the shape AND open its comment box — the
  // commentFocusShapeId/onCommentFocusComputed pair mirrors the existing
  // nudgeFocusShapeId pattern used for ChatBot, just aimed at
  // ContextToolbarComponent's floating CommentBox instead.
  const handleCommentItemClick = useCallback(
    (shapeId) => {
      const shape = panToShape(shapeId);
      if (shape) setCommentFocusShapeId(shapeId);
    },
    [panToShape]
  );

  useEffect(() => {
    if (!isRecording || !recordingStartAt) {
      setElapsed("0:00");
      return;
    }

    const id = setInterval(() => {
      const ms = Date.now() - recordingStartAt;
      const total = Math.floor(ms / 1000);
      const mm = Math.floor(total / 60);
      const ss = total % 60;
      setElapsed(`${mm}:${ss.toString().padStart(2, "0")}`);
    }, 200);
    return () => clearInterval(id);
  }, [isRecording, recordingStartAt]);

  const formatMs = (ms) => {
    const total = Math.floor(ms / 1000);
    const mm = Math.floor(total / 60);
    const ss = (total % 60).toString().padStart(2, "0");
    return `${mm}:${ss}`;
  };

  const addComment = useCallback((shapeId, commentData) => {
    const commentDataWithTime = {
      ...commentData,
      timestamp: new Date().toLocaleString(),
    };

    setComments((prevComments) => {
      const updatedComments = {
        ...prevComments,
        [shapeId]: [...(prevComments[shapeId] || []), commentDataWithTime],
      };
      return updatedComments;
    });

    setCommentCounts((prevCounts) => {
      const updatedCounts = {
        ...prevCounts,
        [shapeId]: (prevCounts[shapeId] || 0) + 1,
      };
      return updatedCounts;
    });
  }, []);

  const uploadToFirebase = useCallback(async (blob) => {
    try {
      const currentUser = auth.currentUser;
      const timestamp = Date.now();
      const uid = currentUser?.uid || "anon";
      const filename = `audio/${uid}/${timestamp}.webm`;

      const audioRef = ref(storage, filename);
      const metadata = {
        contentType: "audio/webm",
        customMetadata: {
          uploadedBy: currentUser ? currentUser.uid : "anonymous",
          uploadedAt: new Date(timestamp).toISOString(),
        },
      };

      const snapshot = await uploadBytes(audioRef, blob, metadata);

      const url = await getDownloadURL(audioRef);
      return url;
    } catch (error) {
      console.error("Error uploading to Firebase:", error);
      if (
        error.code === "storage/unauthorized" ||
        error.code === "storage/cors-error"
      ) {
        return URL.createObjectURL(blob);
      }
      throw error;
    }
  }, []);

  const uploadPdfToFirebase = useCallback(async (file) => {
    const currentUser = auth.currentUser;
    const uid = currentUser?.uid || "anon";
    const timestamp = Date.now();
    const safeName = file.name.replace(/[^a-zA-Z0-9_.-]/g, "_");
    const filename = `pdfs/${uid}/${timestamp}-${safeName}`;

    const pdfRef = ref(storage, filename);
    await uploadBytes(pdfRef, file, {
      contentType: "application/pdf",
      customMetadata: {
        uploadedBy: currentUser ? currentUser.uid : "anonymous",
        uploadedAt: new Date(timestamp).toISOString(),
      },
    });

    return await getDownloadURL(pdfRef);
  }, []);

  const pdfInputRef = useRef(null);

  // Shared by both the toolbar button and drag-and-drop, so both paths
  // stay in sync if the upload/creation logic ever changes.
  const PDF_SHAPES_ENABLED = true;

  const addPdfToCanvas = useCallback(
    async (file, dropPoint) => {
      if (!PDF_SHAPES_ENABLED) {
        alert(
          "PDF support is being finished up on our end — hang tight, this will be enabled shortly."
        );
        return;
      }

      const editor = editorInstance.current;
      if (!editor) return;

      if (file.type !== "application/pdf") {
        alert("Only PDF files are supported right now.");
        return;
      }

      const w = 420;
      const h = 560;

      try {
        const url = await uploadPdfToFirebase(file);

        let x, y;
        if (dropPoint) {
          x = dropPoint.x - w / 2;
          y = dropPoint.y - h / 2;
        } else {
          const bounds = editor.getViewportPageBounds();
          x = (bounds.minX + bounds.maxX) / 2 - w / 2;
          y = (bounds.minY + bounds.maxY) / 2 - h / 2;
        }

        editor.createShape({
          type: "pdf",
          x,
          y,
          props: { w, h, src: url, title: file.name },
        });
      } catch (err) {
        console.error("[PDF] failed to add PDF to canvas:", err);
        alert("Couldn't add that PDF. Please try again.");
      }
    },
    [uploadPdfToFirebase]
  );

  const handlePdfInputChange = useCallback(
    (e) => {
      const file = e.target.files?.[0];
      e.target.value = ""; // allow re-selecting the same file later
      if (file) addPdfToCanvas(file);
    },
    [addPdfToCanvas]
  );

  // Drag-and-drop for PDFs specifically. We intercept in the capture
  // phase and only preventDefault/stopPropagation when a PDF is actually
  // present in the drag — everything else (images, etc.) falls through
  // untouched to tldraw's own built-in drop handling.
  useEffect(() => {
    if (!editorReady) return;

    const handleDragOver = (e) => {
      const items = Array.from(e.dataTransfer?.items || []);
      const hasPdf = items.some(
        (item) => item.kind === "file" && item.type === "application/pdf"
      );
      if (hasPdf) e.preventDefault();
    };

    const handleDrop = (e) => {
      const files = Array.from(e.dataTransfer?.files || []);
      const pdfFile = files.find((f) => f.type === "application/pdf");
      if (!pdfFile) return; // not our concern — let tldraw handle it

      e.preventDefault();
      e.stopPropagation();

      const editor = editorInstance.current;
      if (!editor) return;

      const point = editor.screenToPage?.({ x: e.clientX, y: e.clientY });
      addPdfToCanvas(pdfFile, point);
    };

    window.addEventListener("dragover", handleDragOver, true);
    window.addEventListener("drop", handleDrop, true);

    return () => {
      window.removeEventListener("dragover", handleDragOver, true);
      window.removeEventListener("drop", handleDrop, true);
    };
  }, [editorReady, addPdfToCanvas]);

  const startRecording = useCallback(async () => {
    recorderRef.current = await createToggleRecorder({
      maxDurationMs: 30000,
      onElapsed: (ms) => {
        const total = Math.floor(ms / 1000);
        const mm = Math.floor(total / 60);
        const ss = (total % 60).toString().padStart(2, "0");
        setElapsed(`${mm}:${ss}`);
      },
    });
    setIsRecording(true);
    setRecordingStartAt(Date.now());
    await recorderRef.current.start();
  }, []);

  const stopRecording = useCallback(
    async (editor) => {
      try {
        const blob = await recorderRef.current.stop();
        setIsRecording(false);
        setRecordingStartAt(null);
        setElapsed("0:00");

        const url = await uploadToFirebase(blob);
        const bounds = editor.getViewportPageBounds();
        const x = (bounds.minX + bounds.maxX) / 2;
        const y = (bounds.minY + bounds.maxY) / 2;
        editor.createShape({
          type: "audio",
          x,
          y,
          props: {
            w: 420,
            h: 39,
            src: url,
            title: "",
            isPlaying: false,
            currentTime: 0,
            duration: 0,
          },
        });
      } catch (e) {
        setIsRecording(false);
        setRecordingStartAt(null);
        setElapsed("0:00");
        alert("Recording failed: " + (e?.message || e));
      } finally {
        recorderRef.current = null;
      }
    },
    [uploadToFirebase]
  );

  const startRecordingRef = useRef(startRecording);
  const stopRecordingRef = useRef(stopRecording);
  const isRecordingRef = useRef(isRecording);

  useEffect(() => {
    startRecordingRef.current = startRecording;
  }, [startRecording]);
  useEffect(() => {
    stopRecordingRef.current = stopRecording;
  }, [stopRecording]);
  useEffect(() => {
    isRecordingRef.current = isRecording;
  }, [isRecording]);

  const uiOverrides = useMemo(
    () => ({
      tools(editor, tools) {
        tools.microphone = {
          id: "microphone",
          label: "Record",
          kbd: "r",
          readonlyOk: false,
          onSelect: async () => {
            if (!isRecordingRef.current) {
              await startRecordingRef.current?.();
            } else {
              await stopRecordingRef.current?.(editor);
            }
          },
        };
        return tools;
      },
    }),
    []
  );

  const actorOptions = useMemo(() => {
    return (sessionActors || []).map((a) => ({
      id: a.id,
      label: a.label || a.email || a.id,
    }));
  }, [sessionActors]);

  const openChatForShape = useCallback(
    (shapeId) => {
      const editor = editorInstance.current;
      if (!editor) return;

      let selectedIds = editor.getSelectedShapeIds();

      if (shapeId) {
        const isInSelection = selectedIds.includes(shapeId);

        if (!isInSelection) {
          editor.select([shapeId]);
          selectedIds = [shapeId];
        }
      }

      const selection = makeSelectionSummary(editor);

      const primaryId = shapeId || selection.primary?.id || selection.ids[0];
      const primaryShape = primaryId ? editor.getShape(primaryId) : null;

      setSelectedTargets(selection.ids);
      setSelectedShape(primaryShape ?? null);

      const payload = buildAiPayloadFromSelection(selection, editor);

      window.dispatchEvent(
        new CustomEvent("trigger-chatbot", { detail: payload })
      );
    },
    [setSelectedTargets, setSelectedShape]
  );

  const handlePhaseNudgeClick = useCallback((shapeId) => {
    setNudgeFocusShapeId(shapeId);
  }, []);

  const shapeReactionsRef = useRef(shapeReactions);
  useEffect(() => {
    shapeReactionsRef.current = shapeReactions;
  }, [shapeReactions]);

  const selectedShapeRef = useRef(selectedShape);
  useEffect(() => {
    selectedShapeRef.current = selectedShape;
  }, [selectedShape]);

  const commentCountsRef = useRef(commentCounts);
  useEffect(() => {
    commentCountsRef.current = commentCounts;
  }, [commentCounts]);

  const userRoleRef = useRef(userRole);
  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);

  const commentFocusShapeIdRef = useRef(commentFocusShapeId);
  useEffect(() => {
    commentFocusShapeIdRef.current = commentFocusShapeId;
  }, [commentFocusShapeId]);

  const selectionModeActiveRef = useRef(selectionModeActive);
  useEffect(() => {
    selectionModeActiveRef.current = selectionModeActive;
  }, [selectionModeActive]);

  const phaseTailShapeIdsRef = useRef(phaseTailShapeIds);
  useEffect(() => {
    phaseTailShapeIdsRef.current = phaseTailShapeIds;
  }, [phaseTailShapeIds]);

  const phaseNudgePreviewRef = useRef(phaseNudgePreview);
  useEffect(() => {
    phaseNudgePreviewRef.current = phaseNudgePreview;
  }, [phaseNudgePreview]);

  const openChatForShapeRef = useRef(openChatForShape);
  useEffect(() => {
    openChatForShapeRef.current = openChatForShape;
  }, [openChatForShape]);

  const handlePhaseNudgeClickRef = useRef(handlePhaseNudgeClick);
  useEffect(() => {
    handlePhaseNudgeClickRef.current = handlePhaseNudgeClick;
  }, [handlePhaseNudgeClick]);

  const handleNudgeFromContextMenuRef = useRef(handleNudgeFromContextMenu);
  useEffect(() => {
    handleNudgeFromContextMenuRef.current = handleNudgeFromContextMenu;
  }, [handleNudgeFromContextMenu]);

  const addCommentRef = useRef(addComment);
  useEffect(() => {
    addCommentRef.current = addComment;
  }, [addComment]);

  const fetchActionHistoryRef = useRef(fetchActionHistory);
  useEffect(() => {
    fetchActionHistoryRef.current = fetchActionHistory;
  }, [fetchActionHistory]);

  const roomMetaRef = useRef({ className, projectName, teamName });
  useEffect(() => {
    roomMetaRef.current = { className, projectName, teamName };
  }, [className, projectName, teamName]);

  const upsertImageUrlRef = useRef(upsertImageUrl);
  useEffect(() => {
    upsertImageUrlRef.current = upsertImageUrl;
  }, [upsertImageUrl]);

  const actorOptionsRef = useRef(actorOptions);
  useEffect(() => {
    actorOptionsRef.current = actorOptions;
  }, [actorOptions]);

  const elapsedRef = useRef(elapsed);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  const analyzeFn = useCallback(
    async ({ source, signal }) => {
      if (source === "proactive") {
        const now = Date.now();
        if (now < autoGlobalCooldownUntilRef.current) {
          return { trigger: null, skipped: "global_cooldown" };
        }
      }

      const payload = {
        canvasId: `${className}_${projectName}_${teamName}`,
        shapes: shapesForAnalysis || [],
        speech: normalizedSpeechForAnalysis || [],
        source,
      };

      const res = await fetch(
        "https://prediction-backend-g5x7odgpiq-uc.a.run.app/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
          signal,
        }
      );

      if (!res.ok) {
        throw new Error(`/analyze failed: ${res.status}`);
      }
      return await res.json();
    },
    [
      className,
      projectName,
      teamName,
      shapesForAnalysis,
      normalizedSpeechForAnalysis,
    ]
  );

  function normalizeAnalyzeResponse(data) {
    const trigger = data?.trigger || null;

    const tailShapeIdsRaw =
      data?.tail_shape_ids ?? data?.tailShapeIds ?? data?.tail_shape_ids ?? [];

    const tailShapeIds = (
      Array.isArray(tailShapeIdsRaw) ? tailShapeIdsRaw : []
    ).map((id) => (id?.startsWith("shape:") ? id : `shape:${id}`));

    const metrics = data?.current_phase ?? data?.currentPhase ?? null;

    const triggerWithScope = trigger
      ? { ...trigger, scope: trigger.scope ?? "public" }
      : null;

    return {
      tailShapeIds,
      metrics,
      trigger: triggerWithScope,
    };
  }

  const publishPublicNudge = useCallback(
    async ({ trigger, tailShapeIds, metrics }) => {
      if (!className || !projectName || !teamName) return;
      const nudgesRef = collection(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "nudges"
      );
      await addDoc(nudgesRef, {
        trigger,
        tailShapeIds: tailShapeIds || [],
        metrics: metrics || null,
        publishedBy: auth.currentUser?.uid || "anon",
        createdAt: serverTimestamp(),
        expiresAt: Date.now() + 120_000,
      });
    },
    [className, projectName, teamName]
  );

  const pushNudgeToChatbot = useCallback(
    ({ source, tailShapeIds, metrics, trigger }) => {
      if (!trigger || !trigger.id) return;

      const text = (trigger?.user_text || "").trim();
      const chips = Array.isArray(trigger?.chips) ? trigger.chips : [];
      const scope = trigger?.scope ?? "public";

      setPhaseTailShapeIds(tailShapeIds || []);
      setCurrentPhaseDetail(metrics || null);

      const phaseName =
        metrics?.current_phase_dc || metrics?.current_phase_full || null;
      if (phaseName) setCurrentPhaseName(phaseName);

      setPhaseNudgePreview(text);
      setIsPhasePulsing(true);
      playTriggerAnimation(trigger.id);

      if (source === "proactive" && text) {
        const now = Date.now();
        const lastAt = autoTriggerCooldownMapRef.current[trigger.id] || 0;
        if (now - lastAt < NUDGE_COOLDOWN_MS) {
          return;
        }

        autoTriggerCooldownMapRef.current[trigger.id] = now;
        autoGlobalCooldownUntilRef.current = now + NUDGE_COOLDOWN_MS;

        const chatbotPayload = {
          text,
          chips,
          role: trigger?.role || null,
          phase: metrics?.current_phase_dc || null,
          meta: {
            trigger,
            scope,
            dedupe_key: trigger?.dedupe_key || null,
            triggerId: trigger.id,
            tailShapeIds: tailShapeIds || [],
            currentPhase: metrics || null,
          },
          source: scope === "public" ? "public-nudge" : "auto-nudge",
        };

        if (scope === "public") {
          publishPublicNudge({ trigger, tailShapeIds, metrics }).catch(
            (err) => console.error("[nudge] failed to publish public nudge:", err)
          );
        }

        window.dispatchEvent(
          new CustomEvent("trigger-chatbot", { detail: chatbotPayload })
        );
      }
    },
    [playTriggerAnimation, publishPublicNudge]
  );

  const onProactiveResult = useCallback(
    (raw) => {
      const data = normalizeAnalyzeResponse(raw);

      const trigger = data?.trigger || null;
      if (!trigger || !trigger.id) {
        return;
      }

      pushNudgeToChatbot({
        source: "proactive",
        tailShapeIds: data.tailShapeIds,
        metrics: data.metrics,
        trigger: data.trigger,
        nudgeText: data.trigger?.user_text || "",
        chips: data.trigger?.chips || [],
        triggerId: data.trigger?.id || null,
      });
    },
    [pushNudgeToChatbot]
  );

  const { requestAnalyze, bumpActivity } = useProactiveNudges({
    editorRef: editorInstance,
    editorReady,
    enabled: aiEnabled && isPublicMode,

    analyzeFn,
    onResult: onProactiveResult,
    onError: (e) => console.error("[Proactive] analyze error", e),

    idleDebounceMs: 3000,
    minGapMs: 10000,
    maxWaitMs: 30000,
    minEvents: 4,
  });

  useEffect(() => {
    if (!aiEnabled || !editorReady) return;

    const currentCount = normalizedSpeechForAnalysis.length;

    if (!speechBootstrapDoneRef.current) {
      prevSpeechCountRef.current = currentCount;
      speechBootstrapDoneRef.current = true;
      return;
    }

    const delta = currentCount - prevSpeechCountRef.current;

    if (delta <= 0) {
      prevSpeechCountRef.current = currentCount;
      return;
    }

    const recentUtterances = normalizedSpeechForAnalysis.slice(-delta);

    const meaningfulUtterances = recentUtterances.filter((u) => {
      const text = String(u.text || "").trim();
      const words = text.split(/\s+/).filter(Boolean);
      return words.length >= 3;
    });

    if (meaningfulUtterances.length > 0) {
      bumpActivity(meaningfulUtterances.length);
    }

    prevSpeechCountRef.current = currentCount;
  }, [normalizedSpeechForAnalysis, aiEnabled, editorReady, bumpActivity]);

  function ToolbarComp(props) {
    return <DefaultToolbar {...props} />;
  }

  function ContextMenuComp(props) {
    return <CustomContextMenu {...props} />;
  }

  function InFrontComp(props) {
    return (
      <>
        <SelectionLogger />
        <ContextToolbarComponent {...props} />
        <HoverActionBadge onIconClick={undefined} />
        <PhaseNudgeBadges />
      </>
    );
  }

  const components = useMemo(
    () => ({
      Toolbar: ToolbarComp,
      ContextMenu: ContextMenuComp,
      InFrontOfTheCanvas: InFrontComp,
      ActionsMenu: CustomActionsMenu,
    }),
    []
  );

  const tldrawComponents = useMemo(() => {
    const ContextMenu = (props) => {
      const editor = useEditor();

      const selectedIds = useValue(
        "selected ids",
        () => editor.getSelectedShapeIds(),
        [editor]
      );

      const selectedKey = useMemo(() => selectedIds.join("|"), [selectedIds]);

      const selection = useMemo(() => {
        if (!selectedIds.length) {
          return { ids: [], summaries: [], primary: null, bounds: null };
        }
        return makeSelectionSummary(editor);
      }, [editor, selectedKey]);

      useEffect(() => {
        setSelectedTargets(selection.ids);
      }, [selection.ids]);

      return (
        <CustomContextMenu
          {...props}
          selection={selection}
          shapeReactions={shapeReactionsRef.current}
          setShapeReactions={setShapeReactions}
          selectedShape={selectedShapeRef.current}
          setSelectedShape={setSelectedShape}
          commentCounts={commentCountsRef.current}
          setCommentCounts={setCommentCounts}
          onNudge={(msg) => handleNudgeFromContextMenuRef.current?.(msg)}
          onTargetsChange={setSelectedTargets}
        />
      );
    };

    const InFrontOfTheCanvas = (props) => {
      return (
        <>
          <SelectionLogger
            selectionModeActive={selectionModeActiveRef.current}
            roomMeta={roomMetaRef.current}
            upsertImageUrlFn={upsertImageUrlRef.current}
          />

          <ContextToolbarComponent
            {...props}
            userRole={userRoleRef.current}
            selectedShape={selectedShapeRef.current}
            setShapeReactions={setShapeReactions}
            shapeReactions={shapeReactionsRef.current}
            commentCounts={commentCountsRef.current}
            addComment={(shapeId, data) =>
              addCommentRef.current?.(shapeId, data)
            }
            setActionHistory={setActionHistory}
            fetchActionHistory={() => fetchActionHistoryRef.current?.()}
            commentFocusShapeId={commentFocusShapeIdRef.current}
            onCommentFocusComputed={() => setCommentFocusShapeId(null)}
          />

          <HoverActionBadge
            onIconClick={(shapeId) => openChatForShapeRef.current?.(shapeId)}
          />

          <PhaseNudgeBadges
            shapeIds={phaseTailShapeIdsRef.current}
            onClickShape={(shapeId) =>
              handlePhaseNudgeClickRef.current?.(shapeId)
            }
            previewText={phaseNudgePreviewRef.current}
          />
        </>
      );
    };

    const Toolbar = (props) => {
      const editor = useEditor();
      const tools = useTools();
      const isMicSelected = useIsToolSelected(tools["microphone"]);

      return (
        <DefaultToolbar {...props}>
          <button
            type="button"
            className="tlui-button tlui-button--icon"
            title="Add PDF"
            onClick={() => pdfInputRef.current?.click()}
          >
            <FontAwesomeIcon icon={faFilePdf} style={{ fontSize: 16 }} />
          </button>

          <DefaultToolbarContent />
        </DefaultToolbar>
      );
    };

    const ActionsMenu = (props) => <CustomActionsMenu {...props} />;

    const NavigationPanel = (props) => (
      <CustomNavigationPanel
        {...props}
        actorOptions={actorOptionsRef.current}
        shapeActorIdByShapeId={shapeActorIdByShapeIdRef.current}
        maxActors={6}
      />
    );

    // tldraw's own default behavior is to hide the style panel when
    // there's nothing selected (and no drawing tool active with stylable
    // options) — the fact that it was showing constantly means something
    // was overriding that. Rather than chase whatever CSS was fighting
    // tldraw's internal visibility logic, this makes it explicit: no
    // selection, no panel, full stop.
    const StylePanel = (props) => {
      const editor = useEditor();
      const hasSelection = useValue(
        "style panel has selection",
        () => editor.getSelectedShapeIds().length > 0,
        [editor]
      );
      if (!hasSelection) return null;
      return <DefaultStylePanel {...props} />;
    };

    return {
      ContextMenu,
      InFrontOfTheCanvas,
      Toolbar,
      ActionsMenu,
      NavigationPanel,
      StylePanel,
    };
  }, []);

  const getPhaseClass = () => {
    if (currentPhaseName === "divergent") {
      return "phase-divergent";
    }
    if (currentPhaseName === "convergent") {
      return "phase-convergent";
    }
    return "phase-neutral";
  };

  const phaseClass = getPhaseClass();

  const userCtxValue = useMemo(() => {
    const u = auth.currentUser;
    return {
      actorId: u?.uid || u?.email || "anon",
      actorName: u?.displayName || u?.email?.split("@")[0] || "Anonymous",
      shapeActorIdByShapeId,
    };
  }, [
    auth.currentUser?.uid,
    auth.currentUser?.displayName,
    auth.currentUser?.email,
    shapeActorIdByShapeId,
  ]);

  const toolsMemo = useMemo(() => [...defaultTools, ...CUSTOM_TOOLS], []);

  if (!roomId) return null;

  return (
    <>
      <Navbar isPublicCanvas={isPublicMode} />
      <div
        className={`main-container ${phaseClass} ${
          isPhasePulsing ? "phase-pulse" : ""
        }`}
        style={{ position: "fixed", inset: 0 }}
      >
        <input
          type="file"
          accept="application/pdf"
          ref={pdfInputRef}
          onChange={handlePdfInputChange}
          style={{ display: "none" }}
        />

        <UserContext.Provider value={userCtxValue}>
          <Tldraw
            key={canvasMode}
            onMount={(editor) => {
              editorInstance.current = editor;
              setEditorReady(true);

              editor.registerExternalContentHandler(
                "url",
                async ({ point, url }) => {
                  const createBookmarkFallback = (bookmarkUrl) => {
                    // Bookmarks require a real http(s) URL — never pass a data:/blob: URI here
                    if (!/^https?:\/\//i.test(bookmarkUrl)) return;
                    const shapeId = createShapeId();
                    editor.createShape({
                      id: shapeId,
                      type: "bookmark",
                      x: point.x - 150,
                      y: point.y - 100,
                      props: { url: bookmarkUrl, w: 300, h: 200 },
                    });
                  };

                  const uploadAndCreateImageShape = async (blob, ext) => {
                    const currentUser = auth.currentUser;
                    if (!currentUser) throw new Error("Not signed in");
                    const uid = currentUser.uid;

                    const ts = Date.now();
                    const path = `dropped/${className}_${projectName}_${teamName}/${uid}/${ts}.${ext}`;
                    const storageRef = ref(storage, path);
                    await uploadBytes(storageRef, blob, {
                      contentType: blob.type || `image/${ext}`,
                    });
                    const downloadUrl = await getDownloadURL(storageRef);

                    const dims = await new Promise((resolve) => {
                      const img = new Image();
                      img.onload = () =>
                        resolve({
                          w: img.naturalWidth || 300,
                          h: img.naturalHeight || 300,
                        });
                      img.onerror = () => resolve({ w: 300, h: 300 });
                      img.src = downloadUrl;
                    });

                    const assetId = `asset:${Date.now()}-${Math.random()
                      .toString(16)
                      .slice(2)}`;
                    editor.createAssets([
                      {
                        id: assetId,
                        type: "image",
                        typeName: "asset",
                        props: {
                          name: `dropped-${ts}.${ext}`,
                          src: downloadUrl,
                          w: dims.w,
                          h: dims.h,
                          mimeType: blob.type || `image/${ext}`,
                          isAnimated: false,
                        },
                        meta: {},
                      },
                    ]);

                    const shapeId = createShapeId();
                    editor.createShape({
                      id: shapeId,
                      type: "image",
                      x: point.x - dims.w / 4,
                      y: point.y - dims.h / 4,
                      props: { assetId, w: dims.w / 2, h: dims.h / 2 },
                    });
                  };

                  // --- CASE 1: raw data:/blob: URI (pasted clipboard image) ---
                  if (/^data:image\//i.test(url) || /^blob:/i.test(url)) {
                    try {
                      const res = await fetch(url);
                      const blob = await res.blob();
                      const ext = (blob.type.split("/")[1] || "png").replace(
                        "jpeg",
                        "jpg"
                      );
                      await uploadAndCreateImageShape(blob, ext);
                    } catch (err) {
                      console.error(
                        "[paste-image] Failed to upload pasted image:",
                        err
                      );
                      // No safe fallback for a raw data URI — nothing to bookmark
                    }
                    return;
                  }

                  // --- CASE 2: unwrap Google Images' redirect wrapper ---
                  let resolvedUrl = url;
                  try {
                    const parsed = new URL(url);
                    if (
                      parsed.hostname.includes("google.") &&
                      parsed.pathname === "/imgres"
                    ) {
                      const real = parsed.searchParams.get("imgurl");
                      if (real) resolvedUrl = decodeURIComponent(real);
                    }
                  } catch {}

                  const looksLikeImage =
                    /\.(png|jpe?g|gif|webp|svg)(\?|$)/i.test(resolvedUrl);

                  // --- CASE 3: non-image URL → bookmark ---
                  if (!looksLikeImage) {
                    createBookmarkFallback(url);
                    return;
                  }

                  // --- CASE 4: image URL (drag-and-drop) → proxy, upload, create image shape ---
                  try {
                    const proxied =
                      "https://flask-app-jqwkqdscaq-uc.a.run.app/proxy-image?url=" +
                      encodeURIComponent(resolvedUrl);
                    const res = await fetch(proxied);
                    if (!res.ok)
                      throw new Error(`Proxy fetch failed: ${res.status}`);
                    const blob = await res.blob();
                    const ext = (blob.type.split("/")[1] || "png").replace(
                      "jpeg",
                      "jpg"
                    );
                    await uploadAndCreateImageShape(blob, ext);
                  } catch (err) {
                    console.error(
                      "[drop-image] Failed to resolve image, falling back to bookmark:",
                      err
                    );
                    createBookmarkFallback(url);
                  }
                }
              );

              const queued = pendingPublishShapesRef.current;

              // A publish queued from either direction resolves here: this
              // onMount fires every time a canvas (re)mounts (canvasMode
              // flips, which remounts <Tldraw key={canvasMode}>), so we
              // only consume the queued shapes once we've actually landed
              // on the mode they were destined for.
              if (queued?.destinationMode === canvasMode && queued?.shapes?.length) {
                const targetPageId = editor.getCurrentPageId?.();

                // Anchor the group to THIS editor's own current viewport —
                // wherever the person is actually looking on the
                // destination canvas right now — instead of the source
                // canvas's viewport (the earlier bug), while preserving
                // each shape's original offset from the group's center so
                // multi-shape selections keep their relative layout.
                const destBounds = editor.getViewportPageBounds();
                const destCenterX = (destBounds.minX + destBounds.maxX) / 2;
                const destCenterY = (destBounds.minY + destBounds.maxY) / 2;

                const shapesToCreate = queued.shapes.map((s, index) => ({
                  ...s,
                  parentId: targetPageId || s.parentId,
                  x: destCenterX + (s.x - queued.groupCenterX) + index * 4,
                  y: destCenterY + (s.y - queued.groupCenterY) + index * 4,
                }));

                try {
                  editor.createShapes(shapesToCreate);
                  pendingPublishShapesRef.current = null;

                  // Keep whatever just arrived — a single shape or a whole
                  // group — visibly selected/highlighted on this side, so
                  // it's obvious what landed and where. Selection persists
                  // until the user clicks elsewhere, unlike a transient
                  // flash, which is what "stay highlighted" calls for.
                  try {
                    editor.setSelectedShapes(shapesToCreate.map((s) => s.id));
                  } catch (err) {
                    console.error(
                      "[portal] failed to select published shapes:",
                      err
                    );
                  }

                  // Last-writer-wins repair pass: whatever Firestore state
                  // exists right now for these shapes (possibly wiped by
                  // an unrelated delete-on-removal listener, possibly
                  // fine), overwrite it with the metadata we captured
                  // before the publish started, tagged as now living in
                  // the public space. This runs after both the delete and
                  // the recreate, so it's the final word regardless of
                  // how those two resolved relative to each other.
                  if (queued.firestoreMetaByShapeId) {
                    const restoreUserContext = {
                      className,
                      projectName,
                      teamName,
                      userId: currentUserId,
                    };
                    Object.entries(queued.firestoreMetaByShapeId).forEach(
                      ([shapeId, meta]) => {
                        restoreShapeMetadata(shapeId, restoreUserContext, {
                          ...meta,
                          space: queued.destinationMode,
                        }).catch((err) =>
                          console.error(
                            "[portal] failed to restore Firestore metadata for",
                            shapeId,
                            err
                          )
                        );
                      }
                    );
                  }
                } catch (err) {
                  console.error(
                    "[portal] FAILED to create queued shapes on public canvas:",
                    err
                  );
                }
              }
            }}
            store={isPublicMode ? store : privateStore}
            tools={toolsMemo}
            shapeUtils={shapeUtilsMemo}
            overrides={uiOverrides}
            components={tldrawComponents}
          />
        </UserContext.Provider>

        <CanvasPortal
          canvasMode={canvasMode}
          onToggle={handlePortalToggle}
          isDraggingSelection={isDraggingSelection}
          isDragPublishReady={isPortalDropReady}
          otherStore={isPublicMode ? privateStore : store}
          shapeUtils={shapeUtilsMemo}
          bindingUtils={BINDING_UTILS}
          arrivalPulse={portalArrivalPulse}
        />

        <PortalSuckOverlay
          effect={portalSuckEffect}
          onDone={handleSuckAnimationDone}
        />

        <img
          ref={dragGhostElRef}
          alt=""
          style={{
            position: "fixed",
            left: 0,
            top: 0,
            width: 0,
            height: 0,
            opacity: 0,
            pointerEvents: "none",
            zIndex: 10125,
            borderRadius: 6,
          }}
        />

        <RobotDock
          src={robotSrc}
          loop={robotLoop}
          onEnded={null}
          phase={robotPhase || currentPhaseName}
          countdownEndsAt={robotCountdownEndsAt}
          countdownDurationMs={30000}
          show={true}
          position={robotPosition}
          size={ROBOT_SIZE}
          onOpenChat={() => setChatbotOpen(true)}
          zIndex={10070}
        />

        {/* History/Comments panel — previously rendered from inside
            tldraw's components.ContextMenu slot, which is built on a
            transient Radix ContextMenu primitive meant for the ephemeral
            right-click menu. That primitive mounts/unmounts its content
            and auto-dismisses on outside interaction by design, which a
            persistent panel doesn't want. As an ordinary sibling here, it
            has its own independent lifecycle again. */}
        <div className="panelContainerWrapper">
          {isPanelCollapsed ? (
            <ToggleExpandButton
              isPanelCollapsed={isPanelCollapsed}
              togglePanel={togglePanel}
            />
          ) : (
            <HistoryCommentPanel
              actionHistory={actionHistory}
              comments={comments}
              selectedShape={selectedShape}
              isPanelCollapsed={isPanelCollapsed}
              togglePanel={togglePanel}
              onHistoryItemClick={handleHistoryItemClick}
              isPublicCanvas={isPublicMode}
              shapes={shapesForAnalysis}
              onCommentItemClick={handleCommentItemClick}
            />
          )}
        </div>

        {!showSidebar && (
          <ChatBot
            messages={messages}
            setMessages={setMessages}
            externalMessages={externalMessages}
            toggleSidebar={handleToggleSidebar}
            user_id={
              auth.currentUser?.displayName || auth.currentUser?.email || "anon"
            }
            canvasId={`${className}_${projectName}_${teamName}`}
            role={"catalyst"}
            targets={selectedTargets}
            params={{}}
            shapes={shapesForAnalysis}
            forceOpen={chatbotOpen}
            onClose={() => setChatbotOpen(false)}
            onNudgeComputed={({
              tailShapeIds,
              currentPhase,
              source,
              trigger,
            }) => {
              pushNudgeToChatbot({
                source: source || "button",
                tailShapeIds,
                metrics: currentPhase,
                trigger,
              });
            }}
            nudgeFocusShapeId={nudgeFocusShapeId}
            onNudgeFocusComputed={() => setNudgeFocusShapeId(null)}
            variant="floating"
            onTriggerFired={(triggerId) => {
              playTriggerAnimation(triggerId);
            }}
          />
        )}

        <ChatSidebar
          isOpen={showSidebar}
          onClose={() => setShowSidebar(false)}
          messages={messages}
          setMessages={setMessages}
          canvasId={`${className}_${projectName}_${teamName}`}
          role="catalyst"
          user_id={
            auth.currentUser?.displayName || auth.currentUser?.email || "anon"
          }
          targets={selectedTargets}
          params={{}}
          shapes={shapesForAnalysis}
          onNudgeComputed={({
            tailShapeIds,
            currentPhase,
            source,
            nudgeText,
          }) => {
            setPhaseTailShapeIds(tailShapeIds || []);

            setCurrentPhaseDetail(currentPhase || null);

            const phaseName =
              currentPhase?.current_phase_dc ||
              currentPhase?.current_phase_full ||
              null;

            setCurrentPhaseName(phaseName);

            setPhaseNudgePreview(nudgeText || "");

            if (source === "button") {
              setIsPhasePulsing(true);
            }
          }}
          nudgeFocusShapeId={nudgeFocusShapeId}
          onNudgeFocusComputed={() => setNudgeFocusShapeId(null)}
        />
      </div>
    </>
  );
};

export default CollaborativeWhiteboard;