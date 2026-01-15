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
 * @property {number} [maxResults=300]
 */

/**
 * Firestore live action history stream for a team canvas.
 * @param {UseCanvasActionHistoryArgs} args
 */
export function useCanvasActionHistory({
  className,
  projectName,
  teamName,
  enabled = true,
  maxResults = 300,
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
        const rows = snap.docs.map(normalizeHistoryRow);

        // If you ever see weird ordering due to missing createdAt,
        // you can optionally enforce sorting here using timestamp.
        // rows.sort((a, b) => (b.timestamp || "").localeCompare(a.timestamp || ""));

        setActionHistory(rows);
      },
      (err) => {
        console.error("❌ Error subscribing to action history:", err);
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
