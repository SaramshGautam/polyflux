// src/history/useCanvasActionHistory.js
import { useEffect, useState, useCallback } from "react";
import {
  collection,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { db } from "../firebaseConfig";

export function normalizeHistoryTimestamp(rawTs) {
  if (!rawTs) return null;
  if (rawTs.toDate) return rawTs.toDate().toISOString();
  if (typeof rawTs === "string") return rawTs;
  if (rawTs instanceof Date) return rawTs.toISOString();
  return null;
}

export function useCanvasActionHistory({ className, projectName, teamName }) {
  const [actionHistory, setActionHistory] = useState([]);

  // Optional: keep a manual refresh function (now it just relies on live stream)
  const fetchActionHistory = useCallback(async () => {
    // no-op when using onSnapshot (kept for API compatibility)
    return;
  }, []);

  useEffect(() => {
    if (!className || !projectName || !teamName) return;

    const actionsRef = collection(
      db,
      "classrooms",
      className,
      "Projects",
      projectName,
      "teams",
      teamName,
      "actions"
    );

    const q = query(actionsRef, orderBy("createdAt", "desc"), limit(300));

    const unsub = onSnapshot(
      q,
      (snap) => {
        const rows = snap.docs.map((docSnap) => {
          const data = docSnap.data();

          const ts = normalizeHistoryTimestamp(data.createdAt);

          return {
            id: docSnap.id,
            userId: data.actorId || data.userId || "Unknown User",
            verb: data.verb || data.action || "updated",
            action: data.verb || data.action || "updated", // backward compat
            shapeType: data.shapeType || "shape",
            shapeId: data.shapeId || "",
            text: data.textPreview || data.text || "",
            imageUrl: data.imageUrl || "",
            timestamp: ts,
          };
        });

        setActionHistory(rows);
      },
      (err) => {
        console.error("❌ Error subscribing to action history:", err);
      }
    );

    return () => unsub();
  }, [className, projectName, teamName]);

  // If you do Firestore subscription, you generally should NOT optimistic-append
  // (otherwise you’ll see duplicates).
  const appendHistoryEntry = useCallback((entry) => {
    // optional: keep disabled or dedupe by id if you really want optimistic updates
    setActionHistory((prev) => [entry, ...prev]);
  }, []);

  return {
    actionHistory,
    setActionHistory,
    fetchActionHistory,
    appendHistoryEntry,
  };
}
