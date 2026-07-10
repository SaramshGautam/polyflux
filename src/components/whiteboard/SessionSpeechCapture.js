import React, { useEffect, useRef, useState, useCallback } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
import { db, auth } from "../../firebaseConfig";
import "../navbar/Navbar.css";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

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

  const recognitionRef = useRef(null);
  const shouldKeepListeningRef = useRef(false);
  const sessionStartedAtRef = useRef(null);
  const wrapperRef = useRef(null);

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
            speakerId: "unknown",
            speakerLabel: "Unknown speaker",
            capturedBy:
              auth.currentUser?.displayName ||
              auth.currentUser?.email ||
              "anon",
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

    recognition.onstart = () => {
      console.log("[speech] recognition started");
    };

    recognition.onresult = async (event) => {
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
    };

    recognition.onend = () => {
      console.log("[speech] recognition ended");

      if (shouldKeepListeningRef.current) {
        try {
          recognition.start();
        } catch (err) {
          console.error("[speech] failed to restart recognition:", err);
        }
      }
    };

    recognitionRef.current = recognition;
    shouldKeepListeningRef.current = true;
    sessionStartedAtRef.current = Date.now();
    setIsListening(true);

    recognition.start();
  }, [writeSpeechEvent]);

  const stopListening = useCallback(() => {
    shouldKeepListeningRef.current = false;
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
          isListening
            ? "Stop conversation capture"
            : "Start conversation capture"
        }
        aria-label={
          isListening
            ? "Stop conversation capture"
            : "Start conversation capture"
        }
        aria-pressed={isListening}
      >
        <i className={`bi ${isListening ? "bi-mic-fill" : "bi-mic"}`} />
        {isListening && <span className="navbar-mic-dot" />}
      </button>

      {showPanel && (
        <div className="navbar-mic-panel">
          <div className="navbar-mic-panel-title">
            <i
              className={`bi ${
                isListening
                  ? "bi-record-circle is-live"
                  : "bi-mic-mute is-muted"
              }`}
            />
            Conversation Capture
          </div>
          <div className="navbar-mic-status">
            {isListening
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
