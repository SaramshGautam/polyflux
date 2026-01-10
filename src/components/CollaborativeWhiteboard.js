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
// import { MiniWhiteboard } from "../MiniWhiteboard";
// import ViewerPortal from "../ViewerPortal";
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
import {
  resolveImageUrl,
  extractShapeText,
  makeSelectionSummary,
  buildAiPayloadFromSelection,
} from "./helpers/askai";
import { useProactiveNudges } from "./whiteboard/UseProactiveNudge";

const CUSTOM_TOOLS = [MicrophoneTool];
const SHAPE_UTILS = [...defaultShapeUtils, AudioShapeUtil];
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
      if (now - lastWrite.current < 120) return; // throttle ~8 fps
      lastWrite.current = now;

      const cam = editor.getCamera();
      const pageId = editor.getCurrentPageId?.();

      // Cursor (Vec-like) -> plain {x, y}
      const cp = editor.inputs?.currentPagePoint;
      const cursor = cp ? { x: Number(cp.x) || 0, y: Number(cp.y) || 0 } : null;

      // Viewport screen bounds (Box-like) -> plain {w, h}
      const vsb = editor.getViewportScreenBounds?.();
      const viewport = vsb
        ? {
            w: Math.max(0, Math.round(vsb.width)),
            h: Math.max(0, Math.round(vsb.height)),
          }
        : null;

      // Build a JSON-safe payload (no classes / functions / NaN / Infinity)
      const payloadObj = {
        camera: {
          x: Number(cam.x) || 0,
          y: Number(cam.y) || 0,
          z: Number(cam.z) || 1,
        },
        pageId: pageId || null,
        cursor, // plain or null
        viewport, // plain or null
        displayName: user.displayName || user.email || "anon",
        email: user.email || null,
        photoURL: user.photoURL || null,
      };

      // Cheap change detection to avoid extra writes
      const payload = JSON.stringify(payloadObj);
      if (payload === prev) return;
      prev = payload;

      setDoc(
        presRef,
        { ...payloadObj, lastActive: serverTimestamp() },
        { merge: true }
      ).catch((e) => {
        // Optional: log once if something slips through
        console.log("presence write failed", e);
      });
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, editorRef, className, projectName, teamName]);
}

// ✅ Trigger -> video mapping (use your imported mp4s)
const TRIGGER_TO_VIDEO = {
  stagnant_divergence: UnderExploreDivegence,
  scattered_divergence: LongRunningDivergence,
  early_convergence: EarlyConvergence,
  refinement_loop: RefinementLoop,
  long_lull: LongLull,
  participation_imbalance_group: ParticipationImbalance,
};

// ✅ Optional ring color/phase for the robot border
const TRIGGER_TO_PHASE = {
  stagnant_divergence: "divergent",
  scattered_divergence: "divergent",
  early_convergence: "convergent",
  refinement_loop: "convergent",
  long_lull: "divergent",
  participation_imbalance_group: "convergent",
};

