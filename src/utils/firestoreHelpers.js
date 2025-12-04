import { doc, updateDoc, getDoc, arrayUnion } from "firebase/firestore";
import { db, auth } from "../firebaseConfig";

export const AddCommentToShape = async (
  shapeId,
  commentText,
  context,
  user
) => {
  const { className, projectName, teamName } = context;

  if (!user) {
    console.error("User not logged in!");
    return;
  }

  const userName = user.displayName || "Anonymous";
  const timestamp = new Date().toISOString(); // Standardized timestamp

  const commentData = {
    userId: userName,
    timestamp: timestamp,
    text: commentText,
  };

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
    await updateDoc(shapeRef, {
      comments: arrayUnion(commentData), // Push new comment into array
    });

    console.log("✅ Comment added successfully!");
  } catch (error) {
    console.error("❌ Error adding comment:", error);
  }
};

export const fetchCommentsForShape = async (shapeId, context) => {
  const { className, projectName, teamName } = context;
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
    const shapeSnap = await getDoc(shapeRef);
    if (shapeSnap.exists()) {
      return shapeSnap.data().comments || [];
    }
    return [];
  } catch (error) {
    console.error("❌ Error fetching comments:", error);
    return [];
  }
};
