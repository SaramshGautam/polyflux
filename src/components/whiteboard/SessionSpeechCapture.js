import React, { useEffect, useRef, useState, useCallback } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import { resolveMyActorId } from "../../utils/registershapes";
import "../navbar/Navbar.css";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

// Errors that mean the mic is fundamentally unusable right now — retrying
// won't help without the user doing something (granting permission,
// plugging in a device). onerror handles these by stopping outright
// instead of letting onend's auto-restart spin forever.
const FATAL_SPEECH_ERROR_CODES = new Set([
  "not-allowed",
  "service-not-allowed",
  "audio-capture",
]);

// How many consecutive *non-fatal* errors (no-speech, network, aborted,
// etc.) are tolerated before treating the stream as broken rather than
// just having a rough moment. Reset to 0 by any real onresult event, so a
// mic that's actually working never trips this even if it occasionally
// hiccups.
const MAX_CONSECUTIVE_SPEECH_ERRORS = 4;

// Small delay before onend's auto-restart, rather than restarting
// synchronously. Some errors (e.g. no-speech on a muted input) fire onend
// almost instantly — restarting in the same tick just spins in a tight
// loop without giving anything a chance to change.
const SPEECH_RESTART_BACKOFF_MS = 1000;

/**
 * Compact mic toggle meant to live inline inside the Navbar (navbar-right).
 * Click the mic to start/stop capture; a small popover under it shows
 * live status / interim text while listening.
 */
