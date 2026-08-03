import { useEffect, useRef, useCallback } from "react";
import { createProactiveNudgeEngine } from "./ProactiveNudgeEngine";

export function useProactiveNudges({
  editorRef,
  editorReady,
  enabled,

  analyzeFn,
  onResult,
  onError,

  idleDebounceMs,
  minGapMs,
  maxWaitMs,
  minEvents,
}) {
  const engineRef = useRef(null);

  // always-latest handlers
  const analyzeRef = useRef(analyzeFn);
  const onResultRef = useRef(onResult);
  const onErrorRef = useRef(onError);

  useEffect(() => {
    analyzeRef.current = analyzeFn;
  }, [analyzeFn]);

  useEffect(() => {
    onResultRef.current = onResult;
  }, [onResult]);

  useEffect(() => {
    onErrorRef.current = onError;
  }, [onError]);

  // create engine once, but route calls through refs
  if (!engineRef.current) {
    engineRef.current = createProactiveNudgeEngine({
      analyzeFn: async (args) => analyzeRef.current?.(args),
      onResult: (data) => onResultRef.current?.(data),
      onError: (err) => onErrorRef.current?.(err),

      enabled,
      idleDebounceMs,
      minGapMs,
      maxWaitMs,
      minEvents,
    });
  }

  // keep enabled in sync
  useEffect(() => {
    engineRef.current?.setEnabled?.(enabled);
  }, [enabled]);

  // attach listener whenever editor becomes ready/enabled
  useEffect(() => {
    if (!editorReady) return;
    if (!enabled) return;

    const editor = editorRef?.current;
    if (!editor?.store?.listen) return;

    // BUG FIX (user report): nudges were firing almost immediately after
    // opening the board, before the user had added anything themselves.
    // Cause — this listener had no filter, so it fired for EVERY store
    // change: the initial tldraw-sync hydration that loads all of a
    // team's existing shapes when the board first connects, AND every
    // teammate's remote edits too — not just this browser's own actions.
    //
    // tldraw's store.listen has TWO independent filter keys:
    //   - `source`: "user" | "remote" | "all" — local vs. synced changes
    //   - `scope`:  "document" | "session" | "presence" | "all" — which
    //     record *types* to include (shapes are "document"-scoped)
    // This previously passed `{ scope: "user" }`, which is not a valid
    // scope value. tldraw's internal dispatch only special-cases
    // "document" and "session"; anything else (including "user") falls
    // through to the "presence" branch, so this listener was silently
    // being fed ONLY presence-scoped changes (cursors/viewport) and
    // never shape/asset/binding records — meaning bumpActivity never
    // fired for real edits, so /analyze was never called at all
    // (confirmed via backend logs showing nothing after adding 6 items).
    // The fix is `{ source: "user" }`: this is the filter that actually
    // distinguishes local edits from remote/hydration ones; `scope`
    // stays at its default "all" so document (shape) changes pass through.
    const unlisten = editor.store.listen(
      (entry) => {
        const changes = entry?.changes;
        if (!changes) return;

        // tldraw gives { added: {id->rec}, updated: {...}, removed: {...} }
        const added = changes.added || {};
        const updated = changes.updated || {};
        const removed = changes.removed || {};

        const isMeaningfulId = (id) => {
          if (!id) return false;
          // keep only content-ish records
          return (
            id.startsWith("shape:") ||
            id.startsWith("asset:") ||
            id.startsWith("binding:")
          );
        };

        const countMeaningful = (obj) =>
          Object.keys(obj).filter(isMeaningfulId).length;

        const total =
          countMeaningful(added) +
          countMeaningful(updated) +
          countMeaningful(removed);

        if (!total) return;

        engineRef.current?.bumpActivity?.(total);
      },
      { source: "user" }
    );

    return () => {
      try {
        unlisten?.();
      } catch {}
    };
  }, [editorReady, enabled, editorRef]);

  // cleanup on unmount
  useEffect(() => {
    return () => engineRef.current?.stop?.();
  }, []);

  const requestAnalyze = useCallback((opts = "button") => {
    if (typeof opts === "string") {
      engineRef.current?.runAnalyze?.(opts);
      return;
    }
    const { source = "button" } = opts || {};
    engineRef.current?.runAnalyze?.(source);
  }, []);

  const bumpActivity = useCallback((count = 1) => {
    engineRef.current?.bumpActivity?.(Math.max(1, count));
  }, []);

  return { requestAnalyze, bumpActivity };
}
