const DEBUG_PROACTIVE = true;

export function createProactiveNudgeEngine({
  analyzeFn, // async ({ source }) => result
  onResult, // (result) => void
  onError, // (err) => void

  enabled = true,

  idleDebounceMs = 1200, // wait for pause before analyze
  minGapMs = 8000, // hard throttle between calls
  maxWaitMs = 15000, // ensure we run if user keeps editing
  minEvents = 4, // require some activity
} = {}) {
  // ---- internal state (no React state here) ----
  let activityCount = 0;
  let lastAnalyzeAt = 0;

  let inFlight = false;
  let pending = false;

  let debounceTimer = null;
  let maxWaitTimer = null;

  let abortController = null;

  function clearTimers() {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    if (maxWaitTimer) {
      clearTimeout(maxWaitTimer);
      maxWaitTimer = null;
    }
  }

  function stop() {
    clearTimers();
    enabled = false;
    if (abortController) {
      try {
        abortController.abort();
      } catch {}
      abortController = null;
    }
  }

  function setEnabled(next) {
    enabled = !!next;
    if (!enabled) stop();
  }

  function bumpActivity(delta = 1) {
    if (!enabled) return;
    activityCount += Math.max(0, delta);
    scheduleAnalyze("activity");
  }

  async function runAnalyze(source = "proactive") {
    console.log("[Proactive][runAnalyze] called", {
      source,
      enabled,
      inFlight,
      pending,
      activityCount,
      sinceLastMs: Date.now() - lastAnalyzeAt,
      ts: new Date().toISOString(),
    });

    if (!enabled) return;
    clearTimers();
    const now = Date.now();

    if (inFlight) {
      pending = true;
      return;
    }

    if (now - lastAnalyzeAt < minGapMs) return;
    if (activityCount < minEvents && source !== "button") return;
    // if (activityCount < minEvents) return;

    inFlight = true;
    pending = false;

    lastAnalyzeAt = now;
    activityCount = 0;

    // abort previous
    if (abortController) {
      try {
        abortController.abort();
      } catch {}
    }
    abortController = new AbortController();

    try {
      if (DEBUG_PROACTIVE)
        console.log("[Proactive][runAnalyze] sending /analyze", { source });
      const result = await analyzeFn({
        source,
        signal: abortController.signal,
      });
      if (result) onResult?.(result);
      if (DEBUG_PROACTIVE)
        console.log("[Proactive][runAnalyze] got result", result);
    } catch (err) {
      if (err?.name === "AbortError") return;
      onError?.(err);
      if (DEBUG_PROACTIVE) console.log("[Proactive][runAnalyze] error", err);
    } finally {
      inFlight = false;

      // If changes happened mid-flight, try again using scheduler
      if (pending) {
        pending = false;
        scheduleAnalyze("trailing");
      }
    }
  }

  function scheduleAnalyze(reason = "activity") {
    if (!enabled) return;

    // debounce on pause
    if (debounceTimer) clearTimeout(debounceTimer);
    if (DEBUG_PROACTIVE) {
      console.log("[Proactive][schedule] debounce scheduled", {
        reason,
        idleDebounceMs,
        maxWaitMs,
        activityCount,
        ts: new Date().toISOString(),
      });
    }

    debounceTimer = setTimeout(() => {
      if (DEBUG_PROACTIVE) console.log("[Proactive][schedule] debounce fired");

      runAnalyze("proactive");
    }, idleDebounceMs);

    // max wait: if user keeps editing, still run eventually
    if (!maxWaitTimer) {
      if (DEBUG_PROACTIVE)
        console.log("[Proactive][schedule] maxWait scheduled");
      maxWaitTimer = setTimeout(() => {
        if (DEBUG_PROACTIVE) console.log("[Proactive][schedule] maxWait fired");
        runAnalyze("proactive");
        if (maxWaitTimer) {
          clearTimeout(maxWaitTimer);
          maxWaitTimer = null;
        }
      }, maxWaitMs);
    }
  }

  // expose a minimal API
  return {
    bumpActivity,
    runAnalyze, // allow manual "button" analyze from parent
    scheduleAnalyze,
    stop,
    setEnabled,
    clearTimers,
  };
}
