import React, { useState, useEffect, useRef } from "react";
import { track, useEditor } from "tldraw";
import EmojiPicker from "emoji-picker-react";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faComment, faFaceSmile } from "@fortawesome/free-solid-svg-icons";
import { getAuth } from "firebase/auth";
import {
  doc,
  getDoc,
  setDoc,
  updateDoc,
  onSnapshot,
  arrayUnion,
  arrayRemove,
} from "firebase/firestore";
import { db } from "../firebaseConfig";
import { useParams } from "react-router-dom";
import { logAction } from "../utils/actionLog";
import CommentBox from "./CommentBox";
import "tldraw/tldraw.css";

const ContextToolbarComponent = track(
  ({
    userRole,
    commentCounts,
    addComment,
    setSelectedShape,
    setActionHistory,
    fetchActionHistory,
    // Set by the Comments panel when a comment is clicked there — once
    // selection catches up to this shape (see the effect below), its
    // comment box opens automatically and this gets cleared via the
    // callback.
    commentFocusShapeId,
    onCommentFocusComputed,
  }) => {
    const editor = useEditor();
    const tooltipWidth = 300;
    const auth = getAuth();
    const user = auth.currentUser;
    const { className, projectName, teamName } = useParams();

    const [showCommentBox, setShowCommentBox] = useState(false);
    const [showEmojiPicker, setShowEmojiPicker] = useState(false);
    const [commentCount, setCommentCount] = useState(0);
    const [shapeReactions, setShapeReactions] = useState({});
    const [hoveredEmoji, setHoveredEmoji] = useState(null);
    const pickerRef = useRef(null);

    const selectedIds = editor.getSelectedShapeIds();
    const selectedShape =
      selectedIds.length === 1 ? editor.getShape(selectedIds[0]) : null;

    // The parent calls panToShape() then sets commentFocusShapeId before
    // tldraw's selection has necessarily caught up yet — this effect
    // re-checks on every render (this component is track()-wrapped, so it
    // re-renders whenever the store's selection changes) and only opens
    // once selectedShape actually matches the requested target.
    useEffect(() => {
      if (!commentFocusShapeId) return;
      if (selectedShape?.id !== commentFocusShapeId) return;
      setShowCommentBox(true);
      onCommentFocusComputed?.();
    }, [commentFocusShapeId, selectedShape?.id, onCommentFocusComputed]);

    // Close picker when clicking outside
    useEffect(() => {
      const handleClickOutside = (e) => {
        if (pickerRef.current && !pickerRef.current.contains(e.target)) {
          setShowEmojiPicker(false);
        }
      };
      document.addEventListener("mousedown", handleClickOutside);
      return () =>
        document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Live listener for reactions + comment count on the selected shape
    useEffect(() => {
      if (!selectedShape?.id || !className || !projectName || !teamName) return;

      const shapeRef = doc(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "shapes",
        selectedShape.id
      );

      const unsub = onSnapshot(shapeRef, (snap) => {
        if (snap.exists()) {
          const data = snap.data();
          setShapeReactions((prev) => ({
            ...prev,
            [selectedShape.id]: data.reactions || {},
          }));
          const comments = data.comments || [];
          setCommentCount(comments.length);
        }
      });

      return () => unsub();
    }, [selectedShape?.id, className, projectName, teamName]);

    const toggleReaction = async (emoji) => {
      if (!user || !selectedShape) return;

      const shapeId = selectedShape.id;
      const userName = user.displayName || "Anonymous";

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

      const usersReacted = shapeReactions[shapeId]?.[emoji] || [];
      const hasReacted = usersReacted.includes(userName);

      try {
        // Step 1: ensure the document exists first
        const snap = await getDoc(shapeRef);
        if (!snap.exists()) {
          await setDoc(shapeRef, {
            shapeId,
            reactions: {},
          });
        }

        // Step 2: use updateDoc with dot-notation so Firestore
        // treats it as a nested path: reactions -> emoji -> array
        if (hasReacted) {
          await updateDoc(shapeRef, {
            [`reactions.${emoji}`]: arrayRemove(userName),
          });
          setShapeReactions((prev) => ({
            ...prev,
            [shapeId]: {
              ...prev[shapeId],
              [emoji]: usersReacted.filter((u) => u !== userName),
            },
          }));
        } else {
          await updateDoc(shapeRef, {
            [`reactions.${emoji}`]: arrayUnion(userName),
          });
          setShapeReactions((prev) => ({
            ...prev,
            [shapeId]: {
              ...prev[shapeId],
              [emoji]: [...usersReacted, userName],
            },
          }));
          // logAction takes a single options object, not positional args —
          // see the matching fix in CommentBox.js for the full story on
          // why the old call here was silently dropping verb/shapeId/
          // shapeType and producing invalid Firestore writes.
          await logAction({
            className,
            projectName,
            teamName,
            actorId: userName,
            actorUid: user?.uid || null,
            verb: `reacted with ${emoji} on`,
            shapeId,
            shapeType: selectedShape.type,
          });
        }
      } catch (err) {
        console.error("Error toggling reaction:", err);
      }
    };

    const handleEmojiSelect = async (emojiData) => {
      await toggleReaction(emojiData.emoji);
      setShowEmojiPicker(false);
    };

    const handleReactionClick = async (emoji) => {
      await toggleReaction(emoji);
    };

    const selectionRotatedPageBounds = editor.getSelectionRotatedPageBounds();
    if (!selectionRotatedPageBounds || !selectedShape) return null;

    const centerX =
      selectionRotatedPageBounds.minX + selectionRotatedPageBounds.width / 2;
    const centerY = selectionRotatedPageBounds.minY - 10;
    const viewportCenter = editor.pageToViewport({ x: centerX, y: centerY });

    // Get all reactions for this shape that have at least 1 user
    const currentReactions = shapeReactions[selectedShape.id] || {};
    const activeReactions = Object.entries(currentReactions).filter(
      ([, users]) => Array.isArray(users) && users.length > 0
    );

    const userName = user?.displayName || "Anonymous";

    return (
      <div
        style={{
          position: "absolute",
          pointerEvents: "all",
          top: viewportCenter.y - 42,
          left: viewportCenter.x - tooltipWidth / 2,
          zIndex: 10,
        }}
      >
        {/* Main toolbar pill */}
        <div
          style={{
            borderRadius: 8,
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: 4,
            boxShadow: "0 0 0 1px rgba(0,0,0,0.1), 0 4px 8px rgba(0,0,0,0.1)",
            background: "var(--color-panel)",
            padding: "6px 10px",
          }}
        >
          {/* Comment button */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              cursor: "pointer",
              color: showCommentBox ? "#2563eb" : "#6c757d",
              padding: "4px 6px",
              borderRadius: 6,
              background: showCommentBox ? "#eff6ff" : "transparent",
            }}
            onClick={() => setShowCommentBox((p) => !p)}
          >
            <FontAwesomeIcon icon={faComment} style={{ fontSize: 13 }} />
            <span style={{ fontSize: 12 }}>{commentCount || 0}</span>
          </div>

          {/* Divider */}
          <div
            style={{
              width: 1,
              height: 20,
              backgroundColor: "rgba(0,0,0,0.15)",
              margin: "0 2px",
            }}
          />

          {/* Active emoji reactions */}
          {activeReactions.map(([emoji, users]) => {
            const hasReacted = users.includes(userName);
            return (
              <div
                key={emoji}
                title={users.join(", ")}
                onClick={() => handleReactionClick(emoji)}
                onMouseEnter={() => setHoveredEmoji(emoji)}
                onMouseLeave={() => setHoveredEmoji(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 3,
                  cursor: "pointer",
                  padding: "3px 7px",
                  borderRadius: 12,
                  fontSize: 16,
                  background: hasReacted ? "#dbeafe" : "#f3f4f6",
                  border: hasReacted
                    ? "1px solid #93c5fd"
                    : "1px solid #e5e7eb",
                  transition: "all 0.15s ease",
                  position: "relative",
                }}
              >
                <span>{emoji}</span>
                <span
                  style={{ fontSize: 11, color: "#374151", fontWeight: 600 }}
                >
                  {users.length}
                </span>

                {/* Tooltip on hover */}
                {hoveredEmoji === emoji && (
                  <div
                    style={{
                      position: "absolute",
                      bottom: "calc(100% + 6px)",
                      left: "50%",
                      transform: "translateX(-50%)",
                      background: "#1f2937",
                      color: "#fff",
                      padding: "4px 8px",
                      borderRadius: 6,
                      whiteSpace: "nowrap",
                      fontSize: 11,
                      zIndex: 30,
                      pointerEvents: "none",
                    }}
                  >
                    {users.join(", ")}
                  </div>
                )}
              </div>
            );
          })}

          {/* Add reaction button */}
          <div
            onClick={() => setShowEmojiPicker((p) => !p)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              cursor: "pointer",
              padding: "3px 7px",
              borderRadius: 12,
              background: showEmojiPicker ? "#f3f4f6" : "transparent",
              border: "1px dashed #d1d5db",
              color: "#6b7280",
              fontSize: 14,
              gap: 3,
            }}
          >
            <FontAwesomeIcon icon={faFaceSmile} style={{ fontSize: 13 }} />
            <span style={{ fontSize: 11 }}>+</span>
          </div>
        </div>

        {/* Emoji picker */}
        {showEmojiPicker && (
          <div
            ref={pickerRef}
            style={{
              position: "absolute",
              top: "calc(100% + 8px)",
              left: 0,
              zIndex: 100,
              boxShadow: "0 8px 24px rgba(0,0,0,0.15)",
              borderRadius: 12,
              overflow: "hidden",
            }}
          >
            <EmojiPicker
              onEmojiClick={handleEmojiSelect}
              skinTonesDisabled
              searchDisabled={false}
              height={350}
              width={300}
              previewConfig={{ showPreview: false }}
            />
          </div>
        )}

        {/* Comment box */}
        {showCommentBox && (
          <CommentBox
            selectedShape={selectedShape}
            addComment={addComment}
            showCommentBox={showCommentBox}
            onClose={() => setShowCommentBox(false)}
            setActionHistory={setActionHistory}
            fetchActionHistory={fetchActionHistory}
          />
        )}
      </div>
    );
  }
);

export default ContextToolbarComponent;
