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
import ContextToolbarComponent from "./ContextToolbarComponent";
import { AudioShapeUtil } from "../shapes/AudioShapeUtil";
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
        console.log("presence write failed", e);
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

  const portalDropReadyRef = useRef(false);
  useEffect(() => {
    portalDropReadyRef.current = isPortalDropReady;
  }, [isPortalDropReady]);

  const panelCollapsedRef = useRef(isPanelCollapsed);

  useEffect(() => {
    console.log("[Canvas] editorReady changed:", editorReady);
  }, [editorReady]);

  const [selectionModeActive, setSelectionModeActive] = useState(false);

  const [phaseTailShapeIds, setPhaseTailShapeIds] = useState([]);

  const [nudgeFocusShapeId, setNudgeFocusShapeId] = useState(null);
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
  }, [editorReady]);

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
        console.log("actorId:", actorId);

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
      if (!triggerId) {
        console.log(
          "[RobotDock] playTriggerAnimation called with no triggerId"
        );
        return;
      }

      console.log("[RobotDock] Playing animation for trigger:", triggerId);

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
    console.log("[portal] found element:", !!el);
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

  const publishShapesToPublic = useCallback(
    (shapeIds) => {
      const editor = editorInstance.current;
      if (!editor || !shapeIds?.length) return;
      if (canvasMode !== "private") return;

      const shapes = shapeIds.map((id) => editor.getShape(id)).filter(Boolean);

      if (!shapes.length) return;

      const bounds = editor.getViewportPageBounds();
      const baseX = (bounds.minX + bounds.maxX) / 2;
      const baseY = (bounds.minY + bounds.maxY) / 2;

      const preparedShapes = shapes.map((shape, index) => ({
        ...shape,
        id: createShapeId(),
        x: baseX + index * 24,
        y: baseY + index * 24,
        meta: {
          ...(shape.meta || {}),
          publishedFromPrivate: true,
          publishedAt: Date.now(),
        },
      }));

      pendingPublishShapesRef.current = preparedShapes;

      console.log("[portal] queued shapes for publish:", preparedShapes);

      setCanvasMode("public");
    },
    [canvasMode]
  );

  useEffect(() => {
    if (!editorReady) return;
    if (!isPublicMode) return;

    const editor = editorInstance.current;
    const queuedShapes = pendingPublishShapesRef.current;

    if (!editor || !queuedShapes?.length) return;

    try {
      editor.createShapes(queuedShapes);
      console.log("[portal] published queued shapes into public canvas");
      pendingPublishShapesRef.current = null;
    } catch (err) {
      console.error(
        "[portal] failed to create queued shapes in public canvas:",
        err
      );
    }
  }, [editorReady, isPublicMode]);

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
    if (canvasMode !== "private") {
      setIsDraggingSelection(false);
      setIsPortalDropReady(false);
      return;
    }

    let rafId = 0;

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
        rafId = requestAnimationFrame(tick);
        return;
      }

      setIsDraggingSelection((prev) => (prev ? prev : true));

      const { x, y } = pointerScreenRef.current || { x: 0, y: 0 };
      const ready = isPointNearPortal(x, y);

      console.log("[portal] drag check", {
        pointer: pointerScreenRef.current,
        ready,
        selectedCount: selectedIds.length,
        canvasMode,
      });

      setIsPortalDropReady((prev) => (prev === ready ? prev : ready));

      rafId = requestAnimationFrame(tick);
    };

    const onPointerUp = () => {
      const editor = editorInstance.current;
      if (!editor) return;

      const selectedIds = editor.getSelectedShapeIds?.() || [];

      if (portalDropReadyRef.current && selectedIds.length) {
        publishShapesToPublic(selectedIds);
      }

      setIsDraggingSelection(false);
      setIsPortalDropReady(false);
    };

    rafId = requestAnimationFrame(tick);
    window.addEventListener("pointerup", onPointerUp);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [editorReady, canvasMode, isPointNearPortal, publishShapesToPublic]);

  const nudgeHoverPrevSelectionRef = useRef(null);

  const [nudgeModal, setNudgeModal] = useState({
    open: false,
    shapeId: null,
    nudges: [],
  });

  const { actionHistory, setActionHistory, fetchActionHistory } =
    useCanvasActionHistory({ className, projectName, teamName });

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
        console.log("[FS speech] for analysis:", speech);
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
      (err) => console.log("[presence] listen error", err)
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
    console.log(
      "[speech] Normalized speech for analysis:",
      normalizedSpeechForAnalysis
    );
  }, [normalizedSpeechForAnalysis]);

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
      console.log("[Chatbot] selection mode:", enabled);
    };

    window.addEventListener("chatbot-selection-mode", handler);
    return () => window.removeEventListener("chatbot-selection-mode", handler);
  }, []);

  useEffect(() => {
    const handleNudgeHover = (e) => {
      console.group("[Canvas] chatbot-nudge-hover event");
      console.log("Raw event:", e);

      const detail = e.detail || {};
      console.log("Event detail:", detail);

      const editor = editorInstance.current;
      if (!editor) {
        console.log("[Canvas] No editor instance yet");
        console.groupEnd();
        return;
      }

      const active = !!detail.active;
      const tailShapeIds = Array.isArray(detail.tailShapeIds)
        ? detail.tailShapeIds
        : [];

      console.log("active:", active);
      console.log("tailShapeIds (from event):", tailShapeIds);

      if (active && tailShapeIds.length) {
        if (!nudgeHoverPrevSelectionRef.current) {
          try {
            const currentSel = editor.getSelectedShapeIds();
            console.log("[Canvas] Saving previous selection:", currentSel);
            nudgeHoverPrevSelectionRef.current = currentSel;
          } catch (err) {
            console.log("[Canvas] Failed to read selected shape ids:", err);
            nudgeHoverPrevSelectionRef.current = [];
          }
        }

        const validIds = tailShapeIds.filter((id) => {
          const shape = editor.getShape(id);
          const exists = !!shape;
          if (!exists) {
            console.log("[Canvas] Tail shape not found in editor:", id);
          } else {
            console.log("[Canvas] Tail shape exists:", id, shape);
          }
          return exists;
        });

        console.log("[Canvas] Valid tail ids to select:", validIds);

        try {
          editor.setSelectedShapes(validIds);
          console.log(
            "[Canvas] Selection after hover:",
            editor.getSelectedShapeIds()
          );
        } catch (err) {
          console.log("[Canvas] Failed to set selection for nudge hover:", err);
        }

        console.groupEnd();
        return;
      }

      const prev = nudgeHoverPrevSelectionRef.current;
      console.log("[Canvas] Hover end. Previous selection to restore:", prev);

      if (prev && prev.length) {
        const validPrev = prev.filter((id) => !!editor.getShape(id));
        console.log("[Canvas] Valid previous selection:", validPrev);
        try {
          editor.setSelectedShapes(validPrev);
          console.log(
            "[Canvas] Selection after restore:",
            editor.getSelectedShapeIds()
          );
        } catch (err) {
          console.log("[Canvas] Failed to restore previous selection:", err);
        }
      } else {
        console.log("[Canvas] No previous selection, clearing selection");
        try {
          editor.setSelectedShapes([]);
        } catch (err) {
          console.log("[Canvas] Failed to clear selection on hover end:", err);
        }
      }

      nudgeHoverPrevSelectionRef.current = null;
      console.groupEnd();
    };

    console.log("[Canvas] Adding listener for 'chatbot-nudge-hover'");
    window.addEventListener("chatbot-nudge-hover", handleNudgeHover);
    return () => {
      console.log("[Canvas] Removing listener for 'chatbot-nudge-hover'");
      window.removeEventListener("chatbot-nudge-hover", handleNudgeHover);
    };
  }, []);

  useEffect(() => {
    if (!editorReady) return;
    const editor = editorInstance.current;
    if (!editor) return;

    const handleRequestSelection = () => {
      const selection = makeSelectionSummary(editor);

      if (!selection.ids || selection.ids.length === 0) {
        console.log("[Chatbot] No shapes selected to add as clips");
        return;
      }

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
    console.log("Nudge message from context menu:", nudgeMessage);
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
    console.log("Adding comment for shapeId:", shapeId);

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

      console.log("Uploading audio to Firebase:", filename);
      const snapshot = await uploadBytes(audioRef, blob, metadata);
      console.log("Upload successful:", snapshot);

      const url = await getDownloadURL(audioRef);
      console.log("Audio URL:", url);
      return url;
    } catch (error) {
      console.error("Error uploading to Firebase:", error);
      if (
        error.code === "storage/unauthorized" ||
        error.code === "storage/cors-error"
      ) {
        console.log("Using local blob URL as fallback");
        return URL.createObjectURL(blob);
      }
      throw error;
    }
  }, []);

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

      console.log("[Chat] openChatForShape ->", shapeId);

      let selectedIds = editor.getSelectedShapeIds();

      if (shapeId) {
        const isInSelection = selectedIds.includes(shapeId);

        if (!isInSelection) {
          editor.select([shapeId]);
          selectedIds = [shapeId];
        }
      }

      const selection = makeSelectionSummary(editor);

      console.log("[CHAT] Selected Ids: ", selection.ids);
      const shapesRaw = selection.ids.map((id) => editor.getShape(id));
      console.log("[Chat] Raw Selected Shapes:", shapesRaw);

      console.log("[Chat] Selection Summary:", selection);

      const primaryId = shapeId || selection.primary?.id || selection.ids[0];
      const primaryShape = primaryId ? editor.getShape(primaryId) : null;

      setSelectedTargets(selection.ids);
      setSelectedShape(primaryShape ?? null);

      const payload = buildAiPayloadFromSelection(selection, editor);
      console.log("[Chat] AI Payload from hover Ask AI:", payload);

      window.dispatchEvent(
        new CustomEvent("trigger-chatbot", { detail: payload })
      );
    },
    [setSelectedTargets, setSelectedShape]
  );

  const handlePhaseNudgeClick = useCallback((shapeId) => {
    setNudgeFocusShapeId(shapeId);
  }, []);

  useEffect(() => {
    panelCollapsedRef.current = isPanelCollapsed;
  }, [isPanelCollapsed]);

  const togglePanelRef = useRef(togglePanel);
  useEffect(() => {
    togglePanelRef.current = togglePanel;
  }, [togglePanel]);

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

  const commentsRef = useRef(comments);
  useEffect(() => {
    commentsRef.current = comments;
  }, [comments]);

  const actionHistoryRef = useRef(actionHistory);
  useEffect(() => {
    actionHistoryRef.current = actionHistory;
  }, [actionHistory]);

  const userRoleRef = useRef(userRole);
  useEffect(() => {
    userRoleRef.current = userRole;
  }, [userRole]);

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

      console.log("[Analyze] Payload:", payload);

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
            console.error
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
    onError: (e) => console.log("[Proactive] analyze error", e),

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
      console.log(
        "[speech] bumping proactive activity from speech:",
        meaningfulUtterances
      );

      bumpActivity(meaningfulUtterances.length);
    }

    prevSpeechCountRef.current = currentCount;
  }, [normalizedSpeechForAnalysis, aiEnabled, editorReady, bumpActivity]);

  const proactiveRef = useRef({
    eventCount: 0,
    firstEventAt: 0,
    lastAnalyzeAt: 0,
    idleTimer: null,
    forceTimer: null,
    inFlight: null,
  });

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
          comments={commentsRef.current}
          setComments={setComments}
          actionHistory={actionHistoryRef.current}
          setActionHistory={setActionHistory}
          onNudge={(msg) => handleNudgeFromContextMenuRef.current?.(msg)}
          onTargetsChange={setSelectedTargets}
          isPanelCollapsed={panelCollapsedRef.current}
          togglePanel={() => togglePanelRef.current?.()}
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

    return {
      ContextMenu,
      InFrontOfTheCanvas,
      Toolbar,
      ActionsMenu,
      NavigationPanel,
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
      <Navbar />
      <div
        className={`main-container ${phaseClass} ${
          isPhasePulsing ? "phase-pulse" : ""
        }`}
        style={{ position: "fixed", inset: 0 }}
      >
        <div
          style={{
            position: "fixed",
            top: 72,
            left: 20,
            zIndex: 10100,
            padding: "6px 10px",
            borderRadius: 999,
            background: "rgba(255,255,255,0.92)",
            border: "1px solid rgba(0,0,0,0.08)",
            boxShadow: "0 4px 14px rgba(0,0,0,0.08)",
            fontSize: 12,
            fontWeight: 700,
            color: "#334155",
          }}
        >
          Mode: {isPublicMode ? "Public" : "Private"}
        </div>

        <UserContext.Provider value={userCtxValue}>
          <Tldraw
            key={canvasMode}
            onMount={(editor) => {
              console.log("[Canvas] Tldraw onMount fired", {
                hasEditor: !!editor,
                mode: canvasMode,

                hasStore: !!editor?.store,
                hasListen: !!editor?.store?.listen,
              });
              editorInstance.current = editor;
              console.log("[Canvas] editorInstance.current set", {
                hasEditorRef: !!editorInstance.current,
              });
              setEditorReady(true);
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
        />

        {isPublicMode && (
          <SessionSpeechCapture
            className={className}
            projectName={projectName}
            teamName={teamName}
          />
        )}

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
            console.log(
              "[Parent] tailShapeIds from /analyze (sidebar):",
              tailShapeIds
            );
            console.log(
              "[Parent] currentPhase from /analyze (sidebar):",
              currentPhase
            );

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