function normalizeShapeId(id) {
  // If your tldraw ids already include "shape:", this does nothing.
  // If your tldraw ids are like "1FbinxG-...", it will convert to "shape:1FbinxG-..."
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
        const createdBy = data.createdBy; // e.g. "P4"
        if (shapeId && createdBy) next[shapeId] = createdBy;
      });
      setShapeActorIdByShapeId(next);
      // console.log(
      //   "[Firestore] shapeActorIdByShapeId size:",
      //   Object.keys(next).length
      // );
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

  // Multi-select mode
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

  // Single hover mode
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

    // --- selection-mode clip sending ---
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

    // --- image URL upsert ---
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
  // const [actionHistory, setActionHistory] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const editorInstance = useRef(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [showSidebar, setShowSidebar] = useState(false);
  const [messages, setMessages] = useState([]);
  const [shapesForAnalysis, setShapesForAnalysis] = useState([]);

  const recorderRef = useRef(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState(null);
  const [elapsed, setElapsed] = useState("0:00");

  const [showMini, setShowMini] = useState(false);
  const [showViewer, setShowViewer] = useState(false);
  const [editorReady, setEditorReady] = useState(false);

  const [sessionActors, setSessionActors] = useState([]);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  // --- bridge refs (anything used inside Tldraw components that changes) ---
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

  // ✅ Robot animation state
  const [robotSrc, setRobotSrc] = useState(DefaultMp4);
  const [robotLoop, setRobotLoop] = useState(true);
  const [robotPhase, setRobotPhase] = useState(null);
  const ROBOT_GAP_PX = 10; // how many px above the minimap/panel
  const [chatbotOpen, setChatbotOpen] = useState(false);
  const ROBOT_SIZE = 50; // must match <RobotDock size={...} />

  const [robotPosition, setRobotPosition] = useState({ left: 16, bottom: 158 });

  useEffect(() => {
    if (!editorReady) return;

    let el = null;
    let ro = null;
    let raf = 0;

    const update = () => {
      if (!el) return;

      const rect = el.getBoundingClientRect();

      // Place robot directly ABOVE the nav panel (collapsed or expanded)
      const left = Math.round(rect.left);
      const top = Math.round(rect.top - ROBOT_GAP_PX - ROBOT_SIZE);

      // Clamp to viewport a bit (optional)
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

      // Resize observer catches collapse/expand + internal layout changes
      ro = new ResizeObserver(() => {
        cancelAnimationFrame(raf);
        raf = requestAnimationFrame(update);
      });
      ro.observe(el);

      // Window resize can change fixed UI positions
      window.addEventListener("resize", update);

      // Initial
      update();
      return true;
    };

    // Try now, and if not found yet, retry briefly
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

  // Global cooldown: after we emit an auto nudge, don't call /analyze again for 120s
  const autoGlobalCooldownUntilRef = useRef(0);

  // Same-trigger cooldown: don't emit same trigger again for 120s
  const autoTriggerCooldownMapRef = useRef({}); // { [triggerId]: lastEmittedAtMs }

  const [robotCountdownEndsAt, setRobotCountdownEndsAt] = useState(null);

  const triggerLoopTimerRef = useRef(null);

  const actorIdRef = useRef("anon");
  useEffect(() => {
    actorIdRef.current =
      auth.currentUser?.displayName || auth.currentUser?.email || "anon";
  }, []);

  // prevents infinite loops when we call editor.updateShape inside a listener
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

        // Helper to handle both add + update
        const maybeStamp = (rec) => {
          // tldraw records: shape records typically have typeName === "shape"
          if (!rec) return;
          const isShapeRecord =
            rec.typeName === "shape" ||
            rec.type === "shape" ||
            rec.kind === "shape";
          if (!isShapeRecord) return;

          const shape = editor.getShape(rec.id);
          if (!shape) return;

          const nextMeta = { ...(shape.meta || {}) };

          // If createdBy not set, set it once
          if (!nextMeta.createdBy) nextMeta.createdBy = actorId;

          // Always stamp updatedBy on user-driven updates
          nextMeta.updatedBy = actorId;
          nextMeta.updatedAt = Date.now();

          // Avoid no-op updates
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
            // release on next tick so we don't re-enter immediately
            setTimeout(() => {
              stampingRef.current = false;
            }, 0);
          }
        };

        // On add: stamp createdBy + updatedBy
        for (const rec of added) maybeStamp(rec);

        // On update: stamp updatedBy
        for (const rec of updated) maybeStamp(rec);
      },
      { scope: "user" } // IMPORTANT: only local user's actions
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

      // Optional: avoid replaying the same trigger repeatedly
      // if (lastTriggerRef.current === triggerId) return;
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

      // Play once; RobotDock will revert via onEnded
      setRobotSrc(vid);
      setRobotLoop(true);

      triggerLoopTimerRef.current = setTimeout(() => {
        revertRobotToDefault();
      }, TRIGGER_DURATION_MS);
    },
    [revertRobotToDefault]
  );

  // const revertRobotToDefault = useCallback(() => {
  //   setRobotLoop(true);
  //   setRobotSrc(DefaultMp4);
  //   setRobotPhase(null);
  //   lastTriggerRef.current = null;
  // }, []);

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
    enabled: editorReady,
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

    // classrooms/{className}/Projects/{projectName}/teams/{teamName}/shapes
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
          ...docSnap.data(), // this stays in your Firestore "shape" format
        }));

        setShapesForAnalysis(shapes);
        // console.log("[FS shapes] for analysis:", shapes);
      },
      (error) => {
        console.error("Error listening to shapes:", error);
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
          // const id = d.id;

          return {
            id: d.id,
            label: data.displayName || data.email || d.id,
            email: data.email || null,
            photoURL: data.photoURL || null,
            lastActive: data.lastActive || null,
          };
        });

        // optional sort for nicer dropdown
        actors.sort((a, b) => (a.label || "").localeCompare(b.label || ""));

        setSessionActors(actors);
      },
      (err) => console.log("[presence] listen error", err)
    );

    return () => unsub();
  }, [className, projectName, teamName]);

  const actorsFromFS = useMemo(() => {
    const set = new Set();
    (shapesForAnalysis || []).forEach((s) => {
      if (s.createdBy) set.add(s.createdBy);
      // if later you add updatedBy in firestore, include it:
      // if (s.updatedBy) set.add(s.updatedBy);
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
        // Save current selection once at hover start
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

        // Check which of these shapes actually exist
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

      // Hover ended or nothing active: restore previous selection
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
      // 1. Build selection summary (handles multi-select)
      const selection = makeSelectionSummary(editor);

      if (!selection.ids || selection.ids.length === 0) {
        console.log("[Chatbot] No shapes selected to add as clips");
        return;
      }

      // 2. Build the same payload Ask AI uses (with meta.selection)
      const payload = buildAiPayloadFromSelection(selection, editor);

      // 3. Reuse the same flow: send it as trigger-chatbot
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
    // store: customStore,
    shapeUtils: SHAPE_UTILS,
    bindingUtils: BINDING_UTILS,
  });

  // const toggleSidebar = useCallback(() => {
  //   setIsSidebarOpen((prev) => !prev);
  // }, []);

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

  // useEffect(() => {
  //   if (editorInstance) {
  //     saveCanvasPreview();
  //   }
  //   return () => {
  //     saveCanvasPreview();
  //   };
  // }, [store]);

  // useEffect(() => {
  //   if (!editorReady) return;
  //   if (!className || !projectName || !teamName) return;

  //   const handleBeforeUnload = (event) => {
  //     // Fire and forget – we can't `await` here
  //     saveCanvasPreview();
  //   };

  //   window.addEventListener("beforeunload", handleBeforeUnload);

  //   return () => {
  //     window.removeEventListener("beforeunload", handleBeforeUnload);
  //     // Component is unmounting (user navigated away from whiteboard route)
  //     saveCanvasPreview();
  //   };
  // }, [editorReady, className, projectName, teamName]);

  // const togglePanel = () => {
  //   console.log("[Parent] togglePanel called");
  //   setIsPanelCollapsed((prev) => {
  //     console.log("[Parent] Collapsed before:", prev, " → after:", !prev);
  //     return !prev;
  //   });
  // };

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

  // const components = {
  //   Navbar: Navbar,
  //   ContextMenu: CustomContextMenu,
  //   InFrontOfTheCanvas: ContextToolbarComponent,
  //   Toolbar: DefaultToolbar,
  //   // Toolbar: CustomToolbar,
  //   ActionsMenu: CustomActionsMenu,
  // };

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

  // const saveCanvasPreview = useCallback(async () => {
  //   const editor = editorInstance.current;
  //   if (!editor || !className || !projectName || !teamName) return;

  //   const shapeIds = editor.getCurrentPageShapeIds();
  //   if (!shapeIds || shapeIds.size === 0) return;

  //   try {
  //     // 1) Render the current page shapes to a PNG blob
  //     const { blob } = await editor.toImage([...shapeIds], {
  //       format: "png",
  //       padding: 20,
  //       background: "white", // optional: ensure white background instead of transparent
  //     });

  //     // 2) Upload to Firebase Storage
  //     const path = `previews/${className}/${projectName}/${teamName}.png`;
  //     const imgRef = ref(storage, path);

  //     await uploadBytes(imgRef, blob, { contentType: "image/png" });
  //     const downloadURL = await getDownloadURL(imgRef);

  //     // 3) Save previewUrl to the team document in Firestore
  //     const teamRef = doc(
  //       db,
  //       "classrooms",
  //       className,
  //       "Projects",
  //       projectName,
  //       "teams",
  //       teamName
  //     );

  //     await setDoc(teamRef, { previewUrl: downloadURL }, { merge: true });

  //     console.log("✅ Canvas preview saved:", path);
  //   } catch (error) {
  //     console.error("Error saving canvas preview:", error);
  //   }
  // }, [className, projectName, teamName]);

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
        // const { x, y } = editor.getViewportScreenCenter();
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

  const shapeActorIdByShapeId = useShapeCreatedByMap(
    db,
    className,
    projectName,
    teamName
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

  // room meta & helpers used inside InFront components
  const roomMetaRef = useRef({ className, projectName, teamName });
  useEffect(() => {
    roomMetaRef.current = { className, projectName, teamName };
  }, [className, projectName, teamName]);

  const upsertImageUrlRef = useRef(upsertImageUrl);
  useEffect(() => {
    upsertImageUrlRef.current = upsertImageUrl;
  }, [upsertImageUrl]);

  // Navigation panel data
  const actorOptionsRef = useRef(actorOptions);
  useEffect(() => {
    actorOptionsRef.current = actorOptions;
  }, [actorOptions]);

  const shapeActorIdByShapeIdRef = useRef(shapeActorIdByShapeId);
  useEffect(() => {
    shapeActorIdByShapeIdRef.current = shapeActorIdByShapeId;
  }, [shapeActorIdByShapeId]);

  // Recording UI bits (avoid re-creating Toolbar component)
  const elapsedRef = useRef(elapsed);
  useEffect(() => {
    elapsedRef.current = elapsed;
  }, [elapsed]);

  const analyzeFn = useCallback(
    async ({ source, signal }) => {
      // ✅ Global cooldown (auto only)
      if (source === "proactive") {
        const now = Date.now();
        if (now < autoGlobalCooldownUntilRef.current) {
          // Return a "no-op" result that normalizeAnalyzeResponse will treat as no trigger
          return { trigger: null, skipped: "global_cooldown" };
        }
      }

      const payload = {
        canvasId: `${className}_${projectName}_${teamName}`,
        shapes: shapesForAnalysis || [],
        source,
      };

      const res = await fetch("http://127.0.0.1:8060/analyze", {
        // const res = await fetch(
        //   "https://prediction-backend-g5x7odgpiq-uc.a.run.app/analyze",
        //   {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal,
      });

      if (!res.ok) {
        throw new Error(`/analyze failed: ${res.status}`);
      }
      return await res.json();
    },
    [className, projectName, teamName, shapesForAnalysis]
  );

  function normalizeAnalyzeResponse(data) {
    const trigger = data?.trigger || null;

    const tailShapeIdsRaw =
      data?.tail_shape_ids ?? data?.tailShapeIds ?? data?.tail_shape_ids ?? [];

    const tailShapeIds = (
      Array.isArray(tailShapeIdsRaw) ? tailShapeIdsRaw : []
    ).map((id) => (id?.startsWith("shape:") ? id : `shape:${id}`));

    const metrics = data?.current_phase ?? data?.currentPhase ?? null;

    return {
      tailShapeIds,
      metrics,
      trigger, // ✅ keep full trigger object (user_text, chips, role, dedupe_key, id, ...)
    };
  }

  const pushNudgeToChatbot = useCallback(
    ({ source, tailShapeIds, metrics, trigger }) => {
      // 1) If no real trigger, do nothing
      if (!trigger || !trigger.id) return;

      const text = (trigger?.user_text || "").trim();
      const chips = Array.isArray(trigger?.chips) ? trigger.chips : [];

      // 2) Update parent UI state (badges / background / robot) ONLY if trigger exists
      setPhaseTailShapeIds(tailShapeIds || []);
      setCurrentPhaseDetail(metrics || null);

      const phaseName =
        metrics?.current_phase_dc || metrics?.current_phase_full || null;

      // If phase is missing, don't overwrite with null (prevents “Predicted Phase:” blank)
      if (phaseName) setCurrentPhaseName(phaseName);

      setPhaseNudgePreview(text);
      setIsPhasePulsing(true);

      playTriggerAnimation(trigger.id);

      if (source === "proactive" && text) {
        const now = Date.now();

        // Same-trigger cooldown
        const lastAt = autoTriggerCooldownMapRef.current[trigger.id] || 0;
        if (now - lastAt < NUDGE_COOLDOWN_MS) {
          // don't emit the same trigger again yet
          return;
        }

        // ✅ mark emitted times
        autoTriggerCooldownMapRef.current[trigger.id] = now;
        autoGlobalCooldownUntilRef.current = now + NUDGE_COOLDOWN_MS;

        window.dispatchEvent(
          new CustomEvent("trigger-chatbot", {
            detail: {
              text,
              chips,
              role: trigger?.role || null,
              phase: metrics?.current_phase_dc || null,
              meta: {
                trigger,
                dedupe_key: trigger?.dedupe_key || null,
                triggerId: trigger.id,
                tailShapeIds: tailShapeIds || [],
                currentPhase: metrics || null,
              },
              source: "auto-nudge",
            },
          })
        );
      }

      // if (source === "proactive" && text) {
      //   setExternalMessages((prev) => [
      //     ...prev,
      //     { role: "assistant", type: "nudge", content: text, meta: { triggerId: trigger.id } },
      //   ]);
      // }
    },
    [playTriggerAnimation]
  );

  const onProactiveResult = useCallback(
    (raw) => {
      const data = normalizeAnalyzeResponse(raw);

      const trigger = data?.trigger || null;
      if (!trigger || !trigger.id) {
        // revertRobotToDefault();
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

  const { requestAnalyze } = useProactiveNudges({
    editorRef: editorInstance,
    editorReady,
    enabled: true,

    analyzeFn,
    onResult: onProactiveResult,
    onError: (e) => console.log("[Proactive] analyze error", e),

    idleDebounceMs: 3000,
    minGapMs: 10000,
    maxWaitMs: 30000,
    minEvents: 4,
  });

  // --- Proactive analyze trigger (bolt-like, but automatic) ---
  const proactiveRef = useRef({
    eventCount: 0,
    firstEventAt: 0,
    lastAnalyzeAt: 0,
    idleTimer: null,
    forceTimer: null,
    inFlight: null, // AbortController
  });

  function ToolbarComp(props) {
    // read editor & any global UI state here via hooks/refs/context as needed
    return <DefaultToolbar {...props} /* render your mic button etc. */ />;
  }

  function ContextMenuComp(props) {
    return (
      <CustomContextMenu
        {...props}
        /* read state inside or via a custom hook instead of closing over parent state */
      />
    );
  }

  function InFrontComp(props) {
    return (
      <>
        <SelectionLogger />
        <ContextToolbarComponent {...props} />
        <HoverActionBadge
          onIconClick={/* stable callback via ref (below) */ undefined}
        />
        <PhaseNudgeBadges /* read needed state internally */ />
      </>
    );
  }

  // 2) Pass a stable components object (NO deps)
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

      // NOTE: setters are stable; safe to call directly
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
          <button
            type="button"
            className="tlui-button tlui-button--icon"
            aria-pressed={isMicSelected}
            title={
              isRecordingRef.current
                ? `Stop recording • ${elapsedRef.current} / ${formatMs(
                    30000
                  )} (auto-stops at ${formatMs(30000)})`
                : `Record (auto-stops at ${formatMs(30000)})`
            }
            style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            onClick={async () => {
              if (!isRecordingRef.current) {
                await startRecordingRef.current?.();
              } else {
                await stopRecordingRef.current?.(editor);
              }
            }}
          >
            {isRecordingRef.current ? (
              <>
                <FontAwesomeIcon
                  icon={faCircleStop}
                  style={{ color: "red", fontSize: 14 }}
                />
                <span
                  style={{
                    fontFamily: "monospace",
                    fontVariantNumeric: "tabular-nums",
                  }}
                >
                  {elapsedRef.current}/{formatMs(30000)}
                </span>
              </>
            ) : (
              <FontAwesomeIcon icon={faMicrophone} style={{ fontSize: 16 }} />
            )}
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

  // const backgroundColor = getPhaseBackground();

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
        <Tldraw
          onMount={(editor) => {
            console.log("[Canvas] Tldraw onMount fired ✅", {
              hasEditor: !!editor,
              hasStore: !!editor?.store,
              hasListen: !!editor?.store?.listen,
            });
            editorInstance.current = editor;
            console.log("[Canvas] editorInstance.current set ✅", {
              hasEditorRef: !!editorInstance.current,
            });
            setEditorReady(true);
            // if (editorInstance) {
            //   saveCanvasPreview();
            // }
          }}
          store={store}
          // schema={schema}
          tools={toolsMemo}
          shapeUtils={SHAPE_UTILS}
          overrides={uiOverrides}
          components={tldrawComponents}
        />

        <RobotDock
          src={robotSrc}
          loop={robotLoop}
          // onEnded={!robotLoop ? revertRobotToDefault : null}
          onEnded={null}
          phase={robotPhase || currentPhaseName}
          // phase={currentPhaseName}
          countdownEndsAt={robotCountdownEndsAt}
          countdownDurationMs={30000}
          show={true}
          // position={{ left: 16, bottom: 158 }}
          position={robotPosition}
          size={ROBOT_SIZE}
          onOpenChat={() => setChatbotOpen(true)}
          zIndex={10070}
        />

        {!showSidebar && (
          <ChatBot
            // toggleSidebar={toggleSidebar}
            messages={messages}
            setMessages={setMessages}
            externalMessages={externalMessages}
            toggleSidebar={handleToggleSidebar}
            user_id={
              auth.currentUser?.displayName || auth.currentUser?.email || "anon"
            }
            // canvasId={roomId}
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
              // This is a BUTTON nudge; update badges/robot/background only.
              pushNudgeToChatbot({
                source: source || "button",
                tailShapeIds,
                metrics: currentPhase,
                trigger, // make sure ChatBot passes the full trigger object here
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

            // const phaseName =
            //   tailPhase && tailPhase.current_phase_dc
            //     ? tailPhase.current_phase_dc
            //     : null;

            // setCurrentPhaseName(phaseName);

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