export default function SessionSpeechCapture({
  className,
  projectName,
  teamName,
}) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(!!SpeechRecognition);
  const [liveText, setLiveText] = useState("");
  const [showPanel, setShowPanel] = useState(false);
  // User-facing message for when capture has stopped (or never started)
  // because something is actually wrong — permission denied, no mic, or a
  // persistent error loop — as opposed to just being idle. Previously
  // there was no such state at all: onerror only logged to the console,
  // so the UI kept showing "Listening…" / the live-red dot indefinitely
  // even after recognition had permanently failed, and nothing was ever
  // captured from that point on without any visible sign something broke.
  const [captureError, setCaptureError] = useState(null);

  const recognitionRef = useRef(null);
  const shouldKeepListeningRef = useRef(false);
  const sessionStartedAtRef = useRef(null);
  const wrapperRef = useRef(null);
  const consecutiveErrorsRef = useRef(0);
  const restartTimeoutRef = useRef(null);

  const writeSpeechEvent = useCallback(
    async ({ text, startedAt, endedAt, isFinal = true }) => {
      const trimmed = String(text || "").trim();
      if (!trimmed) return;

      try {
        await addDoc(
          collection(
            db,
            "classrooms",
            className,
            "Projects",
            projectName,
            "teams",
            teamName,
            "speech_events"
          ),
          {
            type: "utterance",
            text: trimmed,
            // speakerId stays "unknown" — the Web Speech API doesn't do
            // real multi-speaker diarization, so there's no way to tell
            // WHO in the room said this from the audio itself. capturedBy
            // (whose browser/mic actually ran recognition) is the
            // meaningful identity here.
            speakerId: "unknown",
            speakerLabel: "Unknown speaker",
            // BUG FIX: this used to be its own displayName||email chain
            // (no uid fallback) — yet another variant of the identity
            // mismatch resolveMyActorId's doc comment describes. It
            // matters more here than most places: the backend now folds
            // speech utterances into the same participation/activity
            // accounting as canvas moves (see
            // phase_prediction_pipeline.py's speech_events_to_moves), so
            // this MUST resolve to the exact same string this person's
            // canvas actions are tagged with, or their spoken and
            // on-canvas contributions would silently count as two
            // different "people."
            capturedBy: resolveMyActorId(auth.currentUser),
            startedAt: startedAt || Date.now(),
            endedAt: endedAt || Date.now(),
            durationMs:
              startedAt && endedAt ? Math.max(0, endedAt - startedAt) : null,
            source: "browser_speech_recognition",
            isFinal,
            createdAt: serverTimestamp(),
          }
        );
      } catch (err) {
        console.error("[speech] failed to write speech event:", err);
      }
    },
    [className, projectName, teamName]
  );

  const startListening = useCallback(() => {
    if (!SpeechRecognition) {
      setSupported(false);
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let utteranceStartedAt = null;

    recognition.onstart = () => {};

    recognition.onresult = async (event) => {
      // Proof the stream is actually working — clears whatever error
      // streak had been building so a mic that occasionally hiccups but
      // is otherwise fine never trips the "stop and surface an error"
      // threshold below.
      consecutiveErrorsRef.current = 0;

      let interim = "";
      let finalText = "";

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const transcript = event.results[i][0]?.transcript || "";
        if (event.results[i].isFinal) {
          finalText += transcript + " ";
        } else {
          interim += transcript + " ";
        }
      }

      setLiveText(interim || finalText || "");

      if (!utteranceStartedAt) {
        utteranceStartedAt = Date.now();
      }

      if (finalText.trim()) {
        const endedAt = Date.now();

        await writeSpeechEvent({
          text: finalText.trim(),
          startedAt: utteranceStartedAt,
          endedAt,
          isFinal: true,
        });

        utteranceStartedAt = null;
        setLiveText("");
      }
    };

    recognition.onerror = (event) => {
      console.error("[speech] recognition error:", event.error);

      if (FATAL_SPEECH_ERROR_CODES.has(event.error)) {
        // Retrying won't fix a denied permission or a missing device —
        // stop outright instead of leaving onend's restart loop to spin
        // forever while the UI still claims "Listening…".
        shouldKeepListeningRef.current = false;
        if (restartTimeoutRef.current) {
          clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = null;
        }
        setIsListening(false);
        setLiveText("");
        setShowPanel(true); // surface it now — this stop wasn't user-initiated
        setCaptureError(
          event.error === "audio-capture"
            ? "No microphone found. Check your device, then click the mic to try again."
            : "Microphone access is blocked. Allow it in your browser's site settings, then click the mic to try again."
        );
        return;
      }

      // Transient errors (no-speech, network, aborted, etc.) — onend below
      // will attempt a restart on its own. Track how many of these happen
      // back-to-back with no successful result in between: a mic stuck in
      // a fail/restart loop (flaky hardware, dropped network) would
      // otherwise spin indefinitely while the UI still shows "Listening…"
      // with nothing actually being captured — exactly the silent-failure
      // case verbal_not_captured depends on this component not having.
      consecutiveErrorsRef.current += 1;
      if (consecutiveErrorsRef.current >= MAX_CONSECUTIVE_SPEECH_ERRORS) {
        shouldKeepListeningRef.current = false;
        if (restartTimeoutRef.current) {
          clearTimeout(restartTimeoutRef.current);
          restartTimeoutRef.current = null;
        }
        setIsListening(false);
        setLiveText("");
        setShowPanel(true);
        setCaptureError(
          "Conversation capture stopped unexpectedly. Click the mic to try again."
        );
      }
    };

    recognition.onend = () => {
      if (!shouldKeepListeningRef.current) return;

      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = setTimeout(() => {
        restartTimeoutRef.current = null;
        if (!shouldKeepListeningRef.current) return;
        try {
          recognition.start();
        } catch (err) {
          console.error("[speech] failed to restart recognition:", err);
        }
      }, SPEECH_RESTART_BACKOFF_MS);
    };

    recognitionRef.current = recognition;
    shouldKeepListeningRef.current = true;
    sessionStartedAtRef.current = Date.now();
    consecutiveErrorsRef.current = 0;
    setCaptureError(null);
    setIsListening(true);

    recognition.start();
  }, [writeSpeechEvent]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
    if (restartTimeoutRef.current) {
      clearTimeout(restartTimeoutRef.current);
      restartTimeoutRef.current = null;
    }
    setIsListening(false);
    setLiveText("");

    try {
      recognitionRef.current?.stop();
    } catch (err) {
      console.error("[speech] stop failed:", err);
    }
  }, []);

  const handleToggle = useCallback(() => {
    if (isListening) {
      stopListening();
    } else {
      startListening();
    }
    setShowPanel(true);
  }, [isListening, startListening, stopListening]);

  // Stop recognition on unmount
  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      if (restartTimeoutRef.current) clearTimeout(restartTimeoutRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  // Close the status popover when clicking outside of it
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setShowPanel(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  if (!supported) {
    return (
      <div
        className="navbar-mic"
        title="Conversation capture isn't supported in this browser"
      >
        <div
          className="navbar-mic-btn"
          style={{ opacity: 0.5, cursor: "default" }}
        >
          <i className="bi bi-mic-mute" />
        </div>
      </div>
    );
  }

  return (
    <div className="navbar-mic" ref={wrapperRef}>
      <button
        type="button"
        className={`navbar-mic-btn ${isListening ? "is-listening" : ""}`}
        onClick={handleToggle}
        title={
          captureError ||
          (isListening
            ? "Stop conversation capture"
            : "Start conversation capture")
        }
        aria-label={
          captureError ||
          (isListening
            ? "Stop conversation capture"
            : "Start conversation capture")
        }
        aria-pressed={isListening}
      >
        <i
          className={`bi ${isListening ? "bi-mic-fill" : "bi-mic"}`}
          // Same red used for "recording"/live-alert affordances elsewhere
          // in the app, repurposed here so a stopped-due-to-error state is
          // visually distinct from the plain idle "click to start" state
          // instead of looking identical to it.
          style={captureError ? { color: "#dc2626" } : undefined}
        />
        {isListening && <span className="navbar-mic-dot" />}
        {!isListening && captureError && (
          <span
            className="navbar-mic-dot"
            style={{ background: "#dc2626" }}
          />
        )}
      </button>

      {showPanel && (
        <div className="navbar-mic-panel">
          <div className="navbar-mic-panel-title">
            <i
              className={`bi ${
                captureError
                  ? "bi-exclamation-triangle-fill is-muted"
                  : isListening
                  ? "bi-record-circle is-live"
                  : "bi-mic-mute is-muted"
              }`}
              style={captureError ? { color: "#dc2626" } : undefined}
            />
            Conversation Capture
          </div>
          <div className="navbar-mic-status">
            {captureError
              ? captureError
              : isListening
              ? liveText
                ? `Hearing: ${liveText}`
                : "Listening…"
              : "Not listening"}
          </div>
        </div>
      )}
    </div>
  );
}
