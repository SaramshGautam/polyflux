// utils/actionLog.js
import { doc, setDoc, serverTimestamp } from "firebase/firestore";
import { db } from "../firebaseConfig";

function bucketTime(ms, bucketMs = 1500) {
  return Math.floor(ms / bucketMs) * bucketMs;
}

export async function logAction({
  className,
  projectName,
  teamName,
  actorId,
  actorUid,
  verb,
  shapeId,
  shapeType,
  textPreview = "",
  imageUrl = "",
}) {
  const uid = actorUid || actorId || "anon";
  const t = bucketTime(Date.now(), 1500);

  const actionDocId = `${verb}:${shapeId}:${uid}:${t}`;

  // console.groupCollapsed("[logAction]", actionDocId);
  // console.log({ verb, shapeId, uid, t, className, projectName, teamName });
  // console.trace(); // shows EXACT call sites
  // console.groupEnd();

  const ref = doc(
    db,
    "classrooms",
    className,
    "Projects",
    projectName,
    "teams",
    teamName,
    "actions",
    actionDocId
  );

  await setDoc(
    ref,
    {
      actorId: actorId || "anon",
      actorUid: actorUid || null,
      verb,
      shapeId,
      shapeType,
      textPreview,
      imageUrl,
      createdAt: serverTimestamp(),
      clientTs: t,
    },
    { merge: true }
  );
}
