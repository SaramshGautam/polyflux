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
} from "firebase/firestore";

import { getAuth, GoogleAuthProvider, signInWithPopup } from "firebase/auth";
import { app, db, auth, googleProvider, storage } from "../firebaseConfig";
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
import { recordOnce, createToggleRecorder } from "../utils/audioRecorder";

const CUSTOM_TOOLS = [MicrophoneTool];
const SHAPE_UTILS = [...defaultShapeUtils, AudioShapeUtil];
const BINDING_UTILS = [...defaultBindingUtils];

const CollaborativeWhiteboard = () => {
  const { className, projectName, teamName } = useParams();
  const [externalMessages, setExternalMessages] = useState([]);
  const [shapeReactions, setShapeReactions] = useState({});
  const [selectedShape, setSelectedShape] = useState(null);
  const [selectedTargets, setSelectedTargets] = useState([]);

  const [commentCounts, setCommentCounts] = useState({});
  const [comments, setComments] = useState({});
  const [actionHistory, setActionHistory] = useState([]);
  const [userRole, setUserRole] = useState(null);
  const editorInstance = useRef(null);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [messages, setMessages] = useState([]);

  const recorderRef = useRef(null);
  const mediaRecorderRef = useRef(null);
  const mediaSteamRef = useRef(null);
  const autoStopTimeoutRef = useRef(null);
  const audioChunksRef = useRef([]);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingStartAt, setRecordingStartAt] = useState(null);
  const [elapsed, setElapsed] = useState("0:00");

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

  const toggleSidebar = useCallback(() => {
    setIsSidebarOpen((prev) => !prev);
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

  useEffect(() => {
    if (editorInstance) {
      saveCanvasPreview();
    }
    return () => {
      saveCanvasPreview();
    };
  }, [store]);

  useEffect(() => {
    if (!roomId || !className || !projectName || !teamName) return;

    const userContext = { className, projectName, teamName };
    fetchActionHistory(userContext, setActionHistory);
  }, [className, projectName, teamName]);

  const fetchActionHistory = async (userContext, setActionHistory) => {
    if (!userContext) return;

    const { className, projectName, teamName } = userContext;
    // const historyRef = collection(
    //   db,
    //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/history`
    // );
    console.log(
      `---- User Context --- ${className} and ${projectName} and  ${teamName}`
    );

    const historyRef = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "history"
    );

    try {
      const q = query(historyRef, orderBy("timestamp", "desc"));
      const querySnapshot = await getDocs(q);
      const historyLogs = querySnapshot.docs.map((doc) => doc.data());
      console.log("History Logs ---- \n", historyLogs);

      setActionHistory(historyLogs);
    } catch (error) {
      console.error("❌ Error fetching history:", error);
    }
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

  const components = {
    Navbar: Navbar,
    ContextMenu: CustomContextMenu,
    InFrontOfTheCanvas: ContextToolbarComponent,
    Toolbar: DefaultToolbar,
    // Toolbar: CustomToolbar,
    ActionsMenu: CustomActionsMenu,
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

  const saveCanvasPreview = useCallback(async () => {
    if (!editorInstance.current) return;

    const shapeIds = editorInstance.current.getCurrentPageShapeIds();
    if (shapeIds.size === 0) return;

    try {
      const { blob } = await editorInstance.current.toImage([...shapeIds], {
        format: "png",
        // bounds,
        // background: false,
        padding: 20,
        // background: false,
      });

      // Create a download link for the blob
      const url = URL.createObjectURL(blob);
      localStorage.setItem(
        `preview-${className}-${projectName}-${teamName}`,
        url
      );
    } catch (error) {
      console.error("Error uploading preview:", error);
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

  const uiOverrides = useMemo(
    () => ({
      tools(editor, tools) {
        tools.microphone = {
          id: "microphone",
          label: "Record",
          kbd: "r",
          readonlyOk: false,

          onSelect: async () => {
            if (!isRecording) {
              startRecording();
            } else {
              await stopRecording(editor);
            }
          },
        };
        return tools;
      },
    }),
    // [recordOnce, uploadToFirebase]
    [isRecording, startRecording, stopRecording]
  );

  const openChatForShape = useCallback((shapeId) => {
    console.log("[Chat] openChatForShape ->", shapeId);
    setSelectedTargets([shapeId]);
    setSelectedShape(editorInstance.current?.getShape?.(shapeId) ?? null);
    // setIsSidebarOpen(true); // force open (no toggle)
    // Optional: nudge ChatBot via externalMessages if it listens to these
    setExternalMessages(() => [{ type: "Ask AI", targets: [shapeId] }]);
  }, []);

  const HoverActionBadge = ({ onIconClick }) => {
    const editor = useEditor();

    // current hovered shape
    const hoveredId = useValue(
      "hovered shape id",
      () => editor.getHoveredShapeId?.() ?? null,
      [editor]
    );

    // debounce so it doesn't flicker when you sweep across shapes
    const [visibleId, setVisibleId] = useState(null);
    useEffect(() => {
      const t = setTimeout(() => setVisibleId(hoveredId), hoveredId ? 120 : 0);
      return () => clearTimeout(t);
    }, [hoveredId]);

    //hide during panning, dragging, editing
    const isBusy =
      editor?.inputs?.isDragging ||
      editor?.inputs?.isPanning ||
      Boolean(editor?.getEditingShapeId?.());

    if (!visibleId || isBusy) return null;

    const isSelected = editor.getSelectedShapeIds().includes(visibleId);
    if (isSelected) return null;

    const pageBounds =
      editor.getShapePageBounds?.(visibleId) ??
      editor.getPageBounds?.(visibleId) ??
      null;
    if (!pageBounds) return null;

    const rightCenterPage = {
      x: pageBounds.maxX - 20,
      // x: (pageBounds.minX + pageBounds.maxX) / 3,
      // y: (pageBounds.minY + pageBounds.maxY) / 2,
      y: pageBounds.minY,
    };

    const rightCenterScreen =
      editor.pageToScreen?.(rightCenterPage) ?? rightCenterPage;
    const zoom = editor.getZoomLevel?.() ?? 1;

    const left = rightCenterScreen.x + 12;
    const top = rightCenterScreen.y;

    return (
      <div
        style={{
          position: "fixed",
          left,
          top,
          // transform: `translate(-50%, -50%) scale(${zoom})`,
          pointerEvents: "none",
          // zIndex: 1,
        }}
      >
        <button
          className="tlui-button tlui-button--icon"
          onClick={(e) => {
            e.stopPropagation();
            // focus the shape, then trigger your UX
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
          title="Quick actions"
        >
          <span>
            <FontAwesomeIcon icon={faRobot} style={{ fontSize: 14 }} /> Ask AI
          </span>
        </button>
      </div>
    );
  };

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
              {/* <FontAwesomeIcon
                icon={faMicrophone}
                style={{ color: isRecording ? "red" : "black", fontSize: 16 }}
              /> */}
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
      toggleSidebar,
      isRecording,
      elapsed,
    ]
  );

  function SelectionLogger() {
    const editor = useEditor();

    const selectedIds = useValue(
      "selected ids",
      () => editor.getSelectedShapeIds(),
      [editor]
    );

    // Robust URL resolver for image shapes
    function resolveImageUrl(editor, shape) {
      if (!shape) return null;
      const p = shape.props || {};

      if (p.src) return p.src;
      if (p.url) return p.url;
      if (p.imageUrl) return p.imageUrl;

      const assetId = p.assetId;
      if (assetId) {
        const assetViaEditor = editor.getAsset?.(assetId);
        const fromEditor =
          assetViaEditor?.props?.src ?? assetViaEditor?.src ?? null;
        if (fromEditor) return fromEditor;

        const storeAsset =
          editor.store?.get?.asset?.(assetId) ??
          editor.store?.get?.({ id: assetId, typeName: "asset" }); // extra-safe
        const fromStore = storeAsset?.props?.src ?? storeAsset?.src ?? null;
        if (fromStore) return fromStore;
      }

      return null;
    }

    useEffect(() => {
      const bounds =
        editor.getSelectionPageBounds?.() ??
        editor.getSelectedPageBounds?.() ??
        null;

      if (selectedIds.length === 0) {
        console.log("[selection] cleared");
        return;
      }

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

        // Debug once if an image has no url (helps you see what's missing)
        if (shape.type === "image" && !url) {
          console.debug("[selection][debug] image without URL", {
            id: shape.id,
            props: shape.props,
            assetId: shape.props?.assetId,
            asset: shape.props?.assetId
              ? editor.getAsset?.(shape.props.assetId)
              : null,
          });
        }

        // If we have a *real* (http/https) URL, persist it
        // if (shape.type === "image" && isWebUrl(url)) {
        //   void persistToFirestore(shape.id, url);
        // }

        if (shape.type === "image" && url) {
          const ctx = { className, projectName, teamName };
          void upsertImageUrl(ctx, shape.id, url);
        }

        return { id: shape.id, type: shape.type, label, url };
      });

      if (summaries.length === 1) {
        const s = summaries[0];
        console.log("[selection] single", {
          id: s.id,
          type: s.type,
          url: s.url,
          label: s.label, // <-- use the computed label, not s.props
          bounds,
        });
      } else {
        console.log("[selection] multi", {
          ids: summaries.map((s) => s.id),
          types: summaries.map((s) => s.type),
          urls: summaries.map((s) => (s.type === "image" ? s.url : undefined)),
          count: summaries.length,
          bounds,
        });
      }
    }, [selectedIds, editor]);

    return null;
  }

  function resolveImageUrl(editor, shape) {
    if (!shape) return null;
    const p = shape.props || {};
    if (p.src) return p.src;
    if (p.url) return p.url;
    if (p.imageUrl) return p.imageUrl;
    if (p.assetId) {
      const a = editor.getAsset?.(p.assetId);
      return a?.props?.src ?? a?.src ?? null;
    }
    return null;
  }

  function extractShapeText(shape) {
    if (!shape) return "";
    if (shape.props?.text) return String(shape.props.text);
    const rt = shape.props?.richText?.content;
    if (Array.isArray(rt) && rt[0]?.content?.[0]?.text) {
      return String(rt[0].content[0].text);
    }
    return "";
  }

  function makeSelectionSummary(editor) {
    const ids = editor.getSelectedShapeIds();
    const shapes = ids.map((id) => editor.getShape(id)).filter(Boolean);
    const summaries = shapes.map((s) => ({
      id: s.id,
      type: s.type,
      url: s.type === "image" ? resolveImageUrl(editor, s) : undefined, // data: or https ok
      text: extractShapeText(s),
      label: (
        s.props?.title ??
        s.props?.name ??
        s.props?.text ??
        s.props?.richText?.content?.[0]?.content?.[0]?.text ??
        ""
      )
        .toString()
        .slice(0, 60),
    }));

    const bounds =
      editor.getSelectionPageBounds?.() ??
      editor.getSelectedPageBounds?.() ??
      null;

    return {
      ids,
      summaries,
      primary: summaries.length === 1 ? summaries[0] : null,
      bounds,
    };
  }

  const toolsMemo = useMemo(() => [...defaultTools, ...CUSTOM_TOOLS], []);

  if (!roomId) return null;

  return (
    <div className="main-container" style={{ position: "fixed", inset: 0 }}>
      <Navbar />

      <Tldraw
        onMount={(editor) => {
          editorInstance.current = editor;
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
      <ChatBot
        toggleSidebar={toggleSidebar}
        messages={messages}
        setMessages={setMessages}
        externalMessages={externalMessages}
        user_id={
          auth.currentUser?.displayName || auth.currentUser?.email || "anon"
        }
        // canvasId={roomId}
        canvasId={`${className}_${projectName}_${teamName}`}
        role={"catalyst"}
        targets={selectedTargets}
        params={{}}
      />
      <ChatSidebar
        messages={messages}
        isOpen={isSidebarOpen}
        toggleSidebar={toggleSidebar}
      />
    </div>
  );
};

export default CollaborativeWhiteboard;
