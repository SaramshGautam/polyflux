import React, { useState, useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { AddCommentToShape } from "../utils/firestoreHelpers";
import { useParams } from "react-router-dom";
import { logAction } from "../utils/actionLog";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faXmark,
  faPaperPlane,
  faComments,
  faStickyNote,
  faFont,
  faImage,
  faSquare,
  faCircle,
  faMinus,
  faArrowRight,
  faQuestion,
} from "@fortawesome/free-solid-svg-icons";
import { doc, onSnapshot } from "firebase/firestore";
import { db } from "../firebaseConfig";
import "./CommentBox.css";

const SHAPE_TYPE_ICONS = {
  note: faStickyNote,
  text: faFont,
  image: faImage,
  geo: faSquare,
  draw: faMinus,
  arrow: faArrowRight,
  line: faMinus,
  frame: faSquare,
  ellipse: faCircle,
};

const getShapeIcon = (type) => SHAPE_TYPE_ICONS[type] ?? faQuestion;

export default function CommentBox({
  selectedShape,
  addComment,
  showCommentBox,
  onClose,
  setActionHistory,
  fetchActionHistory,
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  const commentInputRef = useRef(null);
  const commentsEndRef = useRef(null);
  const [commentText, setCommentText] = useState("");
  const [existingComments, setExistingComments] = useState([]);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { className, projectName, teamName } = useParams();

  // Live-listen to comments for this shape from Firestore
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
        const comments = snap.data().comments || [];
        const sorted = [...comments].sort((a, b) => {
          const ta = a.Timestamp || a.timestamp || "";
          const tb = b.Timestamp || b.timestamp || "";
          return ta > tb ? 1 : -1;
        });
        setExistingComments(sorted);
      }
    });

    return () => unsub();
  }, [selectedShape?.id, className, projectName, teamName]);

  // Scroll to bottom when new comments arrive
  useEffect(() => {
    commentsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [existingComments]);

  // Focus textarea when opened
  useEffect(() => {
    if (showCommentBox) {
      setTimeout(() => commentInputRef.current?.focus(), 50);
    }
  }, [showCommentBox]);

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedShape || !commentText.trim() || !user) return;

    setIsSubmitting(true);

    const commentData = {
      userId: user.displayName || "Anonymous",
      Timestamp: new Date().toLocaleString(),
      text: commentText.trim(),
    };

    try {
      addComment(selectedShape.id, commentData);

      await AddCommentToShape(
        selectedShape.id,
        commentText.trim(),
        { className, projectName, teamName },
        user
      );

      await logAction(
        { className, projectName, teamName },
        "added a comment in",
        user.displayName,
        selectedShape.id,
        selectedShape.type || "unknown"
      );

      fetchActionHistory?.({ className, projectName, teamName });
      setCommentText("");
      onClose();
    } catch (err) {
      console.error("Failed to submit comment:", err);
    } finally {
      setIsSubmitting(false);
    }
  };

  const formatTime = (ts) => {
    if (!ts) return "";
    try {
      const d = new Date(ts);
      const now = new Date();
      const diffMs = now - d;
      const diffMin = Math.floor(diffMs / 60000);
      const diffHr = Math.floor(diffMin / 60);
      const diffDay = Math.floor(diffHr / 24);

      if (diffMin < 1) return "just now";
      if (diffMin < 60) return `${diffMin}m ago`;
      if (diffHr < 24) return `${diffHr}h ago`;
      if (diffDay < 7) return `${diffDay}d ago`;
      return d.toLocaleDateString();
    } catch {
      return ts;
    }
  };

  const getInitials = (name) => {
    if (!name) return "?";
    return name
      .split(" ")
      .map((n) => n[0])
      .join("")
      .toUpperCase()
      .slice(0, 2);
  };

  const getAvatarColor = (name) => {
    const colors = [
      "#6366f1",
      "#8b5cf6",
      "#ec4899",
      "#f59e0b",
      "#10b981",
      "#3b82f6",
      "#ef4444",
      "#14b8a6",
    ];
    if (!name) return colors[0];
    return colors[name.charCodeAt(0) % colors.length];
  };

  const shapeLabel =
    selectedShape?.props?.text ||
    selectedShape?.props?.richText?.content?.[0]?.content?.[0]?.text ||
    selectedShape?.type ||
    "shape";

  if (!showCommentBox) return null;

  return (
    <div
      className="comment-box"
      onMouseDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {/* Header */}
      <div className="comment-box__header">
        <div className="comment-box__header-info">
          <span className="comment-box__title">Comments</span>
          <span className="comment-box__subtitle">
            <FontAwesomeIcon
              icon={getShapeIcon(selectedShape?.type)}
              className="comment-box__shape-icon"
            />{" "}
            {shapeLabel.slice(0, 36)}
            {shapeLabel.length > 36 ? "…" : ""}
          </span>
        </div>
        <button className="comment-box__close" onClick={onClose}>
          <FontAwesomeIcon icon={faXmark} />
        </button>
      </div>

      {/* Comments list */}
      <div className="comment-box__list">
        {existingComments.length === 0 ? (
          <div className="comment-box__empty">
            <FontAwesomeIcon
              icon={faComments}
              className="comment-box__empty-icon"
            />
            <span>No comments yet. Be the first!</span>
          </div>
        ) : (
          existingComments.map((c, i) => {
            const isMe = c.userId === (user?.displayName || "Anonymous");
            return (
              <div key={i} className="comment-box__item">
                {/* Avatar */}
                <div
                  className="comment-box__avatar"
                  style={{ background: getAvatarColor(c.userId) }}
                >
                  {getInitials(c.userId)}
                </div>

                <div className="comment-box__content">
                  <div className="comment-box__meta">
                    <span
                      className={`comment-box__username ${
                        isMe ? "comment-box__username--me" : ""
                      }`}
                    >
                      {isMe ? "You" : c.userId}
                    </span>
                    <span className="comment-box__time">
                      {formatTime(c.Timestamp || c.timestamp)}
                    </span>
                  </div>
                  <div
                    className={`comment-box__bubble ${
                      isMe ? "comment-box__bubble--me" : ""
                    }`}
                  >
                    {c.text}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={commentsEndRef} />
      </div>

      {/* Input area */}
      <div className="comment-box__footer">
        <div className="comment-box__current-user">
          <div
            className="comment-box__avatar comment-box__avatar--sm"
            style={{ background: getAvatarColor(user?.displayName) }}
          >
            {getInitials(user?.displayName)}
          </div>
          <span className="comment-box__current-name">
            {user?.displayName || "Anonymous"}
          </span>
        </div>

        <form className="comment-box__form" onSubmit={handleCommentSubmit}>
          <textarea
            ref={commentInputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            placeholder="Add a comment… (Enter to send)"
            rows={2}
            className="comment-box__textarea"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleCommentSubmit(e);
              }
            }}
          />
          <button
            type="submit"
            disabled={!commentText.trim() || isSubmitting}
            className={`comment-box__send ${
              commentText.trim() ? "comment-box__send--active" : ""
            }`}
          >
            <FontAwesomeIcon icon={faPaperPlane} />
          </button>
        </form>

        <p className="comment-box__hint">Shift+Enter for new line</p>
      </div>
    </div>
  );
}
