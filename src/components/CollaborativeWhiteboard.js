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
import { MiniWhiteboard } from "./MiniWhiteboard";
import ViewerPortal from "./ViewerPortal";
import { useCanvasActionHistory } from "./useCanvasActionHistory";
import {
  resolveImageUrl,
  extractShapeText,
  makeSelectionSummary,
  buildAiPayloadFromSelection,
} from "./helpers/askai";

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
        console.warn("presence write failed", e);
      });
    };

    rafRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafRef.current);
  }, [enabled, editorRef, className, projectName, teamName]);
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

  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);

  const [selectionModeActive, setSelectionModeActive] = useState(false);

  const [phaseTailShapeIds, setPhaseTailShapeIds] = useState([]);

  const [nudgeFocusShapeId, setNudgeFocusShapeId] = useState(null);
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
        console.log("[FS shapes] for analysis:", shapes);
      },
      (error) => {
        console.error("Error listening to shapes:", error);
      }
    );

    return () => unsubscribe();
  }, [className, projectName, teamName]);

  useEffect(() => {
    const handler = (e) => {
      const { enabled } = e.detail || {};
      setSelectionModeActive(Boolean(enabled));
      console.log("[Chatbot] selection mode:", enabled);
    };

    window.addEventListener("chatbot-selection-mode", handler);
    return () => window.removeEventListener("chatbot-selection-mode", handler);
  }, []);

  // useEffect(() => {
  //   const handleNudgeHover = (e) => {
  //     const detail = e.detail || {};
  //     const editor = editorInstance.current;
  //     if (!editor) return;

  //     const active = !!detail.active;
  //     const tailShapeIds = Array.isArray(detail.tailShapeIds)
  //       ? detail.tailShapeIds
  //       : [];

  //     // When hover starts
  //     if (active && tailShapeIds.length) {
  //       // Save current selection once
  //       if (!nudgeHoverPrevSelectionRef.current) {
  //         try {
  //           nudgeHoverPrevSelectionRef.current = editor.getSelectedShapeIds();
  //         } catch (err) {
  //           console.warn("Failed to read selected shape ids:", err);
  //           nudgeHoverPrevSelectionRef.current = [];
  //         }
  //       }

  //       // Clear and select only tail shapes (filter to shapes that still exist)
  //       const validIds = tailShapeIds.filter((id) => !!editor.getShape(id));
  //       try {
  //         editor.setSelectedShapes(validIds);
  //       } catch (err) {
  //         console.warn("Failed to set selection for nudge hover:", err);
  //       }

  //       return;
  //     }

  //     // When hover ends (or active false / no ids): restore previous selection
  //     const prev = nudgeHoverPrevSelectionRef.current;
  //     if (prev) {
  //       const validPrev = prev.filter((id) => !!editor.getShape(id));
  //       try {
  //         editor.setSelectedShapes(validPrev);
  //       } catch (err) {
  //         console.warn("Failed to restore previous selection:", err);
  //       }
  //     } else {
  //       // No previous selection → just clear
  //       try {
  //         editor.setSelectedShapes([]);
  //       } catch (err) {
  //         console.warn("Failed to clear selection on hover end:", err);
  //       }
  //     }

  //     nudgeHoverPrevSelectionRef.current = null;
  //   };

  //   window.addEventListener("chatbot-nudge-hover", handleNudgeHover);
  //   return () =>
  //     window.removeEventListener("chatbot-nudge-hover", handleNudgeHover);
  // }, []);

  // at top of component:

  useEffect(() => {
    const handleNudgeHover = (e) => {
      console.group("[Canvas] chatbot-nudge-hover event");
      console.log("Raw event:", e);

      const detail = e.detail || {};
      console.log("Event detail:", detail);

      const editor = editorInstance.current;
      if (!editor) {
        console.warn("[Canvas] No editor instance yet");
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
            console.warn("[Canvas] Failed to read selected shape ids:", err);
            nudgeHoverPrevSelectionRef.current = [];
          }
        }

        // Check which of these shapes actually exist
        const validIds = tailShapeIds.filter((id) => {
          const shape = editor.getShape(id);
          const exists = !!shape;
          if (!exists) {
            console.warn("[Canvas] Tail shape not found in editor:", id);
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
          console.warn(
            "[Canvas] Failed to set selection for nudge hover:",
            err
          );
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
          console.warn("[Canvas] Failed to restore previous selection:", err);
        }
      } else {
        console.log("[Canvas] No previous selection, clearing selection");
        try {
          editor.setSelectedShapes([]);
        } catch (err) {
          console.warn("[Canvas] Failed to clear selection on hover end:", err);
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

  useEffect(() => {
    if (!editorReady) return;
    if (!className || !projectName || !teamName) return;

    const handleBeforeUnload = (event) => {
      // Fire and forget – we can't `await` here
      saveCanvasPreview();
    };

    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      // Component is unmounting (user navigated away from whiteboard route)
      saveCanvasPreview();
    };
  }, [editorReady, className, projectName, teamName]);

  // const fetchActionHistory = async (userContext, setActionHistory) => {
  //   if (!userContext) return;

  //   const { className, projectName, teamName } = userContext;
  //   // const historyRef = collection(
  //   //   db,
  //   //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/history`
  //   // );
  //   console.log(
  //     `---- User Context --- ${className} and ${projectName} and  ${teamName}`
  //   );

  //   const historyRef = collection(
  //     db,
  //     "classrooms",
  //     className,
  //     "Projects",
  //     projectName,
  //     "teams",
  //     teamName,
  //     "history"
  //   );

  //   try {
  //     const q = query(historyRef, orderBy("timestamp", "desc"));
  //     const querySnapshot = await getDocs(q);
  //     const historyLogs = querySnapshot.docs.map((doc) => doc.data());
  //     console.log("History Logs ---- \n", historyLogs);

  //     setActionHistory(historyLogs);
  //   } catch (error) {
  //     console.error("❌ Error fetching history:", error);
  //   }
  // };

  // useEffect(() => {
  //   if (!roomId || !className || !projectName || !teamName) return;
  //   const userContext = { className, projectName, teamName };
  //   fetchActionHistory(userContext, setActionHistory);
  // }, [className, projectName, teamName, roomId]);

  const togglePanel = () => {
    console.log("[Parent] togglePanel called");
    setIsPanelCollapsed((prev) => {
      console.log("[Parent] Collapsed before:", prev, " → after:", !prev);
      return !prev;
    });
  };

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
  //   if (!editorInstance.current) return;

  //   const shapeIds = editorInstance.current.getCurrentPageShapeIds();
  //   if (shapeIds.size === 0) return;

  //   try {
  //     const { blob } = await editorInstance.current.toImage([...shapeIds], {
  //       format: "png",
  //       // bounds,
  //       // background: false,
  //       padding: 20,
  //       // background: false,
  //     });

  //     // Create a download link for the blob
  //     const url = URL.createObjectURL(blob);
  //     localStorage.setItem(
  //       `preview-${className}-${projectName}-${teamName}`,
  //       url
  //     );
  //   } catch (error) {
  //     console.error("Error uploading preview:", error);
  //   }
  // }, [className, projectName, teamName]);

  const saveCanvasPreview = useCallback(async () => {
    const editor = editorInstance.current;
    if (!editor || !className || !projectName || !teamName) return;

    const shapeIds = editor.getCurrentPageShapeIds();
    if (!shapeIds || shapeIds.size === 0) return;

    try {
      // 1) Render the current page shapes to a PNG blob
      const { blob } = await editor.toImage([...shapeIds], {
        format: "png",
        padding: 20,
        background: "white", // optional: ensure white background instead of transparent
      });

      // 2) Upload to Firebase Storage
      const path = `previews/${className}/${projectName}/${teamName}.png`;
      const imgRef = ref(storage, path);

      await uploadBytes(imgRef, blob, { contentType: "image/png" });
      const downloadURL = await getDownloadURL(imgRef);

      // 3) Save previewUrl to the team document in Firestore
      const teamRef = doc(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName
      );

      await setDoc(teamRef, { previewUrl: downloadURL }, { merge: true });

      console.log("✅ Canvas preview saved:", path);
    } catch (error) {
      console.error("Error saving canvas preview:", error);
    }
  }, [className, projectName, teamName]);

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
        console.warn("Using local blob URL as fallback");
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

  // const uiOverrides = useMemo(
  //   () => ({
  //     tools(editor, tools) {
  //       tools.microphone = {
  //         id: "microphone",
  //         label: "Record",
  //         kbd: "r",
  //         readonlyOk: false,

  //         onSelect: async () => {
  //           if (!isRecording) {
  //             startRecording();
  //           } else {
  //             await stopRecording(editor);
  //           }
  //         },
  //       };
  //       return tools;
  //     },
  //   }),
  //   // [recordOnce, uploadToFirebase]
  //   [isRecording, startRecording, stopRecording]
  // );

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

  const HoverActionBadge = ({ onIconClick }) => {
    const editor = useEditor();

    // hovered shape
    const hoveredId = useValue(
      "hovered shape id",
      () => editor.getHoveredShapeId?.() ?? null,
      [editor]
    );

    // selected shapes
    const selectedIds = useValue(
      "selected ids",
      () => editor.getSelectedShapeIds(),
      [editor]
    );

    // debounce hovered id so it doesn't flicker
    const [visibleId, setVisibleId] = useState(null);
    useEffect(() => {
      const t = setTimeout(() => setVisibleId(hoveredId), hoveredId ? 120 : 0);
      return () => clearTimeout(t);
    }, [hoveredId]);

    const isBusy =
      editor?.inputs?.isDragging ||
      editor?.inputs?.isPanning ||
      Boolean(editor?.getEditingShapeId?.());

    // 1) MULTI-SELECTION MODE
    if (!isBusy && selectedIds.length > 1) {
      const bounds =
        editor.getSelectionPageBounds?.() ??
        editor.getSelectedPageBounds?.() ??
        null;
      if (!bounds) return null;

      const pagePoint = {
        x: bounds.maxX + 12,
        y: bounds.minY,
      };
      const screenPoint = editor.pageToScreen?.(pagePoint) ?? pagePoint;

      const left = screenPoint.x;
      const top = screenPoint.y;

      return (
        <div
          style={{
            position: "fixed",
            left,
            top,
            pointerEvents: "none",
          }}
        >
          <button
            className="tlui-button tlui-button--icon"
            onClick={(e) => {
              e.stopPropagation();
              // null => use current selection
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
              <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} /> Ask AI
              ({selectedIds.length})
            </span>
          </button>
        </div>
      );
    }

    // 2) SINGLE-SHAPE HOVER MODE (your original behavior)
    if (!visibleId || isBusy) return null;

    const isSelected = selectedIds.includes(visibleId);
    if (isSelected) return null; // keep hiding on single selected shape

    const pageBounds =
      editor.getShapePageBounds?.(visibleId) ??
      editor.getPageBounds?.(visibleId) ??
      null;
    if (!pageBounds) return null;

    const rightCenterPage = {
      x: pageBounds.maxX - 20,
      y: pageBounds.minY,
    };

    const rightCenterScreen =
      editor.pageToScreen?.(rightCenterPage) ?? rightCenterPage;

    const left = rightCenterScreen.x + 12;
    const top = rightCenterScreen.y;

    return (
      <div
        style={{
          position: "fixed",
          left,
          top,
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
  };

  // const handlePhaseNudgeClick = useCallback(
  //   (shapeId) => {
  //     // Example: assume each nudge message looks like:
  //     // { role: "assistant", type: "nudge", meta: { tailShapeIds: [...] }, content: "..." }
  //     const related = messages.filter((m) => {
  //       const ids = m.meta?.tailShapeIds || m.meta?.nudgeForShapeIds || [];
  //       return Array.isArray(ids) && ids.includes(shapeId);
  //     });

  //     const last = related[related.length - 1] || null;

  //     setNudgeModal({
  //       open: true,
  //       shapeId,
  //       nudges: last ? [last] : [],
  //     });
  //   },
  //   [messages]
  // );

  const handlePhaseNudgeClick = useCallback((shapeId) => {
    setNudgeFocusShapeId(shapeId);
  }, []);

  function PhaseNudgeBadges({ shapeIds, onClickShape }) {
    const editor = useEditor();
    // const camera = useValue("camera", (e) => e.camera);
    const camera = useValue("camera", () => editor?.getCamera?.() ?? null, [
      editor,
    ]);
    const [badge, setBadge] = useState(null);
    const [highlight, setHighlight] = useState(false);

    // const [positions, setPositions] = useState([]);

    useEffect(() => {
      if (!editor || !Array.isArray(shapeIds) || shapeIds.length === 0) {
        // setPositions([]);
        setBadge(null);
        return;
      }

      // const next = [];
      const boundsList = [];

      shapeIds.forEach((id) => {
        const bounds =
          editor.getShapePageBounds?.(id) ?? editor.getPageBounds?.(id) ?? null;
        if (!bounds) return;
        boundsList.push({ id, bounds });
      });

      if (!boundsList.length) {
        setBadge(null);
        return;
      }

      let minX = Infinity,
        minY = Infinity,
        maxX = -Infinity,
        maxY = -Infinity;

      for (const { bounds } of boundsList) {
        if (bounds.minX < minX) minX = bounds.minX;
        if (bounds.minY < minY) minY = bounds.minY;
        if (bounds.maxX > maxX) maxX = bounds.maxX;
        if (bounds.maxY > maxY) maxY = bounds.maxY;
      }

      if (
        !isFinite(minX) ||
        !isFinite(minY) ||
        !isFinite(maxX) ||
        !isFinite(maxY)
      ) {
        setBadge(null);
        return;
      }

      const cornerPagePoint = {
        x: maxX + 24, // a bit to the right of the box
        y: minY, // top edge
      };

      let closestShapeId = boundsList[0].id;
      let bestDist2 = Infinity;

      for (const { id, bounds } of boundsList) {
        const cx = (bounds.minX + bounds.maxX) / 2;
        const cy = (bounds.minY + bounds.maxY) / 2;
        const dx = cx - cornerPagePoint.x;
        const dy = cy - cornerPagePoint.y;
        const d2 = dx * dx + dy * dy;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          closestShapeId = id;
        }
      }

      const screenPoint =
        editor.pageToScreen?.(cornerPagePoint) ?? cornerPagePoint;

      setBadge({
        shapeId: closestShapeId,
        left: screenPoint.x,
        top: screenPoint.y,
      });

      //   // Left-center of the shape in page coords
      //   const pagePoint = {
      //     x: bounds.minX - 24, // a bit to the left
      //     y: (bounds.minY + bounds.maxY) / 2,
      //   };

      //   const screenPoint = editor.pageToScreen?.(pagePoint) ?? pagePoint;

      //   next.push({
      //     shapeId: id,
      //     left: screenPoint.x,
      //     top: screenPoint.y,
      //   });
      // });

      // setPositions(next);
      setHighlight(true);
      const t = setTimeout(() => setHighlight(false), 4000); // 4s bounce then calm
      return () => clearTimeout(t);
    }, [editor, shapeIds, camera]);

    // if (!positions.length) return null;
    if (!badge) return null;

    return (
      <>
        {/* {positions.map((p) => ( */}
        <div
          // key={p.shapeId}
          style={{
            position: "fixed",
            left: badge.left,
            top: badge.top,
            pointerEvents: "none",
            zIndex: 10050,
          }}
        >
          <button
            className={
              "tlui-button tlui-button--icon phase-nudge-badge" +
              (highlight ? " phase-nudge-badge--bounce" : "")
            }
            style={{
              pointerEvents: "auto",
              width: 32,
              height: 32,
              borderRadius: "999px",
              background: "white",
              boxShadow: "0 4px 12px rgba(0,0,0,.2)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
            title="View AI nudge for this recent activity"
            onClick={(e) => {
              e.stopPropagation();
              onClickShape?.(badge.shapeId);
            }}
          >
            <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} />
          </button>
        </div>
      </>
    );
  }

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

  const tldrawComponents = useMemo(
    () => ({
      ContextMenu: (props) => {
        const editor = useEditor();
        const selection = useValue(
          "selection summary",
          // setSelectedTargets(selection.ids),
          () => makeSelectionSummary(editor),
          [editor]
        );
        useEffect(() => {
          setSelectedTargets(selection.ids);
        }, [selection.ids]);
        return (
          <CustomContextMenu
            {...props}
            selection={selection}
            shapeReactions={shapeReactions}
            setShapeReactions={setShapeReactions}
            selectedShape={selectedShape}
            setSelectedShape={setSelectedShape}
            commentCounts={commentCounts}
            setCommentCounts={setCommentCounts}
            comments={comments}
            setComments={setComments}
            actionHistory={actionHistory}
            setActionHistory={setActionHistory}
            onNudge={handleNudgeFromContextMenu}
            onTargetsChange={setSelectedTargets}
            isPanelCollapsed={isPanelCollapsed}
            togglePanel={togglePanel}
          />
        );
      },
      InFrontOfTheCanvas: (props) => (
        <>
          <SelectionLogger />
          <ContextToolbarComponent
            {...props}
            userRole={userRole}
            selectedShape={selectedShape}
            setShapeReactions={setShapeReactions}
            shapeReactions={shapeReactions}
            commentCounts={commentCounts}
            addComment={addComment}
            setActionHistory={setActionHistory}
            fetchActionHistory={fetchActionHistory}
          />
          <HoverActionBadge onIconClick={openChatForShape} />
          <PhaseNudgeBadges
            shapeIds={phaseTailShapeIds}
            // onClickShape={openChatForShape}
            onClickShape={handlePhaseNudgeClick}
          />
        </>
      ),

      Toolbar: (props) => {
        const editor = useEditor();
        const tools = useTools();
        const micTool = tools["microphone"];
        const isMicSelected = useIsToolSelected(tools["microphone"]);
        return (
          <DefaultToolbar {...props}>
            <button
              type="button"
              // onClick={() => micTool?.onSelect?.()}
              className="tlui-button tlui-button--icon"
              aria-pressed={isMicSelected}
              // title="Record"
              title={
                isRecording
                  ? `Stop recording • ${elapsed} / ${formatMs(
                      30000
                    )} (auto-stops at ${formatMs(30000)})`
                  : `Record (auto-stops at ${formatMs(30000)})`
              }
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
              // disabled={isRecording}
              onClick={async () => {
                if (!isRecording) {
                  startRecording();
                } else {
                  await stopRecording(editor);
                }
              }}
            >
              {isRecording ? (
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
                    {elapsed}/{formatMs(30000)}
                  </span>
                </>
              ) : (
                <>
                  <FontAwesomeIcon
                    icon={faMicrophone}
                    style={{ fontSize: 16 }}
                  />
                </>
              )}
            </button>
            <DefaultToolbarContent />
          </DefaultToolbar>
        );
      },
      ActionsMenu: (props) => <CustomActionsMenu {...props} />,
    }),
    [
      shapeReactions,
      selectedShape,
      commentCounts,
      comments,
      actionHistory,
      userRole,
      handleNudgeFromContextMenu,
      addComment,
      setActionHistory,
      fetchActionHistory,
      // toggleSidebar,
      isRecording,
      elapsed,
      isPanelCollapsed,
      // togglePanel,
      // phaseTailShapeIds,
      handlePhaseNudgeClick,
    ]
  );

  function SelectionLogger() {
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

      const bounds =
        editor.getSelectionPageBounds?.() ??
        editor.getSelectedPageBounds?.() ??
        null;

      if (selectedIds.length === 0) {
        console.log("[selection] cleared");
      } else {
        const rawShapes = selectedIds
          .map((id) => editor.getShape(id))
          .filter(Boolean);

        const summaries = rawShapes.map((shape) => {
          const label = (
            shape.props?.title ??
            shape.props?.name ??
            shape.props?.text ??
            ""
          )
            .toString()
            .slice(0, 60);

          const url =
            shape.type === "image" ? resolveImageUrl(editor, shape) : undefined;

          if (shape.type === "image" && !url) {
            console.debug("[selection][debug] image without URL", {
              id: shape.id,
              props: shape.props,
            });
          }

          if (shape.type === "image" && url && /^https?:\/\//i.test(url)) {
            const ctx = { className, projectName, teamName };

            // upsertImageUrl should return the final Firebase URL (you can have it
            // just return `url` if it already is the Firebase URL).
            upsertImageUrl(ctx, shape.id, url).then((firebaseUrl) => {
              if (!firebaseUrl) {
                console.log(
                  "[FIREBASEURL] firebase url from upsertImage: ",
                  firebaseUrl
                );
                return;
              }
              const current = editor.getShape(shape.id);
              if (!current) return;

              editor.updateShape({
                id: current.id,
                type: "image",
                props: {
                  ...current.props,
                  url: firebaseUrl, // ← your snippet
                },
              });
            });
          }

          return { id: shape.id, type: shape.type, label, url };
        });

        if (summaries.length === 1) {
          const s = summaries[0];
          console.log("[selection] single", {
            id: s.id,
            type: s.type,
            url: s.url,
            label: s.label,
            bounds,
          });
        } else {
          console.log("[selection] multi", {
            ids: summaries.map((s) => s.id),
            types: summaries.map((s) => s.type),
            bounds,
          });
        }
      }

      // --- NEW: if selection mode is active, send newly selected shapes as clips
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
              new CustomEvent("chatbot-add-clip", {
                detail: { clips },
              })
            );
          }
        }
      }

      prevIdsRef.current = selectedIds;
    }, [selectedIds, editor, selectionModeActive]);

    return null;
  }

  const toolsMemo = useMemo(() => [...defaultTools, ...CUSTOM_TOOLS], []);

  if (!roomId) return null;

  return (
    <div className="main-container" style={{ position: "fixed", inset: 0 }}>
      <Navbar />

      <Tldraw
        onMount={(editor) => {
          editorInstance.current = editor;
          setEditorReady(true);
          if (editorInstance) {
            saveCanvasPreview();
          }
        }}
        store={store}
        // schema={schema}
        tools={toolsMemo}
        shapeUtils={SHAPE_UTILS}
        overrides={uiOverrides}
        components={tldrawComponents}
      />

      {/* <button
        onClick={() => setShowViewer((v) => !v)}
        className="tlui-button tlui-button--icon"
        style={{
          position: "fixed",
          right: 16,
          bottom: showViewer ? 268 : 64,
          zIndex: 10060,
        }}
      >
        {showViewer ? "Hide Viewer" : "Show Viewer"}
      </button>

      {showViewer && (
        <ViewerPortal
          roomMeta={{ className, projectName, teamName }}
          roomId={roomId}
          store={store}
          shapeUtils={SHAPE_UTILS}
          bindingUtils={BINDING_UTILS}
          tools={toolsMemo}
          onClose={() => setShowViewer(false)}
        />
      )} */}

      {/* <button
        onClick={() => setShowMini((v) => !v)}
        className="tlui-button tlui-button--icon"
        style={{
          position: "fixed",
          right: 16,
          bottom: showMini ? 308 : 16, // pops just above the pad when open
          zIndex: 10000,
          background: "white",
          border: "1px solid rgba(0,0,0,.08)",
          borderRadius: 10,
          boxShadow: "0 6px 16px rgba(0,0,0,.15)",
          padding: "10px 12px",
        }}
        title={showMini ? "Hide scratchpad" : "Show scratchpad"}
      >
        {showMini ? "Hide Scratchpad" : "Scratchpad"}
      </button>

      {showMini && (
        <MiniWhiteboard
          shapeUtils={SHAPE_UTILS}
          bindingUtils={BINDING_UTILS}
          tools={toolsMemo}
          onClose={() => setShowMini(false)}
          initial={{ w: 420, h: 280, right: 16, bottom: 16 }}
        />
      )} */}

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
          onNudgeComputed={({ tailShapeIds }) => {
            console.log("[Parent] tailShapeIds from /analyze:", tailShapeIds);
            setPhaseTailShapeIds(tailShapeIds || []);
          }}
          nudgeFocusShapeId={nudgeFocusShapeId}
          onNudgeFocusComputed={() => setNudgeFocusShapeId(null)}
          variant="floating"
        />
      )}
      {/* <ChatSidebar
        messages={messages}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
      /> */}

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
        onNudgeComputed={({ tailShapeIds }) => {
          console.log(
            "[Parent] tailShapeIds from /analyze (sidebar):",
            tailShapeIds
          );
          setPhaseTailShapeIds(tailShapeIds || []);
        }}
        nudgeFocusShapeId={nudgeFocusShapeId}
        onNudgeFocusComputed={() => setNudgeFocusShapeId(null)}
      />
    </div>
  );
};

export default CollaborativeWhiteboard;
