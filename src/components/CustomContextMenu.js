import React, { useState, useEffect, useContext, useRef } from "react";
import {
  DefaultContextMenu,
  TldrawUiMenuGroup,
  DefaultContextMenuContent,
  useEditor,
  TextShapeUtil,
} from "tldraw";
import "tldraw/tldraw.css";
import "../App.css";
import HistoryCommentPanel from "./HistoryCommentPanel";
import ToggleExpandButton from "./ToggleExpandButton";

import {
  registerShape,
  deleteShape,
  // updateShape,
  startEditSession,
  scheduleUpdateShape,
  endEditSession,
} from "../utils/registershapes";

import { useParams } from "react-router-dom";
import { app, db, auth } from "../firebaseConfig";
import { collection, getDocs } from "firebase/firestore";

export default function CustomContextMenu({
  selection,
  shapeReactions,
  setShapeReactions,
  selectedShape,
  setSelectedShape,
  commentCounts,
  setCommentCounts,
  comments,
  setComments,
  actionHistory,
  setActionHistory,
  isPanelCollapsed,
  togglePanel,
  onNudge,
  onTargetsChange,
  ...props
}) {
  const editor = useEditor();
  const currentUser = auth.currentUser;
  const userIdFromAuth =
    currentUser?.displayName ||
    currentUser?.email ||
    currentUser?.uid ||
    "anon";

  const [showCommentBox, setShowCommentBox] = useState(false);
  // const [comments, setComments] = useState({});
  // const [actionHistory, setActionHistory] = useState([]);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const { className, projectName, teamName } = useParams();
  const [showAIInput, setShowAIInput] = useState(false);
  const [aiQuery, setAIQuery] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);

  const [panelWidth, setPanelWidth] = useState(340); // default width
  const [isResizing, setIsResizing] = useState(false);

  const handleHistoryItemClick = (shapeId) => {
    if (!editor || !shapeId) return;

    const shape = editor.getShape(shapeId);
    if (!shape) {
      console.warn("[History] Shape not found for id:", shapeId);
      return;
    }

    // Select the shape → tldraw will highlight it
    editor.select(shapeId);

    // (optional) you could also scroll/zoom to it later if you want:
    const bounds = editor.getShapePageBounds(shapeId);
    // if (bounds) editor.zoomToBounds(bounds);
    if (bounds) {
      const center = {
        x: (bounds.minX + bounds.maxX) / 2,
        y: (bounds.minY + bounds.maxY) / 2,
      };

      // keep current zoom, just move camera to the shape
      editor.centerOnPoint(center);
    }
  };

  const getSelectedIds = () => Array.from(editor.getSelectedShapeIds?.() ?? []);

  const getSelectedShapeSafe = (id) => {
    try {
      return id ? editor.getShape(id) : null;
    } catch {
      return null;
    }
  };

  const activeSessionsRef = useRef(new Map()); // shapeId -> { idleTimer }
  const newlyCreatedRef = useRef(new Set());

  function ensureSession(shape, userContext) {
    const key = shape.id;
    const activeSessions = activeSessionsRef.current;
    if (!activeSessions.has(key)) {
      startEditSession({ shape, userContext });
      activeSessions.set(key, { idleTimer: null });
    }
  }

  async function endSessionIfAny(shape, userContext, userId) {
    const key = shape?.id;
    const activeSessions = activeSessionsRef.current;
    const ses = activeSessions.get(key);
    if (!ses) return;

    clearTimeout(ses.idleTimer);
    activeSessions.delete(key);

    const didCommit = await endEditSession({ shape, userContext, userId });

    const newlyCreated = newlyCreatedRef.current;
    if (newlyCreated.has(key)) {
      newlyCreated.delete(key);
      return;
    }

    if (!didCommit) return;

    // endEditSession({ shape, userContext, userId });

    // const newlyCreated = newlyCreatedRef.current;
    // if (newlyCreated.has(key)) {
    //   newlyCreated.delete(key); // clear the flag so future edits *do* log
    //   return;
    // }

    const entry = makeHistoryEntry({ userId, verb: "updated", shape, editor });
    setActionHistory((prev) => [entry, ...prev]);
  }

  // idle-end fallback (e.g., user stops typing/moving)
  function bumpIdleTimer(shape, userContext, userId, ms = 1200) {
    const key = shape.id;
    const activeSessions = activeSessionsRef.current;
    const ses = activeSessions.get(key);
    if (!ses) return;
    clearTimeout(ses.idleTimer);
    ses.idleTimer = setTimeout(() => {
      endSessionIfAny(shape, userContext, userId);
    }, ms);
    activeSessions.set(key, ses);
  }

  // helpers (put near the top of CustomContextMenu)
  function extractShapeText(shape) {
    // prefer single-line richText, else fallback to props.text
    return (
      shape?.props?.richText?.content?.[0]?.content?.[0]?.text ??
      shape?.props?.text ??
      ""
    );
  }

  function extractImageUrl(editor, shape) {
    const assetId = shape?.props?.assetId;
    if (!assetId) return "";
    const asset = editor.getAsset(assetId);
    // tldraw assets typically keep src under props.src
    return asset?.props?.src || "";
  }

  function makeHistoryEntry({
    userId,
    verb, // 'added' | 'updated' | 'deleted'
    shape,
    editor,
  }) {
    const shapeType = shape?.type ?? "shape";
    const text =
      shapeType === "note" || shapeType === "text"
        ? extractShapeText(shape)
        : "";
    const imageUrl =
      shapeType === "image" ? extractImageUrl(editor, shape) : "";
    return {
      userId: userIdFromAuth || "anon",
      verb, // normalized (no 'a' duplication)
      shapeType, // 'note' | 'text' | 'image' | ...
      shapeId: shape?.id,
      text, // text preview ('' if not applicable)
      imageUrl, // thumbnail url ('' if not applicable)
      timestamp: new Date().toISOString(),
    };
  }

  useEffect(() => {
    if (!editor) return;

    const updateSelection = () => {
      const ids = getSelectedIds();
      onTargetsChange?.(ids); // ✅ bubble up target IDs
      // const first = getSelectedShapeSafe(ids[0]);
      // setSelectedShape(first || null);
      setSelectedShape(ids.length === 1 ? editor.getShape(ids[0]) : null);
    };

    // initial
    updateSelection();

    // subscribe to store changes affecting selection
    const unlisten = editor.store.listen(
      ({ changes }) => {
        if (changes?.selectedIds) updateSelection();
      },
      { scope: "user" }
    );

    return () => {
      unlisten?.();
    };
  }, [editor, onTargetsChange, setSelectedShape]);

  useEffect(() => {
    if (!editor || !className || !projectName || !teamName) return;

    //Logs the shape starting position
    let startPosition = {};

    const handleShapeMoveStart = () => {
      const shape = editor.getActiveShape();
      if (shape) {
        startPosition = shape.getCenter();
      }
      // console.log(`Shape Position: ${startPosition}`);
    };

    const logShapeAddition = async (newShape) => {
      if (!newShape) {
        console.error("Shape data is missing!");
        return;
      }

      if (!className || !projectName || !teamName) {
        console.error(
          "Missing parameters: className, projectName, or teamName"
        );
        return;
      }

      const userContext = {
        className,
        projectName,
        teamName,
        userId: userIdFromAuth,
      };

      newlyCreatedRef.current.add(newShape.id);

      // await registerShape(newShape, userContext);
      const finalImageUrl = await registerShape(newShape, userContext, editor);

      if (newShape.type === "image" && finalImageUrl) {
        const live = editor.getShape(newShape.id);
        if (live) {
          console.log(
            "[logShapeAddition] Patching image shape with imageUrl:",
            finalImageUrl
          );
          editor.updateShape({
            id: live.id,
            type: live.type,
            props: {
              ...live.props,
              url: finalImageUrl, // 👈 this is what resolveImageUrl / Ask AI will see
            },
          });
        }
      } else {
        console.warn(
          "[logShapeAddition] Uploaded image URL but live shape not found:",
          newShape.id
        );
      }

      const entry = makeHistoryEntry({
        userIdFromAuth,
        verb: "added",
        shape: newShape,
        editor,
      });
      setActionHistory((prev) => [entry, ...prev]);
    };

    const handleShapeDeletion = async (deletedShapeID) => {
      if (!deletedShapeID) {
        console.error("Missing shape ID!");
        return;
      }

      if (!className || !projectName || !teamName) {
        console.error(
          "Missing parameters: className, projectName, or teamName"
        );
        return;
      }

      const userContext = {
        className,
        projectName,
        teamName,
        userId: userIdFromAuth,
      };

      await deleteShape(deletedShapeID.id, userContext);

      const deleted = { id: deletedShapeID.id, type: "shape" };

      const entry = makeHistoryEntry({
        userId: userIdFromAuth,
        verb: "deleted",
        shape: deleted,
        editor,
      });
      setActionHistory((prev) => [entry, ...prev]);
    };

    const shapeCreateHandler = editor.sideEffects.registerAfterCreateHandler(
      "shape",
      logShapeAddition
    );
    const shapeDeleteHandler = editor.sideEffects.registerAfterDeleteHandler(
      "shape",
      handleShapeDeletion
    );

    const shapeUpdateHandler = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      async (updatedShape) => {
        if (!updatedShape) return;

        // Re-read live shape (good!)
        const liveShape = editor.getShape(updatedShape.id);
        if (!liveShape) return;

        // Extract single-line text from richText if present
        const extractedText =
          liveShape?.props?.richText?.content?.[0]?.content?.[0]?.text;

        const normalized = {
          ...liveShape,
          props: {
            ...liveShape.props,
            text: extractedText ?? liveShape.props.text ?? "",
          },
        };

        // Guard
        if (!className || !projectName || !teamName) return;
        const userContext = {
          className,
          projectName,
          teamName,
          userId: userIdFromAuth,
        };

        // --- session-based update ---
        ensureSession(normalized, userContext);
        await scheduleUpdateShape(normalized, userContext); // debounced write
        bumpIdleTimer(normalized, userContext, userIdFromAuth, 1200);
      }
    );

    return () => {
      shapeCreateHandler();
      shapeDeleteHandler();
      shapeUpdateHandler();
    };
  }, [editor, className, projectName, teamName]);

  useEffect(() => {
    if (!editor) return;

    // Track previous selection to detect leave
    let prevIds = new Set(editor.getSelectedShapeIds?.() ?? []);

    const un = editor.store.listen(
      ({ changes }) => {
        if (!changes?.selectedIds) return;
        const curr = new Set(editor.getSelectedShapeIds?.() ?? []);
        // if a previously selected id is no longer selected, end its session
        for (const leftId of prevIds) {
          if (!curr.has(leftId)) {
            const leftShape = getSelectedShapeSafe(leftId);
            if (leftShape) {
              // const userId = auth.currentUser
              //   ? auth.currentUser.displayName
              //   : "anon";
              const userContext = {
                className,
                projectName,
                teamName,
                userId: userIdFromAuth,
              };
              // end if any
              endSessionIfAny(leftShape, userContext, userIdFromAuth);
            }
          }
        }
        prevIds = curr;
      },
      { scope: "user" }
    );

    return () => un?.();
  }, [editor, className, projectName, teamName]);

  useEffect(() => {
    if (!editor) return;

    let lastEditingId = editor.getEditingShapeId?.() || null;
    const un = editor.store.listen(
      () => {
        const now = editor.getEditingShapeId?.() || null;
        if (lastEditingId && !now) {
          // just exited editing
          const shape =
            getSelectedShapeSafe(lastEditingId) ||
            editor.getShape(lastEditingId);
          if (shape) {
            const userId = auth.currentUser
              ? auth.currentUser.displayName
              : "anon";
            const userContext = {
              className,
              projectName,
              teamName,
              userId: userIdFromAuth,
            };
            endSessionIfAny(shape, userContext, userIdFromAuth);
          }
        }
        lastEditingId = now;
      },
      { scope: "user" }
    );

    return () => un?.();
  }, [editor, className, projectName, teamName]);

  useEffect(() => {
    const handleClustering = async (event) => {
      const sourceShapeId = event.detail?.source;
      const allShapes = editor.getCurrentPageShapes();

      const shapeData = allShapes
        .filter((shape) => shape.props?.text || shape.props?.richText)
        .map((shape) => {
          let text = shape.props?.text || "";
          if (
            !text &&
            shape?.props?.richText?.content?.[0]?.content?.[0]?.text
          ) {
            text = shape.props.richText.content[0].content[0].text;
          }
          return {
            id: shape.id,
            type: shape.type,
            text,
          };
        });

      try {
        const response = await fetch(
          "http://127.0.0.1:5000/api/cluster_suggestion",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ shapes: shapeData, source: sourceShapeId }),
          }
        );

        const result = await response.json();
        console.log("📦 Cluster Results:", result);

        // Optional: attach to shapes or show on canvas
        result.clusters.forEach((cluster, index) => {
          console.log(`🧠 Cluster ${index + 1}:`, cluster);
          // You can optionally highlight, group, or tag these on canvas
        });
      } catch (err) {
        console.error("❌ Clustering failed:", err);
      }
    };

    window.addEventListener("trigger-clustering", handleClustering);
    return () =>
      window.removeEventListener("trigger-clustering", handleClustering);
  }, [editor]);

  useEffect(() => {
    const updateSelectedShape = (shape) => {
      if (!shape) {
        // console.log("No shape selected.");
        setSelectedShape(null);
      } else {
        if (shape) {
          // console.log("Selected shape:", shape);
          setSelectedShape(shape);
        }
      }
    };

    // Also update when selection changes
    const unsubscribe = editor.store.listen(({ changes }) => {
      if (changes.selectedIds) {
        updateSelectedShape(selectedShape);
      }
    });

    const handleClickOutside = (event) => {
      if (
        !editor.getShapeAtPoint(
          editor.screenToPage({ x: event.clientX, y: event.clientY })
        )
      ) {
        // console.log("User clicked outside. Deselecting shape.");
        // setSelectedShape(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      // editor.off("pointerdown", pointerDownHandler);
      unsubscribe();
    };
  }, [editor, setSelectedShape]);

  const handleContextMenu = (event) => {
    event.preventDefault();
    // const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    // const hit = editor.getShapeAtPoint(point);
    // // const shape = editor.getShapeAtPoint(point);

    // const selectedIds = new Set(editor.getSelectedShapeIds?.() ?? []);

    // if (hit && selectedIds.size === 0) {
    //   editor.select(hit.id);
    // }

    const point = editor.screenToPage({ x: event.clientX, y: event.clientY });
    const hit = editor.getShapeAtPoint(point);
    const current = new Set(editor.getSelectedShapeIds?.() ?? []);

    if (!hit) return;

    // Allow additive/toggle selection on right-click with modifiers
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      if (current.has(hit.id)) current.delete(hit.id);
      else current.add(hit.id);
      editor.select([...current]);
      return;
    }

    // If nothing selected, right-click selects the hit shape
    if (current.size === 0) {
      editor.select(hit.id);
    }

    // if (shape) {
    //   editor.select(shape.id);
    //   setSelectedShape(shape);
    //   onTargetsChange?.([shape.id]);

    //   // console.log("Shape ID:", shape.id);
    // }
  };

  // --- CLUSTERING POSITION HELPERS ---
  // Move shapes to clusters in grid layout
  const moveShapesToClusters = (clusterResults) => {
    if (!clusterResults?.clusters) return;

    const clusters = clusterResults.clusters;
    const clusterKeys = Object.keys(clusters);
    const CLUSTER_SPACING = 300;
    const SHAPE_SPACING = 120;
    const START_X = 100;
    const START_Y = 100;

    clusterKeys.forEach((clusterKey, clusterIndex) => {
      const shapes = clusters[clusterKey];
      if (!shapes || shapes.length === 0) return;

      const clusterX = START_X + clusterIndex * CLUSTER_SPACING;
      const clusterY = START_Y;

      shapes.forEach((shapeData, shapeIndex) => {
        const { shapeId } = shapeData;
        const shape = editor.getShape(shapeId);
        if (!shape) return;

        const newX = clusterX;
        const newY = clusterY + shapeIndex * SHAPE_SPACING;

        editor.updateShape({
          id: shapeId,
          type: shape.type,
          x: newX,
          y: newY,
        });
      });

      console.log(
        `📍 Positioned cluster ${clusterKey} at (${clusterX}, ${clusterY})`
      );
    });
  };

  // Move shapes to clusters in circular layout
  const moveShapesToClustersCircular = (clusterResults) => {
    if (!clusterResults?.clusters) return;

    const clusters = clusterResults.clusters;
    const clusterKeys = Object.keys(clusters);
    const CLUSTER_RADIUS = 200;
    const CLUSTER_DISTANCE = 400;

    clusterKeys.forEach((clusterKey, clusterIndex) => {
      const shapes = clusters[clusterKey];
      if (!shapes || shapes.length === 0) return;

      const clusterCenterX = 300 + clusterIndex * CLUSTER_DISTANCE;
      const clusterCenterY = 300;

      shapes.forEach((shapeData, shapeIndex) => {
        const { shapeId } = shapeData;
        const shape = editor.getShape(shapeId);
        if (!shape) return;

        const angle = (2 * Math.PI * shapeIndex) / shapes.length;
        const radius = shapes.length > 1 ? CLUSTER_RADIUS : 0;

        const newX = clusterCenterX + Math.cos(angle) * radius;
        const newY = clusterCenterY + Math.sin(angle) * radius;

        editor.updateShape({
          id: shapeId,
          type: shape.type,
          x: newX,
          y: newY,
        });
      });

      console.log(
        `🔵 Positioned cluster ${clusterKey} around (${clusterCenterX}, ${clusterCenterY})`
      );
    });
  };

  const handleSuggestClustersClick = async () => {
    try {
      const shapesRef = collection(
        db,
        // `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/`
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "shapes"
      );

      console.log("📂 Collection reference created:", shapesRef);
      const snapshot = await getDocs(shapesRef);
      console.log("📄 Documents fetched. Count:", snapshot.size);

      const shapeDocs = snapshot.docs.map((doc) => {
        const data = doc.data();
        console.log(`📌 Fetched shape: ${data.shapeId}`, data);
        return {
          ...data,
          shapeId: doc.id,
        };
      });

      const requestPayload = {
        shapes: shapeDocs
          .filter((shape) => shape.shapeType === "note")
          .map((shape) => ({
            id: shape.shapeId,
            content:
              shape?.text ||
              shape?.props?.text ||
              shape?.props?.richText?.content?.[0]?.content?.[0]?.text ||
              "",
          })),
      };

      console.log("Payload for cluster suggestion:", requestPayload);

      const response = await fetch(
        "http://127.0.0.1:5000/api/cluster_suggestion",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ shapes: requestPayload.shapes }),
        }
      );

      const result = await response.json();
      console.log("Clusters:", result);

      moveShapesToClusters(result);

      window.dispatchEvent(
        new CustomEvent("trigger-chatbot", {
          detail: {
            snippet: JSON.stringify(result, null, 2),
            source: "clusterAI",
            position: { x: 300, y: 200 },
          },
        })
      );
    } catch (err) {
      console.error("Error suggesting clusters:", err);
    }
  };

  // const handleTriggerAgentsClick = async () => {
  //   try {
  //     const canvasId = `${className}_${projectName}_${teamName}`;
  //     console.log("Triggering agents for Canvas ID:", canvasId);

  //     const res = await fetch("http://localhost:8080/process", {
  //       method: "POST",
  //       headers: {
  //         "Content-Type": "application/json",
  //       },
  //       body: JSON.stringify({ canvas_id: canvasId }),
  //     });

  //     const result = await res.json();
  //     console.log("Agents triggered successfully:", result);
  //   } catch (error) {
  //     console.error("Error triggering agents:", error);
  //   }
  // };

  const handleTriggerAgentsClick = async () => {
    try {
      setAgentsLoading(true);
      const canvasId = `${className}_${projectName}_${teamName}`;
      console.log("Triggering agents for Canvas ID:", canvasId);

      const res = await fetch(
        "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/process",
        {
          // const res = await fetch("http://localhost:8080/process", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ canvas_id: canvasId }),
        }
      );

      const result = await res.json();
      if (!res.ok || result.error) {
        console.error("Nudge analyze error:", result.error || res.statusText);
        // Optionally show a soft error badge instead of crashing UI
        return;
      }

      console.log("Agents triggered successfully:", result);

      if (result?.nudges && result.nudges.length > 0) {
        const topNudge = result.nudges[0];

        // if (onNudge) {
        //   onNudge({ sender: "bot", topNudge });
        // }

        if (onNudge) {
          onNudge({
            sender: "bot",
            text: topNudge.message,
            image_urls: topNudge.image_urls || null,
            type: topNudge.type,
            chips: topNudge.chips || [],
            targets: topNudge.targets || [],
          });
        }

        // window.dispatchEvent(
        //   new CustomEvent("trigger-chatbot", {
        //     detail: {
        //       snippet: topNudge.message,
        //       source: `agent-${topNudge.type}`,
        //       position,
        //     },
        //   })
        // );
      } else {
        console.log("No nudges returned from agents.");
      }
    } catch (error) {
      console.error("Error triggering agents:", error);
      window.dispatchEvent(
        new CustomEvent("trigger-chatbot", {
          detail: {
            snippet: "⚠️ Agent trigger failed. Check logs.",
            source: "agent-error",
          },
        })
      );
    } finally {
      setAgentsLoading(false);
    }
  };

  function screenPointForSelection(editor, bounds) {
    const pagePoint = bounds
      ? { x: bounds.maxX + 10, y: bounds.maxY - 30 }
      : editor.getViewportPageCenter?.() ?? { x: 0, y: 0 };
    const sp = editor.pageToScreen(pagePoint);
    return {
      x: Math.min(sp.x, window.innerWidth - 400),
      y: Math.min(sp.y, window.innerHeight - 500),
    };
  }

  function buildAiPayload(selection, editor) {
    const { summaries = [], primary, bounds } = selection || {};
    const position = screenPointForSelection(editor, bounds);

    if (primary) {
      const snippet =
        primary.type === "image"
          ? primary.url || "image"
          : primary.text || primary.label || "";

      const image_urls =
        primary.type === "image" && primary.url ? [primary.url] : [];

      return {
        snippet,
        source: primary.id,
        position,
        image_urls,
        meta: { type: primary.type, selection: summaries },
      };
    }

    // multi-select
    const items = summaries.map((s, i) => ({
      id: s.id,
      type: s.type,
      text: (s.text || s.label || "").slice(0, 200),
      url: s.type === "image" ? s.url : undefined,
      idx: i + 1,
    }));

    const textualSummary = items
      .map(
        (it) =>
          `${it.idx}. ${it.type}` +
          (it.text ? `: ${it.text}` : "") +
          (it.url ? ` [${String(it.url).slice(0, 60)}...]` : "")
      )
      .join("\n");

    const image_urls = items.map((it) => it.url).filter(Boolean);

    return {
      snippet: `Selected ${items.length} items:\n${textualSummary}`,
      source: items.map((it) => it.id),
      position,
      image_urls,
      meta: { selection: items },
    };
  }

  return (
    <div onContextMenu={handleContextMenu}>
      <DefaultContextMenu {...props}>
        <DefaultContextMenuContent />
      </DefaultContextMenu>

      <div className="panelContainerWrapper">
        {!isPanelCollapsed && (
          <HistoryCommentPanel
            actionHistory={actionHistory}
            comments={comments}
            selectedShape={selectedShape}
            isPanelCollapsed={isPanelCollapsed}
            togglePanel={togglePanel}
            onHistoryItemClick={handleHistoryItemClick}
          />
        )}
        {isPanelCollapsed && (
          <ToggleExpandButton
            isPanelCollapsed={isPanelCollapsed}
            togglePanel={togglePanel}
          />
        )}
      </div>
    </div>
  );
}
