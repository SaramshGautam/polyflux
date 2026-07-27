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
  // Which canvas ("public" | "private") this action happened on. The
  // "actions" collection is one shared collection per team, not split per
  // canvas, so this is the only thing that lets the History panel show
  // only the actions that belong to whichever canvas is currently active.
  // Defaults to "public" for any caller that hasn't been updated to pass
  // it yet, matching this app's original (pre-private-canvas) behavior.
  space = "public",
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
      space,
      createdAt: serverTimestamp(),
      clientTs: t,
    },
    { merge: true }
  );
}
