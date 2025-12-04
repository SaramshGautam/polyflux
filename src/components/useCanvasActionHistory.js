// // src/history/useCanvasActionHistory.js
// import { useEffect, useState, useCallback } from "react";
// import { collection, getDocs, orderBy, query } from "firebase/firestore";
// import { db } from "../firebaseConfig";

// // ─────────────────────────────────────────────────────────────
// // Helpers for formatting entries (pure, UI-agnostic)
// // ─────────────────────────────────────────────────────────────

// export function normalizeHistoryTimestamp(rawTs) {
//   if (!rawTs) return null;

//   // Firestore Timestamp
//   if (rawTs.toDate) {
//     return rawTs.toDate().toISOString();
//   }

//   // ISO string or Date
//   if (typeof rawTs === "string") {
//     return rawTs;
//   }
//   if (rawTs instanceof Date) {
//     return rawTs.toISOString();
//   }

//   // Fallback: unknown
//   return null;
// }

// /**
//  * Shape of a canonical history entry we expect:
//  * {
//  *   userId: string
//  *   verb: "added" | "updated" | "deleted"
//  *   shapeType: string
//  *   shapeId: string
//  *   text?: string
//  *   imageUrl?: string
//  *   timestamp: string (ISO) | null
//  * }
//  */

// // ─────────────────────────────────────────────────────────────
// // Hook: owns actionHistory + initial Firestore load
// // ─────────────────────────────────────────────────────────────

// export function useCanvasActionHistory({ className, projectName, teamName }) {
//   const [actionHistory, setActionHistory] = useState([]);

//   // Fetch full history once on startup / context change
//   const fetchActionHistory = useCallback(async () => {
//     if (!className || !projectName || !teamName) return;

//     try {
//       const historyRef = collection(
//         db,
//         "classrooms",
//         className,
//         "Projects",
//         projectName,
//         "teams",
//         teamName,
//         "history"
//       );

//       const q = query(historyRef, orderBy("timestamp", "desc"));
//       const snapshot = await getDocs(q);

//       const entries = snapshot.docs.map((docSnap) => {
//         const data = docSnap.data();
//         return {
//           id: docSnap.id,
//           ...data,
//           timestamp: normalizeHistoryTimestamp(data.timestamp),
//         };
//       });

//       setActionHistory(entries);
//     } catch (err) {
//       console.error("❌ Error fetching action history:", err);
//     }
//   }, [className, projectName, teamName]);

//   useEffect(() => {
//     // whenever we change canvas context, reload history
//     fetchActionHistory();
//   }, [fetchActionHistory]);

//   // Local append helper (for optimistic updates if you want)
//   const appendHistoryEntry = useCallback((entry) => {
//     setActionHistory((prev) => [entry, ...prev]);
//   }, []);

//   return {
//     actionHistory,
//     setActionHistory, // exposed in case you need to massage in UI/debug tools
//     fetchActionHistory, // reusable by toolbar, etc.
//     appendHistoryEntry, // optional optimistic appends
//   };
// }

// src/history/useCanvasActionHistory.js
import { useEffect, useState, useCallback } from "react";
import { collection, getDocs, orderBy, query } from "firebase/firestore";
import { db } from "../firebaseConfig";

// ─────────────────────────────────────────────────────────────
// Helpers for formatting entries (pure, UI-agnostic)
// ─────────────────────────────────────────────────────────────

export function normalizeHistoryTimestamp(rawTs) {
  if (!rawTs) return null;

  // Firestore Timestamp
  if (rawTs.toDate) {
    return rawTs.toDate().toISOString();
  }

  // ISO string or Date
  if (typeof rawTs === "string") {
    return rawTs;
  }
  if (rawTs instanceof Date) {
    return rawTs.toISOString();
  }

  // Fallback: unknown
  return null;
}

/**
 * Canonical history entry:
 * {
 *   id: string           // doc id
 *   userId: string
 *   verb: "added" | "updated" | "deleted"
 *   action: string       // same as verb, for backward compat
 *   shapeType: string
 *   shapeId: string
 *   text?: string
 *   imageUrl?: string
 *   timestamp: string | null   // ISO
 * }
 */

// ─────────────────────────────────────────────────────────────
// Hook: build action history from shapes collection
// ─────────────────────────────────────────────────────────────

export function useCanvasActionHistory({ className, projectName, teamName }) {
  const [actionHistory, setActionHistory] = useState([]);

  // Fetch from /shapes once on startup / context change
  const fetchActionHistory = useCallback(async () => {
    if (!className || !projectName || !teamName) return;

    try {
      const shapesRef = collection(
        db,
        "classrooms",
        className,
        "Projects",
        projectName,
        "teams",
        teamName,
        "shapes"
      );

      // order by createdAt so newest are first in the UI
      const q = query(shapesRef, orderBy("createdAt", "desc"));
      const snapshot = await getDocs(q);

      const entries = snapshot.docs.map((docSnap) => {
        const data = docSnap.data();

        // pick createdAt first, fall back to updatedAt
        const ts = normalizeHistoryTimestamp(
          data.createdAt || data.updatedAt || null
        );

        const userId = data.createdBy || data.userId || "Unknown User"; // screenshots show createdBy

        const shapeType = data.shapeType || "shape";
        const shapeId = data.shapeId || docSnap.id;

        const text = data.text || "";
        const imageUrl = data.url || "";

        // for now, everything in shapes is treated as "added"
        const verb = "added";

        const entry = {
          id: docSnap.id,
          userId,
          verb,
          action: verb, // keep both for existing UI that reads `entry.action`
          shapeType,
          shapeId,
          text,
          imageUrl,
          timestamp: ts,
        };

        // Debug log so you can see exactly what we have
        console.log("[History] synthesized entry from shape:", entry);
        return entry;
      });

      setActionHistory(entries);
    } catch (err) {
      console.error("❌ Error fetching action history from shapes:", err);
    }
  }, [className, projectName, teamName]);

  useEffect(() => {
    fetchActionHistory();
  }, [fetchActionHistory]);

  // Local append helper (if you later want optimistic updates)
  const appendHistoryEntry = useCallback((entry) => {
    setActionHistory((prev) => [entry, ...prev]);
  }, []);

  return {
    actionHistory,
    setActionHistory, // still exposed if you need to tweak
    fetchActionHistory, // can be called from toolbar etc.
    appendHistoryEntry,
  };
}
