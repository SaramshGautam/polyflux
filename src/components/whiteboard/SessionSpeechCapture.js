import React, { useEffect, useRef, useState, useCallback } from "react";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
// import { db, auth } from "../../firebaseConfig";
import { db, auth } from "../../firebaseConfig";

const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition;

export default function SessionSpeechCapture({
  className,
  projectName,
  teamName,
}) {
  const [isListening, setIsListening] = useState(false);
  const [supported, setSupported] = useState(!!SpeechRecognition);
  const [liveText, setLiveText] = useState("");

  const recognitionRef = useRef(null);
  const shouldKeepListeningRef = useRef(false);
  const sessionStartedAtRef = useRef(null);

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

  useEffect(() => {
    return () => {
      shouldKeepListeningRef.current = false;
      try {
        recognitionRef.current?.stop();
      } catch {}
    };
  }, []);

  if (!supported) {
    return (
      <div
        style={{
          position: "fixed",
          top: 72,
          right: 20,
          zIndex: 10095,
          background: "#fff3cd",
          color: "#664d03",
          border: "1px solid #ffecb5",
          borderRadius: 8,
          padding: "8px 12px",
          fontSize: 13,
        }}
      >
        Speech capture not supported in this browser.
      </div>
    );
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 72,
        right: 20,
        zIndex: 10095,
        background: "white",
        border: "1px solid #ddd",
        borderRadius: 10,
        padding: "10px 12px",
        boxShadow: "0 6px 18px rgba(0,0,0,0.12)",
        minWidth: 220,
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 700,
          marginBottom: 8,
        }}
      >
        Conversation Capture
      </div>

      <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
        {!isListening ? (
          <button
            type="button"
            onClick={startListening}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "8px 10px",
              background: "#198754",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Start Listening
          </button>
        ) : (
          <button
            type="button"
            onClick={stopListening}
            style={{
              border: "none",
              borderRadius: 8,
              padding: "8px 10px",
              background: "#dc3545",
              color: "white",
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            Stop Listening
          </button>
        )}
      </div>

      <div
        style={{
          fontSize: 12,
          color: "#666",
          minHeight: 18,
          lineHeight: 1.4,
        }}
      >
        {isListening
          ? liveText
            ? `Hearing: ${liveText}`
            : "Listening..."
          : "Not listening"}
      </div>
    </div>
  );
}
