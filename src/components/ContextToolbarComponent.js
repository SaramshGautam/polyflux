import React, { useState, useEffect } from "react";
import { TldrawUiIcon, track, useEditor } from "tldraw";
import "tldraw/tldraw.css";
import CommentBox from "./CommentBox";
import { getAuth } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { app, db, auth, googleProvider, storage } from "../firebaseConfig";
import { useParams } from "react-router-dom";
import { logAction } from "../utils/registershapes";

const REACTIONS = [
  { value: "like", icon: "check-circle" },
  { value: "dislike", icon: "cross-circle" },
  { value: "surprise", icon: "warning-triangle" },
  { value: "confuse", icon: "question-mark-circle" },
];

const ContextToolbarComponent = track(
  ({
    userRole,
    selectedShape,
    commentCounts,
    onReactionClick,
    addComment,
    setSelectedShape,
    setActionHistory,
    fetchActionHistory,
  }) => {
    const editor = useEditor();
    const tooltipWidth = 250;

    const auth = getAuth();
    const user = auth.currentUser;

    const { className, projectName, teamName } = useParams();

    // Local state for showing the CommentBox
    const [showCommentBox, setShowCommentBox] = useState(false);
    const [hoveredReaction, setHoveredReaction] = useState(null);
    const [commentCount, setCommentCount] = useState(0);
    const [shapeReactions, setShapeReactions] = useState({});

    useEffect(() => {
      if (selectedShape) {
        fetchCommentCount(selectedShape.id);
        fetchReactions(selectedShape.id);
      }
    }, [selectedShape]);

    // Function to fetch comment count from Firestore
    const fetchCommentCount = async (shapeId) => {
      // const shapeRef = doc(
      //   db,
      //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeId}`
      // );

      const shapeRef = doc(
        db,
        "classrooms",
        className,
        "Project",
        projectName,
        "teams",
        teamName,
        "shapes",
        shapeId
      );

      try {
        const shapeSnap = await getDoc(shapeRef);
        if (shapeSnap.exists()) {
          const comments = shapeSnap.data().comments || [];
          setCommentCount(comments.length); // Set comment count
        }
      } catch (error) {
        console.error("Error fetching comment count:", error);
      }
    };

    // Handle showing the CommentBox when clicking the "tool-note" icon
    const handleCommentClick = () => {
      if (!selectedShape) return;
      setShowCommentBox(true); // Show the CommentBox
    };

    // Handle closing the CommentBox
    const handleCloseCommentBox = () => {
      setShowCommentBox(false); // Hide the CommentBox
    };

    const fetchReactions = async (shapeId) => {
      // const shapeRef = doc(
      //   db,
      //   `classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeId}`
      // );
      const shapeRef = doc(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "shapes",
        shapeId
      );
      try {
        const snap = await getDoc(shapeRef);
        if (!snap.exists()) {
          setShapeReactions((prev) => ({
            ...prev,
            [shapeId]: {},
          }));
          return;
        }
        const data = snap.data();
        setShapeReactions((prev) => ({
          ...prev,
          [shapeId]: data.reactions || {},
        }));
      } catch (err) {
        console.error("Failed to fetch Reactions", err);
      }
    };

    // Get the bounding box of the selected shapes in canvas (page) coordinates
    const selectionRotatedPageBounds = editor.getSelectionRotatedPageBounds();
    if (!selectionRotatedPageBounds || !selectedShape) return null;

    // Calculate the center of the selected bounds
    const centerX =
      selectionRotatedPageBounds.minX + selectionRotatedPageBounds.width / 2;
    const centerY = selectionRotatedPageBounds.minY - 10;
    const viewportCenter = editor.pageToViewport({ x: centerX, y: centerY });

    // const selectedId = selectedShape.id;
    const selectedShapeReactions = shapeReactions[selectedShape.id] || {};

    const handleReactionClick = async (reactionType) => {
      if (!user || !selectedShape) {
        console.error("User not logged in.");
        return;
      }

      // const reactionData = {
      //   shapeId: selectedId,
      //   userId: user.displayName || "Anonymous",
      //   // reactions: selectedShapeReactions,
      //   reactionType,
      //   timestamp: new Date().toLocaleString(),
      // };

      // console.log("Logging reaction data:", reactionData);
      const shapeId = selectedShape.id;
      const shapeType = selectedShape.type;
      const userName = user.displayName || "Anonymous";
      // const shapeRef = doc(
      //   db,
      //   `/classrooms/${className}/Projects/${projectName}/teams/${teamName}/shapes/${shapeId}`
      // );
      const shapeRef = doc(
        db,
        "classrooms",
        className,
        "Project",
        projectName,
        "teams",
        teamName,
        "shapes",
        shapeId
      );

      const usersReacted = shapeReactions[shapeId]?.[reactionType] || [];

      // Determine if the user already reacted
      const hasReacted = usersReacted.includes(userName);

      try {
        if (hasReacted) {
          // User is removing their reaction
          // await updateDoc(shapeRef, {
          //   [`reactions.${reactionType}`]: arrayRemove(userName),
          // });
          await setDoc(
            shapeRef,
            { [`reactions.${reactionType}`]: arrayRemove(userName) },
            { merge: true }
          );

          // Update state
          setShapeReactions((prevReactions) => ({
            ...prevReactions,
            [shapeId]: {
              ...prevReactions[shapeId],
              [reactionType]: usersReacted.filter((u) => u !== userName),
            },
          }));

          await logAction(
            { className, projectName, teamName },
            `removed ${reactionType}`,
            userName,
            shapeId,
            shapeType
          );
          fetchActionHistory({ className, projectName, teamName });
          // fetchActionHistory(
          //   { className, projectName, teamName },
          //   setActionHistory
          // );
        } else {
          // User is adding a reaction
          // await updateDoc(shapeRef, {
          //   [`reactions.${reactionType}`]: arrayUnion(userName),
          // });

          await setDoc(
            shapeRef,
            { [`reactions.${reactionType}`]: arrayUnion(userName) },
            { merge: true }
          );

          // Update state
          setShapeReactions((prevReactions) => ({
            ...prevReactions,
            [shapeId]: {
              ...prevReactions[shapeId],
              // [reactionType]: [...currentReactionUsers, userName],
              [reactionType]: [
                ...(prevReactions[shapeId]?.[reactionType] || []),
                userName,
              ],
            },
          }));

          await logAction(
            { className, projectName, teamName },
            `reacted with ${reactionType}`,
            userName,
            shapeId,
            shapeType
          );
          fetchActionHistory({ className, projectName, teamName });
          // fetchActionHistory(
          //   { className, projectName, teamName },
          //   setActionHistory
          // );
        }
      } catch (error) {
        console.error("Error updating reactions in Firestore:", error);
      }
    };

    return (
      <div
        style={{
          position: "absolute",
          pointerEvents: "all",
          top: viewportCenter.y - 42,
          left: viewportCenter.x - tooltipWidth / 2,
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 10,
        }}
      >
        <div
          style={{
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.1)",
            background: "var(--color-panel)",
            padding: "10px",
            // position: "relative", ////////////////////////////////
          }}
        >
          {/* Comment Section */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "5px",
              cursor: "pointer",
            }}
            onClick={handleCommentClick}
          >
            <TldrawUiIcon icon="tool-note" />
            <span style={{ fontSize: "12px" }}>{commentCount || 0}</span>
          </div>

          {/* Vertical Separator */}
          <div
            style={{
              width: "1px",
              height: "20px",
              backgroundColor: "rgba(0, 0, 0, 0.3)",
              margin: "0 5px", // Adjust spacing around the separator
            }}
          ></div>

          {/* Reactions Section */}
          <div style={{ display: "flex", gap: "10px" }}>
            {REACTIONS.map(({ value, icon }) => {
              const usersReacted = selectedShapeReactions[value] || [];
              // const reactionCount = usersReacted.length;
              const reactionCount = Array.isArray(usersReacted)
                ? usersReacted.length
                : 0;

              console.log(
                `User Reacted and reaction count === ${usersReacted} and ${reactionCount} `
              );
              return (
                <div
                  key={value}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "3px",
                    cursor: "pointer",
                    // position: "relative", /////////////////////////
                    background: reactionCount > 0 ? "#e8f8e0" : "#f9f9f9",
                    fontWeight: reactionCount > 0 ? "bold" : "normal",
                    color: reactionCount > 0 ? "#5c9e43" : "#6c757d",

                    boxShadow:
                      reactionCount > 0
                        ? "0px 0px 8px rgba(131, 204, 113, 0.4)"
                        : "none",
                    padding: "5px",
                    borderRadius: "5px",
                    transition: "box-shadow 0.3s ease-in-out",
                  }}
                  onClick={() => handleReactionClick(value)}
                  // onMouseEnter={() => setHoveredReaction(value)}
                  // onMouseLeave={() => setHoveredReaction(null)}
                >
                  <TldrawUiIcon icon={icon} />
                  <span style={{ fontSize: "12px" }}>{reactionCount}</span>
                  {hoveredReaction === value &&
                    Array.isArray(usersReacted) &&
                    usersReacted.length > 0 && (
                      <div
                        style={{
                          position: "absolute",
                          bottom: "100%",
                          left: "50%",
                          transform: "translateX(-50%)",
                          background: "#333",
                          color: "#fff",
                          padding: "5px 10px",
                          borderRadius: "5px",
                          whiteSpace: "nowrap",
                          fontSize: "12px",
                          boxShadow: "0px 0px 10px rgba(0, 0, 0, 0.2)",
                          zIndex: 20,
                        }}
                      >
                        {usersReacted.join(", ")}
                      </div>
                    )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Render the CommentBox when the state is true */}
        {showCommentBox && (
          <CommentBox
            selectedShape={selectedShape}
            addComment={addComment}
            showCommentBox={showCommentBox}
            onClose={handleCloseCommentBox}
            setActionHistory={setActionHistory}
            fetchActionHistory={fetchActionHistory}
            // logAction={logAction}
          />
        )}
      </div>
    );
  }
);

export default ContextToolbarComponent;
