// src/history/useCanvasActionHistory.js
import { useEffect, useMemo, useState, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

/**
 * Normalize common timestamp shapes into ISO string.
 * Supports Firestore Timestamp, Date, or ISO string.
 */
export function normalizeHistoryTimestamp(rawTs) {
  if (!rawTs) return null;

  // Firestore Timestamp
  if (typeof rawTs?.toDate === "function") {
    try {
      return rawTs.toDate().toISOString();
    } catch {
      return null;
    }
  }

  if (rawTs instanceof Date) return rawTs.toISOString();
  if (typeof rawTs === "string") return rawTs;

  return null;
}

function normalizeHistoryRow(docSnap) {
  const data = docSnap.data?.() ?? {};
  const ts = normalizeHistoryTimestamp(data.createdAt);

  const verb = data.verb || data.action || "updated";

  return {
    id: docSnap.id,
    userId: data.actorId || data.userId || "Unknown User",
    verb,
    action: verb, // backward compat
    shapeType: data.shapeType || "shape",
    shapeId: data.shapeId || "",
    text: data.textPreview || data.text || "",
    imageUrl: data.imageUrl || "",
    timestamp: ts,
    // Which canvas this happened on ("public" | "private") — older docs
    // logged before this field existed default to "public", matching the
    // app's original (pre-private-canvas) behavior. actorUid rides along
    // so a private-canvas view can further narrow to just its own owner's
    // entries, since the "actions" collection is shared across the whole
    // team, not scoped per private-canvas owner.
    space: data.space || "public",
    actorUid: data.actorUid || null,
    // Keep the raw createdAt if you ever want to sort locally:
    // createdAt: data.createdAt ?? null,
  };
}

/**
 * @typedef {Object} UseCanvasActionHistoryArgs
 * @property {string} className
 * @property {string} projectName
 * @property {string} teamName
 * @property {boolean} [enabled=true]
 * @property {number} [maxResults=150]
 */

/**
 * Firestore live action history stream for a team canvas.
 *
 * Performance note: onSnapshot fires on every write, but it doesn't hand
 * you a diff by default — snap.docs is the FULL current result set every
 * time. The naive `snap.docs.map(normalizeHistoryRow)` re-normalizes every
 * row on every single update, which gets expensive fast once the list is
 * a few hundred entries deep and someone's actively editing (each edit
 * re-triggers the listener). Firestore does expose the actual diff via
 * `snap.docChanges()`, with each change carrying `oldIndex`/`newIndex`
 * telling you exactly where to splice it into an ordered array mirror —
 * that's the pattern used below, so a single new/changed doc only costs
 * one normalize + one splice, not a full re-map of everything.
 *
 * @param {UseCanvasActionHistoryArgs} args
 */
export function useCanvasActionHistory({
  className,
  projectName,
  teamName,
  enabled = true,
  maxResults = 150,
}) {
  const [actionHistory, setActionHistory] = useState([]);

  // Keep for API compatibility (your app may call it).
  const fetchActionHistory = useCallback(async () => {
    // no-op (onSnapshot is the source of truth)
    return;
  }, []);

  const actionsRef = useMemo(() => {
    if (!className || !projectName || !teamName) return null;

    return collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "actions"
    );
  }, [className, projectName, teamName]);

  useEffect(() => {
    // If params are missing or hook disabled, clear and do nothing.
    // (Both public and private canvas now keep this enabled — see
    // CollaborativeWhiteboard — since HistoryPanel does its own
    // space/actorUid filtering on top of this shared stream.)
    if (!enabled || !actionsRef) {
      setActionHistory([]);
      return;
    }

    const q = query(
      actionsRef,
      orderBy("createdAt", "desc"),
      limit(maxResults)
    );

    const unsub = onSnapshot(
      q,
      (snap) => {
        setActionHistory((prev) => {
          // Mirror the query's ordered result set using Firestore's own
          // documented pattern: for each change, remove the doc from its
          // old position (if it had one) and insert it at its new one.
          // "added" has oldIndex === -1 (nothing to remove); "removed"
          // has newIndex === -1 (nothing to insert). This touches only
          // the docs that actually changed, not the whole array.
          const next = prev.slice();

          snap.docChanges().forEach((change) => {
            if (change.oldIndex !== -1) {
              next.splice(change.oldIndex, 1);
            }
            if (change.type !== "removed") {
              const row = normalizeHistoryRow(change.doc);
              const insertAt = Math.min(change.newIndex, next.length);
              next.splice(insertAt, 0, row);
            }
          });

          return next;
        });
      },
      (err) => {
        console.error("Error subscribing to action history:", err);
      }
    );

    return () => unsub();
  }, [enabled, actionsRef, maxResults]);

  /**
   * Optional optimistic append.
   * Dedupe by `id` to avoid duplicates when Firestore snapshot arrives.
   */
  const appendHistoryEntry = useCallback((entry) => {
    if (!entry) return;

    setActionHistory((prev) => {
      const id = entry.id;
      if (id && prev.some((x) => x.id === id)) return prev;
      return [entry, ...prev];
    });
  }, []);

  return {
    actionHistory,
    setActionHistory,
    fetchActionHistory,
    appendHistoryEntry,
  };
}
