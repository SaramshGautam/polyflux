// utils/actionLog.js
import { doc, setDoc, addDoc, collection, serverTimestamp } from "firebase/firestore";
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

// One history row for an action that covers several shapes at once (e.g.
// publishing a multi-selection across the portal) — logAction above always
// writes one row per shape, which is right for ordinary edits but reads as
// N separate "brought over a note" rows for what was really a single user
// action. `items` is [{ shapeId, shapeType, textPreview, imageUrl }, ...];
// HistoryPanel.js turns this into a single "brought over 2 notes and 1
// image" row. Deliberately NOT using logAction's deterministic
// setDoc+merge id scheme — that id is per-shape (verb:shapeId:uid:bucket),
// which is exactly what makes rapid repeat edits of the SAME shape merge
// safely. A batch has no single shapeId to key on, and reusing a
// time-bucketed id here would risk two distinct rapid publishes by the
// same person overwriting (not merging — Firestore doesn't deep-merge
// arrays) each other's `items`. addDoc sidesteps that: every batch call is
// always its own new row.
export async function logBatchAction({
  className,
  projectName,
  teamName,
  actorId,
  actorUid,
  verb,
  items,
  space = "public",
}) {
  if (!Array.isArray(items) || !items.length) return;

  const col = collection(
    db,
    "classrooms",
    className,
    "Projects",
    projectName,
    "teams",
    teamName,
    "actions"
  );

  await addDoc(col, {
    actorId: actorId || "anon",
    actorUid: actorUid || null,
    verb,
    items,
    shapeIds: items.map((i) => i.shapeId).filter(Boolean),
    space,
    createdAt: serverTimestamp(),
    clientTs: bucketTime(Date.now(), 1500),
  });
}
