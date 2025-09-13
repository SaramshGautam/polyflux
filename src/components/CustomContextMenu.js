import React, { useState, useEffect, useContext } from "react";
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
  updateShape,
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
  // togglePanel,
  onNudge,
  onTargetsChange,
  ...props
}) {
  const editor = useEditor();
  const [showCommentBox, setShowCommentBox] = useState(false);
  // const [comments, setComments] = useState({});
  // const [actionHistory, setActionHistory] = useState([]);
  const [isPanelCollapsed, setIsPanelCollapsed] = useState(true);
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });
  const { className, projectName, teamName } = useParams();
  const [showAIInput, setShowAIInput] = useState(false);
  const [aiQuery, setAIQuery] = useState("");
  const [agentsLoading, setAgentsLoading] = useState(false);

  const getSelectedIds = () => Array.from(editor.getSelectedShapeIds?.() ?? []);

  const getSelectedShapeSafe = (id) => {
    try {
      return id ? editor.getShape(id) : null;
    } catch {
      return null;
    }
  };

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

    const userId = auth.currentUser ? auth.currentUser.displayName : "anon";
    const userContext = { className, projectName, teamName, userId };

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
      await registerShape(newShape, userContext);

      setActionHistory((prev) => [
        {
          userId,
          action: `added a ${newShape.type}`,
          shapeId: newShape.id,
          timestamp: new Date().toLocaleString(),
        },
        ...prev.filter((entry) => entry.shapeId !== newShape.id),
      ]);
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
        userId: auth.currentUser ? auth.currentUser.displayName : "anon",
      };

      await deleteShape(deletedShapeID.id, userContext);

      setActionHistory((prev) => [
        {
          userId: auth.currentUser ? auth.currentUser.displayName : "anon",
          action: `deleted`,
          shapeId: deletedShapeID.id,
          timestamp: new Date().toLocaleString(),
        },
        ...prev,
      ]);
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

        const liveShape = editor.getShape(updatedShape.id);
        if (!liveShape) {
          console.error("Shape not found in editor:", updatedShape.id);
          return;
        }

        console.log(
          "Live shape text:",
          updatedShape?.props?.richText?.content?.[0]?.content?.[0]?.text
        );

        // if (
        //   !liveShape.props.text &&
        //   liveShape?.props?.richText?.content?.[0]?.content?.[0]?.text
        // ) {
        //   liveShape.props.text =
        //     liveShape.props.richText.content[0].content[0].text;
        // }

        const extractedText =
          liveShape?.props?.richText?.content?.[0]?.content?.[0]?.text;

        updatedShape = {
          ...liveShape,
          props: {
            ...liveShape.props,
            text: extractedText || liveShape.props.text || "",
          },
        };

        // if (
        //   !liveShape.props.text &&
        //   liveShape.props.richText?.content?.[0]?.content?.[0]?.text
        // ) {
        //   liveShape.props.text =
        //     liveShape.props.richText.content[0].content[0].text;
        // }

        // if (
        //   !liveShape.textContent
        //   // liveShape.props.richText?.content?.[0]?.content?.[0]?.text
        // ) {
        //   liveShape.textContent = liveShape.textContent;
        //   // liveShape.props.richText.content[0].content[0].text;
        // }

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
          userId: auth.currentUser ? auth.currentUser.displayName : "anon",
        };

        await updateShape(updatedShape, userContext);
        // setActionHistory((prev) => [
        //   {
        //     userId,
        //     action: `updated a ${updatedShape.type}`,
        //     shapeId: updatedShape.id,
        //     timestamp: new Date().toLocaleString(),
        //   },
        //   ...prev.filter((entry) => entry.shapeId !== updatedShape.id),
        // ]);

        setActionHistory((prev) => {
          const alreadyExists = prev.some(
            (entry) =>
              entry.shapeId === liveShape.id &&
              entry.action.startsWith("updated")
          );
          if (alreadyExists) return prev;
          return [
            {
              userId,
              action: `updated a ${liveShape.type}`,
              shapeId: liveShape.id,
              timestamp: new Date().toLocaleString(),
            },
            ...prev,
          ];
        });
      }
    );

    return () => {
      shapeCreateHandler();
      shapeDeleteHandler();
      shapeUpdateHandler();
    };
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

  const togglePanel = () => {
    setIsPanelCollapsed(!isPanelCollapsed);
  };

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
        <TldrawUiMenuGroup id="askAI">
          <button
            className="tlui-button tlui-button__menu"
            tabIndex={-2}
            style={{ backgroundColor: "#306d32", color: "white" }}
            onClick={() => {
              // if (!selectedShape) {
              //   console.log("No shape selected.");
              //   window.dispatchEvent(new CustomEvent("trigger-chatbot"));
              //   return;
              // }

              if (!selection || !selection.ids?.length) {
                console.log("No shape selected.");
                window.dispatchEvent(new CustomEvent("trigger-chatbot"));
                return;
              }
              const payload = buildAiPayload(selection, editor);
              console.log("AI Payload:", payload);
              window.dispatchEvent(
                new CustomEvent("trigger-chatbot", { detail: payload })
              );
              // return;
              // console.log("Selected shape props:", selectedShape.props);

              //Extract position of the shape for AI tooktip
              const bounds = editor.getShapePageBounds(selection.primary?.id);
              console.log("Shape bounds:", bounds);
              // const shapeCenter = {
              //   x: (bounds.minX + bounds.maxX) / 2,
              //   y: (bounds.minY + bounds.maxY) / 2,
              // };
              // console.log("Shape center:", shapeCenter);
              const preferredPoint = {
                x: bounds.maxX + 10,
                y: bounds.maxY - 30,
              };
              let screenPoint = editor.pageToScreen(preferredPoint);
              // const screenPoint = editor.pageToScreen(shapeCenter);
              console.log("Screen point:", screenPoint);

              screenPoint.x = Math.min(screenPoint.x, window.innerWidth - 400);
              screenPoint.y = Math.min(screenPoint.y, window.innerHeight - 500);

              let shapeText = "";
              try {
                if (
                  selectedShape.type === "image" &&
                  selectedShape?.props?.assetId
                ) {
                  console.log(
                    "Image shape detected, using assetId.",
                    selectedShape.props.assetId
                  );
                  // shapeText = selectedShape.props.assetId;
                  const asset = editor.getAsset(selectedShape.props.assetId);
                  console.log("Asset src:", asset?.props?.src);
                  if (asset?.props?.src) {
                    window.dispatchEvent(
                      new CustomEvent("trigger-chatbot", {
                        detail: {
                          snippet: asset.props.src,
                          source: selectedShape.id,
                          position: screenPoint,
                        },
                      })
                    );
                    return;
                  }
                }
                const contentArr = selectedShape?.props?.richText?.content;
                if (
                  contentArr &&
                  Array.isArray(contentArr) &&
                  contentArr[0]?.content &&
                  Array.isArray(contentArr[0].content) &&
                  contentArr[0].content[0]?.text
                ) {
                  shapeText = contentArr[0].content[0].text;
                  console.log("Shape text found:", shapeText);
                  window.dispatchEvent(
                    new CustomEvent("trigger-chatbot", {
                      detail: {
                        snippet: shapeText,
                        source: selectedShape.id,
                        position: screenPoint,
                      },
                    })
                  );
                } else {
                  console.log("No text found in shape props.");
                  window.dispatchEvent(new CustomEvent("trigger-chatbot"));
                }
              } catch (e) {
                console.error("Error extracting text from shape props:", e);
              }
            }}
          >
            <span className="tlui-button__label" draggable="false">
              Ask AI
            </span>
            <kbd className="tlui-kbd">
              <span>⌘</span>
              <span>/</span>
            </kbd>
          </button>

          {/* <button
            className="tlui-button tlui-button__menu"
            tabIndex={-2}
            style={{ backgroundColor: "#23447b", color: "white" }}
            onClick={handleSuggestClustersClick}
          >
            <span className="tlui-button__label" draggable="false">
              Suggest Clusters
            </span>
          </button> */}

          <button
            className="tlui-button tlui-button__menu"
            tabIndex={-2}
            style={{ backgroundColor: "#6a1b9a", color: "white" }}
            onClick={handleTriggerAgentsClick}
            disabled={agentsLoading}
            aria-busy={agentsLoading}
            aria-live="polite"
          >
            <span className="tlui-button__label" draggable="false">
              {agentsLoading ? (
                <>
                  Triggering... <span className="spinner" aria-hidden="true" />
                </>
              ) : (
                // "Trigger Agents"
                "AI Help!"
              )}
            </span>
          </button>
        </TldrawUiMenuGroup>

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
