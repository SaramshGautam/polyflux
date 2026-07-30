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
import { logAction } from "../utils/actionLog";

import {
  registerShape,
  deleteShape,
  startEditSession,
  scheduleUpdateShape,
  endEditSession,
  ensureImageInStorageAndGetUrl,
  resolveMyActorId,
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
  onNudge,
  onTargetsChange,
  // Which canvas this menu is currently operating on ("public" | "private")
  // — stamped onto every logAction call here so History can tell public
  // and private actions apart, since the "actions" collection is shared.
  canvasMode = "public",
  ...props
}) {
  const editor = useEditor();
  const currentUser = auth.currentUser;
  // Canonical identity (see resolveMyActorId's doc comment) — this is the
  // exact string tagged as `actor` on every move this user makes, so it
  // must match whatever CollaborativeWhiteboard.js compares against for
  // private-nudge targeting.
  const actorId = resolveMyActorId(auth.currentUser);
  const actorUid = auth.currentUser?.uid || null;

  const userIdFromAuth =
    currentUser?.displayName ||
    currentUser?.email ||
    currentUser?.uid ||
    "anon";

  const [showCommentBox, setShowCommentBox] = useState(false);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const { className, projectName, teamName } = useParams();
  const [showAIInput, setShowAIInput] = useState(false);
  const [aiQuery, setAIQuery] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);

  const [panelWidth, setPanelWidth] = useState(340); // default width
  const [isResizing, setIsResizing] = useState(false);

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

    const entry = await makeHistoryEntry({
      userId: actorId,
      verb: "updated",
      shape,
      editor,
      userContext,
    });

    await logAction({
      className,
      projectName,
      teamName,
      actorId,
      actorUid,
      verb: "updated",
      shapeId: shape.id,
      shapeType: shape.type,
      textPreview: entry.text || "",
      imageUrl: entry.imageUrl || "",
      space: canvasMode,
    });
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

  // helpers
  function extractShapeText(shape) {
    // prefer single-line richText, else fallback to props.text
    return (
      shape?.props?.richText?.content?.[0]?.content?.[0]?.text ??
      shape?.props?.text ??
      ""
    );
  }

  async function extractImageUrl(editor, shape, userContext) {
    const assetId = shape?.props?.assetId;
    if (!assetId) return "";

    const asset = editor.getAsset(assetId);
    const src = asset?.props?.src || "";
    if (!src) return "";

    // Already a hosted URL — safe to use as-is
    if (/^https?:\/\//i.test(src)) return src;

    // Raw base64 or blob — must upload before it's safe for Firestore
    if (/^data:image\//i.test(src) || /^blob:/i.test(src)) {
      const hostedUrl = await ensureImageInStorageAndGetUrl({
        userContext,
        shapeId: shape.id,
        props: { src },
      });
      return hostedUrl || ""; // never return the raw base64 as fallback
    }

    return "";
  }

  async function makeHistoryEntry({
    userId,
    verb, // 'added' | 'updated' | 'deleted'
    shape,
    editor,
    userContext,
  }) {
    const shapeType = shape?.type ?? "shape";
    const text =
      shapeType === "note" || shapeType === "text"
        ? extractShapeText(shape)
        : "";
    const imageUrl =
      shapeType === "image"
        ? await extractImageUrl(editor, shape, userContext)
        : "";
    return {
      userId: userId || "anon",
      verb,
      shapeType,
      shapeId: shape?.id,
      text,
      imageUrl,
      timestamp: new Date().toISOString(),
    };
  }

  useEffect(() => {
    if (!editor) return;

    const updateSelection = () => {
      const ids = getSelectedIds();
      onTargetsChange?.(ids); // bubble up target IDs
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
        userId: actorId,
      };

      newlyCreatedRef.current.add(newShape.id);

      const finalImageUrl = await registerShape(newShape, userContext, editor);

      if (newShape.type === "image" && finalImageUrl) {
        const live = editor.getShape(newShape.id);
        if (live) {
          editor.updateShape({
            id: live.id,
            type: live.type,
            props: {
              ...live.props,
              url: finalImageUrl,
            },
          });
        } else {
          console.error(
            "[logShapeAddition] Uploaded image URL but live shape not found:",
            newShape.id
          );
        }
      }

      const entry = await makeHistoryEntry({
        userId: actorId,
        verb: "added",
        shape: newShape,
        editor,
        userContext,
      });

      await logAction({
        className,
        projectName,
        teamName,
        actorId,
        actorUid,
        verb: "added",
        shapeId: newShape.id,
        shapeType: newShape.type,
        textPreview: entry.text || "",
        imageUrl: entry.imageUrl || "",
        space: canvasMode,
      });
    };

    const handleShapeDeletion = async (removedRecord) => {
      const deletedShapeId = removedRecord?.id;

      if (!deletedShapeId) {
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
        userId: actorId,
      };

      await deleteShape(deletedShapeId, userContext);

      // Use the removed record's own snapshot (it still carries its type
      // and props even though the live shape is already gone from the
      // editor) instead of collapsing every delete to a generic "shape".
      // Without this, a deleted note/image/text showed up in history as
      // "deleted a shape" — losing the modality info the History panel's
      // icons and note/image previews rely on to tell delete actions apart.
      const deleted = {
        id: deletedShapeId,
        type: removedRecord.type || "shape",
        props: removedRecord.props || {},
      };

      const entry = await makeHistoryEntry({
        userId: actorId,
        verb: "deleted",
        shape: deleted,
        editor,
        userContext,
      });

      await logAction({
        className,
        projectName,
        teamName,
        actorId,
        actorUid,
        verb: "deleted",
        shapeId: deletedShapeId,
        shapeType: deleted.type,
        textPreview: entry.text || "",
        imageUrl: entry.imageUrl || "",
        space: canvasMode,
      });
    };

    // Only log adds/deletes that come from the LOCAL user's actions
    const unlistenUserAddsDeletes = editor.store.listen((entry) => {
      // With { scope: "user" }, this should already be local-only,
      // but keep this guard anyway if tldraw ever changes semantics.
      if (entry?.source && entry.source !== "user") return;

      const added = entry?.changes?.added
        ? Object.values(entry.changes.added)
        : [];
      const removed = entry?.changes?.removed
        ? Object.values(entry.changes.removed)
        : entry?.changes?.deleted
        ? Object.values(entry.changes.deleted)
        : [];

      // Added records -> log "added" once per shape
      for (const rec of added) {
        const isShapeRecord =
          rec?.typeName === "shape" ||
          rec?.type === "shape" ||
          rec?.kind === "shape";
        if (!isShapeRecord) continue;

        const shape = editor.getShape(rec.id);
        if (!shape) continue;

        // IMPORTANT: log only local creates (scope=user should enforce this)
        logShapeAddition(shape);
      }

      // Removed records -> log "deleted" once per shape
      for (const rec of removed) {
        const isShapeRecord =
          rec?.typeName === "shape" ||
          rec?.type === "shape" ||
          rec?.kind === "shape";
        if (!isShapeRecord) continue;

        // Pass the whole removed record through, not just its id — it's
        // the only place we still have the shape's type/props, since the
        // live shape is already gone from the editor by this point.
        handleShapeDeletion(rec);
      }
    });

    const shapeUpdateHandler = editor.sideEffects.registerAfterChangeHandler(
      "shape",
      async (updatedShape) => {
        if (!updatedShape) return;

        // Re-read live shape
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
          userId: actorId,
        };

        // --- session-based update ---
        ensureSession(normalized, userContext);
        await scheduleUpdateShape(normalized, userContext); // debounced write
        bumpIdleTimer(normalized, userContext, actorId, 1200);
      }
    );

    return () => {
      unlistenUserAddsDeletes?.();
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
              const userContext = {
                className,
                projectName,
                teamName,
                userId: actorId,
              };
              endSessionIfAny(leftShape, userContext, actorId);
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
            const userContext = {
              className,
              projectName,
              teamName,
              userId: actorId,
            };
            endSessionIfAny(shape, userContext, actorId);
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

        await response.json();
      } catch (err) {
        console.error("Clustering failed:", err);
      }
    };

    window.addEventListener("trigger-clustering", handleClustering);
    return () =>
      window.removeEventListener("trigger-clustering", handleClustering);
  }, [editor]);

  useEffect(() => {
    const updateSelectedShape = (shape) => {
      setSelectedShape(shape || null);
    };

    // Also update when selection changes
    const unsubscribe = editor.store.listen(({ changes, source }) => {
      if (source !== "user") return;
      if (changes.selectedIds) {
        updateSelectedShape(selectedShape);
      }
    });

    return () => {
      unsubscribe();
    };
  }, [editor, setSelectedShape, selectedShape]);

  const handleContextMenu = (event) => {
    event.preventDefault();

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
    });
  };

  const handleSuggestClustersClick = async () => {
    try {
      const shapesRef = collection(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "shapes"
      );

      const snapshot = await getDocs(shapesRef);

      const shapeDocs = snapshot.docs.map((doc) => {
        const data = doc.data();
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

  const handleTriggerAgentsClick = async () => {
    try {
      setAgentsLoading(true);
      const canvasId = `${className}_${projectName}_${teamName}`;

      const res = await fetch(
        "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/process",
        {
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
        return;
      }

      if (result?.nudges && result.nudges.length > 0) {
        const topNudge = result.nudges[0];

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
    </div>
  );
}
