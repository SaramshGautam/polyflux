// import React, { useEffect, useRef, useState } from "react";
// import { getAuth } from "firebase/auth";

// export default function CommentBox({
//   selectedShape,
//   // addCommentIcon,
//   addComment,
//   showCommentBox,
//   onClose,
//   logAction,
// }) {
//   const auth = getAuth();
//   const user = auth.currentUser;

//   const [commentData, setCommentData] = useState({
//     userId: user ? user.displayName || "Anonymous" : "Anonymous",
//     timestamp: new Date().toLocaleString(),
//     text: "",
//   });

//   const commentInputRef = useRef(null);

//   useEffect(() => {
//     if (showCommentBox && commentInputRef.current) {
//       commentInputRef.current.focus();
//     }
//   }, [showCommentBox]);

//   const handleCommentSubmit = (e) => {
//     e.preventDefault();

//     if (!selectedShape) return;

//     addComment(selectedShape.id, commentData);

//     // Clear comment data and close comment box
//     setCommentData({ ...commentData, text: "" });

//     // addCommentIcon(selectedShape.id);
//     logAction({ userId: commentData.userId, action: "added a comment" });
//     onClose();
//   };

//   const handleClear = () => {
//     setCommentData({ ...commentData, text: "" });
//   };

//   if (!showCommentBox) return null;

//   return (
//     <div className="commentBox">
//       <button onClick={onClose} className="closeButton">
//         ×
//       </button>

//       <h4 className="commentBoxTitle">Add Comment</h4>
//       <form onSubmit={handleCommentSubmit}>
//         <label className="label">
//           User ID:
//           <input
//             type="text"
//             value={commentData.userId}
//             onChange={(e) =>
//               setCommentData({ ...commentData, userId: e.target.value })
//             }
//             className="input"
//           />
//         </label>
//         <label className="label">
//           Time:
//           <input
//             type="text"
//             value={commentData.timestamp}
//             readOnly
//             className="input"
//           />
//         </label>
//         <label className="label">
//           Comment:
//           <textarea
//             ref={commentInputRef}
//             value={commentData.text}
//             onChange={(e) =>
//               setCommentData({ ...commentData, text: e.target.value })
//             }
//             className="textarea"
//             onKeyDown={(e) => {
//               if (e.key === "Enter" && !e.shiftKey) {
//                 handleCommentSubmit(e); // Submit on Enter
//               }
//             }}
//           />
//         </label>
//         <button type="submit" className="button">
//           Submit
//         </button>
//         <button type="button" onClick={handleClear} className="clearButton">
//           Clear
//         </button>
//       </form>
//     </div>
//   );
// }

import React, { useState, useEffect, useRef } from "react";
import { getAuth } from "firebase/auth";
import { AddCommentToShape } from "../utils/firestoreHelpers";
import { useParams } from "react-router-dom";
import { Timestamp } from "firebase/firestore";
import { logAction } from "../utils/actionLog";

export default function CommentBox({
  selectedShape,
  addComment,
  showCommentBox,
  onClose,
  setActionHistory,
  fetchActionHistory,
  // logAction,
}) {
  const auth = getAuth();
  const user = auth.currentUser;
  const commentInputRef = useRef(null);
  const [commentText, setCommentText] = useState("");
  const { className, projectName, teamName } = useParams();

  useEffect(() => {
    if (showCommentBox && commentInputRef.current) {
      commentInputRef.current.focus();
    }
  }, [showCommentBox]);

  const userContext = {
    className,
    projectName,
    teamName,
    userId: user.displayName,
  };

  const handleCommentSubmit = async (e) => {
    e.preventDefault();
    if (!selectedShape || !commentText.trim()) return;

    if (!user) {
      console.error("User not logged in!");
      return;
    }

    const commentData = {
      userId: user.displayName || "Anonymous",
      Timestamp: new Date().toLocaleString(),
      text: commentText,
    };

    addComment(selectedShape.id, commentData);

    await AddCommentToShape(
      selectedShape.id,
      commentText,
      {
        className,
        projectName,
        teamName,
      },
      user
    );

    setCommentText(""); // Clear input after submission
    // logAction({ userId: user.displayName, action: "added a comment" });
    await logAction(
      {
        className,
        projectName,
        teamName,
      },
      "added a comment in ",
      user.displayName,
      selectedShape.id,
      selectedShape.type || "unknown"
    );

    // fetchActionHistory({ className, projectName, teamName }, setActionHistory);
    fetchActionHistory({ className, projectName, teamName });

    onClose();
  };

  if (!showCommentBox) return null;

  return (
    <div className="commentBox">
      <button onClick={onClose} className="closeButton">
        ×
      </button>
      <h4 className="commentBoxTitle">Add Comment</h4>
      <form onSubmit={handleCommentSubmit}>
        <label className="label">
          User ID:
          <input
            type="text"
            value={user ? user.displayName : "Anonymous"}
            readOnly
            className="input"
          />
        </label>
        <label className="label">
          Comment:
          <textarea
            ref={commentInputRef}
            value={commentText}
            onChange={(e) => setCommentText(e.target.value)}
            className="textarea"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) handleCommentSubmit(e);
            }}
          />
        </label>
        <button type="submit" className="button">
          Submit
        </button>
      </form>
    </div>
  );
}
