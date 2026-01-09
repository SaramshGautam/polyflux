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

  // ✅ always-latest handlers
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

  // ✅ create engine once, but route calls through refs
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

  // ✅ attach listener whenever editor becomes ready/enabled
  useEffect(() => {
    if (!editorReady) return;
    if (!enabled) return;

    const editor = editorRef?.current;
    if (!editor?.store?.listen) return;

    console.log("[Proactive] attaching store.listen", {
      editorReady,
      enabled,
      hasEditor: !!editor,
    });

    const unlisten = editor.store.listen(
      (entry) => {
        // console.log("[Proactive] listen fired raw entry:", entry);

        const changes = entry?.changes;
        if (!changes) return;

        // tldraw usually gives { added: {id->rec}, updated: {...}, removed: {...} }
        const added = changes.added || {};
        const updated = changes.updated || {};
        const removed = changes.removed || {};

        // const total =
        //   Object.keys(added).length +
        //   Object.keys(updated).length +
        //   Object.keys(removed).length;

        const isMeaningfulId = (id) => {
          if (!id) return false;
          // ✅ keep only content-ish records
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
      }
      // { scope: "user" }
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

  // const requestAnalyze = useCallback((opts = "button") => {
  //   if (typeof opts === "string") {
  //     // engineRef.current?.runAnalyze?.({ source: opts });
  //     engineRef.current?.runAnalyze?.(source);
  //     return;
  //   }
  //   const { source = "button", signal } = opts || {};
  //   engineRef.current?.runAnalyze?.({ source, signal });
  // }, []);

  const requestAnalyze = useCallback((opts = "button") => {
    if (typeof opts === "string") {
      engineRef.current?.runAnalyze?.(opts);
      return;
    }
    const { source = "button" } = opts || {};
    engineRef.current?.runAnalyze?.(source);
  }, []);

  return { requestAnalyze };
}
