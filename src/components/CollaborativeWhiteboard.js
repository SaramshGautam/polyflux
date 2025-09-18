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
import { faMicrophone } from "@fortawesome/free-solid-svg-icons";
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
  const [isRecording, setIsRecording] = useState(false);

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

  const recordOnce = useCallback((maxDurationMs = 10000) => {
    return new Promise(async (resolve, reject) => {
      let stream = null;
      let mediaRecorder = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            sampleRate: 44100,
          },
        });

        let mimeType = "audio/webm";
        if (!MediaRecorder.isTypeSupported("audio/webm")) {
          if (MediaRecorder.isTypeSupported("audio/mp4")) {
            mimeType = "audio/mp4";
          } else if (MediaRecorder.isTypeSupported("audio/ogg")) {
            mimeType = "audio/ogg";
          } else {
            mimeType = "";
          }
        }

        mediaRecorder = new MediaRecorder(stream, {
          mimeType: mimeType || undefined,
        });

        const audioChunks = [];

        mediaRecorder.addEventListener("dataavailable", (event) => {
          if (event.data.size > 0) {
            audioChunks.push(event.data);
          }
        });

        mediaRecorder.addEventListener("stop", () => {
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }

          const audioBlob = new Blob(audioChunks, {
            type: mimeType || "audio/webm",
          });

          console.log(
            "Recording stopped, blob created:",
            audioBlob.size,
            "bytes"
          );
          resolve(audioBlob);
        });

        mediaRecorder.addEventListener("error", (event) => {
          console.error("MediaRecorder error:", event.error);
          cleanup();
          reject(new Error(`Recording error: ${event.error.message}`));
        });

        mediaRecorder.start(1000);
        console.log("Recording started...");

        const timeoutId = setTimeout(() => {
          if (mediaRecorder && mediaRecorder.state === "recording") {
            console.log("Auto-stopping recording after", maxDurationMs, "ms");
            mediaRecorder.stop();
          }
        }, maxDurationMs);

        const cleanup = () => {
          clearTimeout(timeoutId);
          if (stream) {
            stream.getTracks().forEach((track) => track.stop());
          }
        };
      } catch (error) {
        console.error("Failed to start recording:", error);
        if (stream) {
          stream.getTracks().forEach((track) => track.stop());
        }
        reject(error);
      }
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
        console.warn("Using local blob URL as fallback");
        return URL.createObjectURL(blob);
      }
      throw error;
    }
  }, []);

  const uiOverrides = useMemo(
    () => ({
      tools(editor, tools) {
        tools.microphone = {
          id: "microphone",
          label: "Record",
          kbd: "r",
          readonlyOk: false,
          onSelect: async () => {
            try {
              console.log("Starting audio recording...");
              setIsRecording(true);

              const originalLabel = tools.microphone.label;
              tools.microphone.label = "Recording...";

              const blob = await recordOnce(5000);
              tools.microphone.label = originalLabel;

              console.log("Recording completed, blobr size:", blob.size);
              setIsRecording(false);
              const url = await uploadToFirebase(blob);
              console.log("Audio uploaded, URL:", url);

              const { x, y } = editor.getViewportScreenCenter();
              const timestamp = Date.now();
              editor.createShape({
                type: "audio",
                x,
                y,
                props: {
                  w: 420,
                  h: 39,
                  src: url,
                  // title: `Recording ${new Date(
                  //   timestamp
                  // ).toLocaleTimeString()}`,
                  title: "",
                  isPlaying: false,
                  currentTime: 0,
                  duration: 0,
                },
              });
            } catch (error) {
              setIsRecording(false);

              console.error("Mic record failed:", error);
              if (error.name === "NotAllowedError") {
                alert(
                  "Microphone access denied. Please allow microphone permissions and try again."
                );
              } else if (error.name === "NotFoundError") {
                alert(
                  "No microphone found. Please connect a microphone and try again."
                );
              } else {
                alert("Recording failed: " + error.message);
              }
            }
          },
        };
        return tools;
      },
    }),
    [recordOnce, uploadToFirebase]
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
        </>
      ),
      // InFrontOfTheCanvas: (props) => {
      //   const editor = useEditor();
      //   const selectedIds = useValue(
      //     "selected ids",
      //     () => editor.getSelectedShapeIds(),
      //     [editor]
      //   );

      //   useEffect(() => {
      //     // IDs of everything the user has selected (single or marquee)
      //     setSelectedTargets(selectedIds);
      //     // Convenience: keep a single selected shape (or null)
      //     const onlyOne =
      //       selectedIds.length === 1 ? editor.getShape(selectedIds[0]) : null;
      //     setSelectedShape(onlyOne);
      //   }, [selectedIds, editor]);

      //   return (
      //     <ContextToolbarComponent
      //       {...props}
      //       userRole={userRole}
      //       selectedShape={selectedShape}
      //       setShapeReactions={setShapeReactions}
      //       shapeReactions={shapeReactions}
      //       commentCounts={commentCounts}
      //       addComment={addComment}
      //       setActionHistory={setActionHistory}
      //       fetchActionHistory={fetchActionHistory}
      //     />
      //   );
      // },

      Toolbar: (props) => {
        const tools = useTools();
        const micTool = tools["microphone"];
        const isMicSelected = useIsToolSelected(tools["microphone"]);

        // console.log("[Toolbar] tools keys:", Object.keys(tools || {}));
        // console.log(
        //   "[Toolbar] microphone exists:",
        //   Boolean(tools["microphone"])
        // );
        return (
          <DefaultToolbar {...props}>
            <button
              type="button"
              onClick={() => micTool?.onSelect?.()}
              className="tlui-button tlui-button--icon"
              aria-pressed={isMicSelected}
              title="Record"
              style={{ display: "inline-flex", alignItems: "center", gap: 8 }}
            >
              <FontAwesomeIcon
                icon={faMicrophone}
                style={{ color: isRecording ? "red" : "black", fontSize: 16 }}
              />
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
