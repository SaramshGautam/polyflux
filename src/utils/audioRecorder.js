// src/utils/audioRecorder.js

function pickSupportedMimeType() {
  if (typeof MediaRecorder === "undefined") return "";
  if (MediaRecorder.isTypeSupported("audio/webm")) return "audio/webm";
  if (MediaRecorder.isTypeSupported("audio/mp4")) return "audio/mp4";
  if (MediaRecorder.isTypeSupported("audio/ogg")) return "audio/ogg";
  return "";
}

/**
 * One-shot recorder: starts, auto-stops at maxDurationMs, resolves a Blob.
 * Usage: const blob = await recordOnce(15000)
 */
export async function recordOnce(maxDurationMs = 15000, getUserMediaOpts) {
  let stream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
        ...(getUserMediaOpts?.audio || {}),
      },
      ...(getUserMediaOpts || {}),
    });
  } catch (err) {
    throw err;
  }

  const mimeType = pickSupportedMimeType();
  const mediaRecorder = new MediaRecorder(stream, {
    mimeType: mimeType || undefined,
  });

  const chunks = [];
  return new Promise((resolve, reject) => {
    let timeoutId;

    const cleanup = () => {
      clearTimeout(timeoutId);
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {}
      mediaRecorder.removeEventListener("dataavailable", onData);
      mediaRecorder.removeEventListener("stop", onStop);
      mediaRecorder.removeEventListener("error", onError);
    };

    function onData(e) {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    }

    function onStop() {
      cleanup();
      const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
      resolve(blob);
    }

    function onError(e) {
      cleanup();
      reject(e.error || e);
    }

    mediaRecorder.addEventListener("dataavailable", onData);
    mediaRecorder.addEventListener("stop", onStop);
    mediaRecorder.addEventListener("error", onError);

    // start and auto-stop
    mediaRecorder.start(1000);
    timeoutId = setTimeout(() => {
      if (mediaRecorder.state === "recording") mediaRecorder.stop();
    }, maxDurationMs);
  });
}

/**
 * Toggle-style recorder: call start() to begin and stop() to end early.
 * Gives you elapsed callbacks and still enforces a max cap.
 *
 * Usage:
 *   const rec = await createToggleRecorder({ maxDurationMs: 15000, onElapsed: (ms)=>{} })
 *   await rec.start();
 *   // later...
 *   const blob = await rec.stop(); // resolves Blob
 */
export async function createToggleRecorder({
  maxDurationMs = 15000,
  onElapsed, // optional (ms => void)
  getUserMediaOpts,
} = {}) {
  let stream = null;
  let mediaRecorder = null;
  let chunks = [];
  let intervalId = null;
  let timeoutId = null;
  let startTs = null;
  const mimeType = pickSupportedMimeType();

  async function start() {
    if (mediaRecorder && mediaRecorder.state === "recording") {
      throw new Error("Already recording");
    }
    chunks = [];
    stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
        ...(getUserMediaOpts?.audio || {}),
      },
      ...(getUserMediaOpts || {}),
    });

    mediaRecorder = new MediaRecorder(stream, {
      mimeType: mimeType || undefined,
    });
    mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunks.push(e.data);
    };

    startTs = Date.now();
    if (onElapsed) {
      intervalId = setInterval(() => onElapsed(Date.now() - startTs), 200);
    }

    return new Promise((resolve, reject) => {
      mediaRecorder.onerror = (e) => {
        cleanup();
        reject(e.error || e);
      };
      mediaRecorder.onstop = () => resolve(true);

      mediaRecorder.start(1000);
      timeoutId = setTimeout(() => {
        if (mediaRecorder?.state === "recording") mediaRecorder.stop();
      }, maxDurationMs);
    });
  }

  async function stop() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
      throw new Error("Not recording");
    }
    return new Promise((resolve) => {
      mediaRecorder.onstop = () => {
        const blob = new Blob(chunks, { type: mimeType || "audio/webm" });
        cleanup();
        resolve(blob);
      };
      mediaRecorder.stop();
    });
  }

  function cleanup() {
    clearTimeout(timeoutId);
    clearInterval(intervalId);
    try {
      stream?.getTracks()?.forEach((t) => t.stop());
    } catch {}
    stream = null;
    mediaRecorder = null;
    intervalId = null;
    timeoutId = null;
    startTs = null;
  }

  return { start, stop };
}
