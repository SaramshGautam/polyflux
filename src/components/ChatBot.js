import React, { useState, useEffect, useRef } from "react";
import "./ChatBot.css";
import { formatBotReply } from "../utils/formatBotReply";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Draggable from "react-draggable";
import { storage } from "../firebaseConfig";
import { ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { getAuth, signInAnonymously } from "firebase/auth";
import { Rnd } from "react-rnd";
import {
  faRobot,
  faArrowsUpDownLeftRight,
  faCopy,
  faXmarkCircle,
  faPlusCircle,
  faClockRotateLeft,
  faBolt,
} from "@fortawesome/free-solid-svg-icons";

const buildHistoryForBackend = (msgs) => {
  const last = msgs.slice(-10); // last 10 turns
  return last.map((m) => ({
    role: m.sender === "user" ? "user" : "assistant",
    content: m.text || "",
  }));
};

// Handles both raw base64 and full data URLs
const normalizeB64 = (s) => {
  if (!s) return { b64: "", contentType: "image/png" };
  const m = /^data:(image\/[a-z0-9+.-]+);base64,(.*)$/i.exec(s);
  if (m) return { contentType: m[1], b64: m[2] };
  return { contentType: "image/png", b64: s }; // raw base64 fallback
};

function b64ToBlob(b64, mime = "image/png") {
  const byteChars = atob(b64); // b64 is raw base64, not data URL
  const byteNums = new Array(byteChars.length);
  for (let i = 0; i < byteChars.length; i++)
    byteNums[i] = byteChars.charCodeAt(i);
  const byteArray = new Uint8Array(byteNums);
  return new Blob([byteArray], { type: mime });
}

const safe = (s = "") => s.replace(/[^\w.@-]/g, "_");

async function uploadB64ToFirebase({
  storage,
  canvasId,
  // user_id,
  b64,
  idx = 0,
}) {
  const auth = getAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const uid = auth.currentUser?.uid || "anon";

  const ts = Date.now();
  // const uidSafe = (user_id || "anon").replace(/[^\w.@-]/g, "_");
  const canvasSafe = (canvasId || "canvas").replace(/[^\w.@-]/g, "_");
  // const path = `generated/${canvasSafe}/${uidSafe}/${ts}-${idx}.png`;
  const path = `generated/${canvasSafe}/${uid}/${ts}-${idx}.png`;

  const blob = b64ToBlob(b64, "image/png");
  const ref = sRef(storage, path);

  await uploadBytes(ref, blob, {
    contentType: "image/png",
    cacheControl: "public, max-age=31536000, immutable",
    customMetadata: {
      source: "chatbot",
      canvasId,
      // user_id,
      createdAt: new Date(ts).toISOString(),
    },
  });

  return await getDownloadURL(ref);
}

async function uploadManyB64ToFirebase(images_b64, ctx) {
  const tasks = images_b64.map((b64, i) =>
    uploadB64ToFirebase({ ...ctx, b64, idx: i })
  );
  return Promise.all(tasks);
}

// ---- Image mirroring helpers ----

// Use your existing proxy so we always get readable bytes (no opaque responses)
const IMAGE_PROXY_URL =
  "https://flask-app-jqwkqdscaq-uc.a.run.app/proxy-image?url=";

const filenameFromUrl = (url, fallback = "image.png") => {
  try {
    const u = new URL(url);
    const last = u.pathname.split("/").pop() || fallback;
    return decodeURIComponent(last.split("?")[0]);
  } catch {
    return fallback;
  }
};

const guessContentType = (filename, fallback = "image/png") => {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".gif")) return "image/gif";
  if (lower.endsWith(".svg")) return "image/svg+xml";
  return fallback;
};

// cache so we don’t re-upload the same source URL in one session
const mirroredCache = new Map();

/**
 * Fetch srcUrl (via proxy), upload to Firebase Storage, return downloadURL.
 * Requires `storage` import from your firebaseConfig (you already have it).
 */
async function mirrorImageToFirebase(srcUrl, { canvasId, user_id }) {
  if (mirroredCache.has(srcUrl)) return mirroredCache.get(srcUrl);

  // 1) get bytes through proxy (adds permissive CORS and streams bytes)
  const proxied = IMAGE_PROXY_URL + encodeURIComponent(srcUrl);
  const res = await fetch(proxied);
  if (!res.ok) throw new Error(`Proxy fetch failed: ${res.status}`);
  const blob = await res.blob();

  // 2) choose a filename + path
  const baseName = filenameFromUrl(srcUrl);
  const contentType = blob.type || guessContentType(baseName);
  const ts = Date.now();
  const uidSafe = user_id?.replace?.(/[^\w.@-]/g, "_") || "anon";
  const canvasSafe = (canvasId || "canvas").replace(/[^\w.@-]/g, "_");
  const path = `generated/${canvasSafe}/${uidSafe}/${ts}-${baseName}`;

  // 3) upload
  const {
    ref: sRef,
    uploadBytes,
    getDownloadURL,
  } = await import("firebase/storage"); // already imported higher; left for clarity
  const r = sRef(storage, path);
  await uploadBytes(r, blob, {
    contentType,
    customMetadata: {
      originalUrl: srcUrl,
      mirroredAt: new Date(ts).toISOString(),
    },
    cacheControl: "public, max-age=31536000, immutable",
  });

  // 4) get durable URL
  const downloadUrl = await getDownloadURL(r);
  mirroredCache.set(srcUrl, downloadUrl);
  return downloadUrl;
}

async function mirrorAllImagesToFirebase(urls, ctx) {
  const tasks = urls.map((u) =>
    mirrorImageToFirebase(u, ctx).catch((e) => {
      console.error("Mirror failed for", u, e);
      // fall back to original URL so UI still shows something
      return u;
    })
  );
  return Promise.all(tasks);
}

const ChatBot = ({
  messages,
  setMessages,
  toggleSidebar,
  externalMessages = [],
  canvasId,
  role,
  user_id,
  targets,
  params,
  shapes,
  onNudgeComputed,
  nudgeFocusShapeId,
  onNudgeFocusComputed,
  variant = "floating",
}) => {
  const [userInput, setUserInput] = useState("");
  const [isOpen, setIsOpen] = useState(variant === "floating");
  const [loading, setLoading] = useState(false);
  const [clipNotes, setClipNotes] = useState([]);
  const [isSelectingFromCanvas, setIsSelectingFromCanvas] = useState(false);
  const [position, setPosition] = useState({
    x: window.innerWidth - 400 - 20,
    y: window.innerHeight - 540 - 20,
  });
  const [copiedKey, setCopiedKey] = useState(null);
  const [nudgesLoading, setNudgesLoading] = useState(false);

  const nudgeScrollRef = useRef(null);

  useEffect(() => {
    if (variant === "sidebar") {
      setIsOpen(true);
    }
  }, [variant]);

  useEffect(() => {
    if (!nudgeFocusShapeId) return;

    setIsOpen(true);

    const id = setTimeout(() => {
      if (nudgeScrollRef.current) {
        nudgeScrollRef.current.scrollIntoView({
          behavior: "smooth",
          block: "center",
        });
      }
      if (onNudgeFocusComputed) onNudgeFocusComputed();
    }, 100);

    return () => clearTimeout(id);
  }, [nudgeFocusShapeId, onNudgeFocusComputed]);

  useEffect(() => {
    const handleAddClip = (e) => {
      const detail = e.detail || {};
      const clips = Array.isArray(detail.clips) ? detail.clips : [];
      if (!clips.length) return;

      setClipNotes((prev) => {
        const existing = new Set(prev.map((c) => c.id));
        const merged = [...prev];
        clips.forEach((c) => {
          if (!c?.id) return;
          if (!existing.has(c.id)) {
            merged.push(c);
            existing.add(c.id);
          }
        });
        return merged;
      });
    };

    window.addEventListener("chatbot-add-clip", handleAddClip);
    return () => window.removeEventListener("chatbot-add-clip", handleAddClip);
  }, []);

  useEffect(() => {
    if (externalMessages && externalMessages.length > 0) {
      setIsOpen(true);
      setMessages((prev) => [...prev, ...externalMessages]);
    }
  }, [externalMessages, setMessages]);

  useEffect(() => {
    const handleExternalTrigger = (e) => {
      const detail = e.detail || {};
      const { snippet, source, position, meta } = detail;

      setIsOpen(true);

      if (position) {
        setPosition({
          x: position.x,
          y: position.y,
        });
      }

      // Build clip notes:
      // 1) If we have a structured multi-selection in meta.selection,
      //    create one clip per selected item.
      // 2) Otherwise, fall back to a single "summary" clip from snippet.
      setClipNotes((prev) => {
        const next = [...prev];

        if (meta?.selection && Array.isArray(meta.selection)) {
          meta.selection.forEach((item) => {
            const text =
              item.text ||
              item.label ||
              (typeof item === "string" ? item : "") ||
              "";

            console.log("[Chatbot] meta.selection item:", item);

            next.push({
              id: item.id,
              snip:
                item.type === "image"
                  ? item.url ||
                    item.imageUrl ||
                    item.src ||
                    item.downloadUrl ||
                    ""
                  : text,
              kind: item.type, // "note", "text", "image", etc.
            });
          });
        } else if (snippet) {
          next.push({
            id: source,
            snip: snippet,
            kind: "summary",
          });
        }

        return next;
      });

      // Optional: drop an auto-message summarizing what we captured
      if (snippet) {
        const note = `💡 Selection sent to AI:\n${snippet}`;
        setMessages((prev) => [...prev, { sender: "bot", text: note }]);
      }
    };

    window.addEventListener("trigger-chatbot", handleExternalTrigger);
    return () => {
      window.removeEventListener("trigger-chatbot", handleExternalTrigger);
    };
  }, [setMessages]);

  // const handleChipClick = async (chip, roleType, nudgeMsg) => {
  //   // setUserInput(chip);
  //   // console.log("Chip clicked:", chip);
  //   console.log("Sending /act payload:", {
  //     chip,
  //     canvas_id: canvasId,
  //     role: roleType || "catalyst",
  //     user_id,
  //     targets: targets,
  //     params,
  //   });
  //   // setLoading(true);

  //   const newMessages = [
  //     ...messages,
  //     { sender: "user", text: chip },
  //     { sender: "bot", text: `🔧 Running action: ${chip}` },
  //   ];
  //   setMessages(newMessages);

  //   try {
  //     // const response = await fetch("http://localhost:8080/act", {
  //     const response = await fetch(
  //       "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/act",
  //       {
  //         method: "POST",
  //         headers: { "Content-Type": "application/json" },
  //         body: JSON.stringify({
  //           chip: chip,
  //           canvas_id: canvasId,
  //           role: roleType || "catalyst",
  //           user_id: user_id,
  //           targets: targets || [],
  //           params: params || {},
  //         }),
  //       }
  //     );

  //     const data = await response.json();
  //     // const botReply = data.message || "Action completed.";
  //     // const botReply = data.result || "Action completed.";
  //     console.log(`---data---`, data);
  //     if (data.error) {
  //       setMessages([
  //         ...newMessages,
  //         { sender: "bot", text: `⚠️ Action error: ${data.error}` },
  //       ]);
  //       return;
  //     }
  //     const result = data.result ?? data;
  //     // const botReply = result.outputs.content;
  //     // setMessages([...newMessages, { sender: "bot", text: botReply }]);
  //     console.log("Action response:", result);
  //     // console.log("Action response:", botReply);

  //     // const reply = summarizeActResult(result, {
  //     //   chip: result.chip,
  //     //   role: result.role,
  //     // });

  //     const maybeImages =
  //       result?.image_urls ||
  //       result?.created_shapes
  //         ?.filter((s) => s.type === "image" && s.imageUrl)
  //         .map((s) => s.imageUrl) ||
  //       [];

  //     let firebaseUrls = null;
  //     if (maybeImages.length) {
  //       try {
  //         firebaseUrls = await mirrorAllImagesToFirebase(maybeImages, {
  //           canvasId,
  //           user_id,
  //         });
  //       } catch (e) {
  //         console.error("Mirroring images (chip) failed:", e);
  //         firebaseUrls = maybeImages;
  //       }
  //     }

  //     console.log(`Bot Reply (raw):`, result?.output?.[0]?.content);

  //     const botReply = formatBotReply(
  //       // result?.outputs?.[0]?.content ?? "Action completed."
  //       result?.outputs?.find((o) => o?.type === "summary")?.content ??
  //         result?.output?.[0]?.content ??
  //         "Action completed."
  //     );
  //     // const images = extractImageUrls(result);
  //     console.log("Action reply:", botReply);

  //     setMessages([
  //       ...newMessages,
  //       {
  //         sender: "bot",
  //         text: botReply,
  //         type: roleType,
  //         // chips: result.chip || [],
  //         // image_urls: extractImageUrls(result),
  //         image_urls: firebaseUrls,
  //       },
  //     ]);
  //   } catch (error) {
  //     console.error(error);
  //     const botReply = "Error executing action.";
  //     console.log("Action error:", botReply);
  //   } finally {
  //     setLoading(false);
  //   }
  // };

  const handleChipClick = async (chip, roleType, nudgeMsg) => {
    console.log("Chip clicked with nudgeMsg:", { chip, roleType, nudgeMsg });

    // --- 1. Build context from the nudge meta + tail shapes ---
    let nudgeContext = {};
    try {
      const meta = nudgeMsg?.meta || {};
      const tailShapeIds = Array.isArray(meta.tailShapeIds)
        ? meta.tailShapeIds
        : [];

      // Helper extractors so we work with both Firestore + tldraw shapes
      const extractShapeText = (shape) =>
        shape?.text ||
        shape?.label ||
        shape?.content ||
        shape?.props?.text ||
        shape?.props?.label ||
        "";

      const extractShapeImage = (shape) =>
        shape?.imageUrl ||
        shape?.url ||
        shape?.props?.url ||
        (shape?.props?.assetId ? `asset:${shape.props.assetId}` : null);

      let textSnips = [];
      let imageUrls = [];

      if (tailShapeIds.length && Array.isArray(shapes)) {
        const tailSet = new Set(tailShapeIds);

        const tailShapes = shapes.filter((s) => s && s.id && tailSet.has(s.id));

        tailShapes.forEach((s) => {
          const t = extractShapeText(s);
          const img = extractShapeImage(s);

          if (t && t.trim()) textSnips.push(t.trim());
          if (img) imageUrls.push(img);
        });
      }

      // de-dupe
      const dedupe = (arr) => [...new Set(arr)];

      nudgeContext = {
        phase: meta.phase || null,
        triggerId: meta.triggerId || null,
        windowIds: meta.windowIds || [],
        tailShapeIds,
        text_snippets: dedupe(textSnips),
        image_urls: dedupe(imageUrls),
        source: meta.source || "phase_nudge",
      };
    } catch (e) {
      console.error("Failed to build nudgeContext:", e);
      nudgeContext = { error: "context_build_failed" };
    }

    console.log("Sending /act payload:", {
      chip,
      canvas_id: canvasId,
      role: roleType || "catalyst",
      user_id,
      targets,
      params: {
        ...(params || {}),
        nudge_context: nudgeContext,
      },
    });

    const newMessages = [
      ...messages,
      { sender: "user", text: chip },
      { sender: "bot", text: `🔧 Running action: ${chip}` },
    ];
    setMessages(newMessages);

    try {
      const response = await fetch(
        "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/act",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chip,
            canvas_id: canvasId,
            role: roleType || "catalyst",
            user_id,
            // You *can* still pass explicit targets prop, but backend can also use nudge_context.tailShapeIds
            targets: targets || [],
            params: {
              ...(params || {}),
              nudge_context: nudgeContext,
            },
          }),
        }
      );

      const data = await response.json();
      console.log(`---/act data---`, data);

      if (data.error) {
        setMessages([
          ...newMessages,
          { sender: "bot", text: `⚠️ Action error: ${data.error}` },
        ]);
        return;
      }

      const result = data.result ?? data;

      const maybeImages =
        result?.image_urls ||
        result?.created_shapes
          ?.filter((s) => s.type === "image" && s.imageUrl)
          .map((s) => s.imageUrl) ||
        [];

      let firebaseUrls = null;
      if (maybeImages.length) {
        try {
          firebaseUrls = await mirrorAllImagesToFirebase(maybeImages, {
            canvasId,
            user_id,
          });
        } catch (e) {
          console.error("Mirroring images (chip) failed:", e);
          firebaseUrls = maybeImages;
        }
      }

      console.log(`Bot Reply (raw):`, result?.output?.[0]?.content);

      const botReply = formatBotReply(
        result?.outputs?.find((o) => o?.type === "summary")?.content ??
          result?.output?.[0]?.content ??
          "Action completed."
      );

      setMessages([
        ...newMessages,
        {
          sender: "bot",
          text: botReply,
          type: roleType,
          image_urls: firebaseUrls,
        },
      ]);
    } catch (error) {
      console.error(error);
      setMessages([
        ...newMessages,
        { sender: "bot", text: "Error executing action." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const lastAnalyzeRef = useRef({
    time: null,
    moveCount: 0,
    inFlight: false,
  });

  useEffect(() => {
    if (!shapes || shapes.length === 0) return;

    const now = Date.now();
    const last = lastAnalyzeRef.current;
    const elapsed = last.time ? now - last.time : Infinity;
    const deltaMoves = shapes.length - (last.moveCount || 0);

    const shouldCall = elapsed >= 30_000 || deltaMoves >= 8;
    if (!shouldCall) return;

    runAnalyzeNudge("auto");
  }, [shapes]);

  const runAnalyzeNudge = async (source = "auto") => {
    if (!shapes || !Array.isArray(shapes) || shapes.length === 0) return;

    const now = Date.now();
    const last = lastAnalyzeRef.current || {
      time: 0,
      moveCount: 0,
      inFlight: false,
    };

    // 🔁 HYBRID TRIGGER (Option C) — only for auto mode
    if (source === "auto") {
      const elapsed = now - (last.time || 0); // ms
      const moveDelta = shapes.length - (last.moveCount || 0);

      // If not enough time and not enough new moves, skip
      if (elapsed < 30_000 && moveDelta < 6) {
        // console.log("[nudge] auto: skipping (elapsed, moveDelta) = ", elapsed, moveDelta);
        return;
      }
    }

    // Prevent overlapping calls
    if (last.inFlight) return;
    lastAnalyzeRef.current.inFlight = true;
    setNudgesLoading(true);

    // Only show “Analyzing…” if the user explicitly clicked
    if (source === "button") {
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "🔍 Analyzing your canvas activity to suggest a nudge...",
        },
      ]);
    }

    const episodeId = canvasId || "TeamRoadTrip";

    try {
      // const res = await fetch("http://192.168.1.185:8060/analyze", {
      const res = await fetch(
        "https://prediction-backend-g5x7odgpiq-uc.a.run.app/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            episode_id: episodeId,
            shapes: shapes,
            window_sec: 15,
            min_link: 0.5,
            tail_window_count: 6, // ⬅️ match backend default
          }),
        }
      );

      const data = await res.json();
      console.log("[/analyze] response:", data);

      if (!res.ok || data.error) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "bot",
            text: `⚠️ Nudge pipeline error: ${
              data.error || "Backend returned an error."
            }`,
          },
        ]);
        return;
      }

      const trigger = data.trigger || null;
      const metrics = data.metrics || null;

      const windows = Array.isArray(data.windows) ? data.windows : [];
      const current_phase = data.current_phase || null;
      const tailShapeIds = Array.isArray(data.tail_shape_ids)
        ? data.tail_shape_ids
        : [];

      if (!windows.length || !current_phase) {
        if (source === "button") {
          setMessages((prev) => [
            ...prev,
            {
              sender: "bot",
              text: "I couldn’t detect any stable windows of activity yet. Try working on the canvas a bit more first.",
            },
          ]);
        }
        return;
      }

      // 🔐 PHASE CONFIDENCE + STABILITY GATING (Option D-ish)
      const phase =
        current_phase.current_phase_dc ||
        current_phase.current_phase_full ||
        "unknown";

      const meanConf =
        typeof current_phase.mean_confidence === "number"
          ? current_phase.mean_confidence
          : null;

      // simple stability: majority of predicted_phase_dc in the last windows
      const phaseDcList = windows
        .map((w) => w.predicted_phase_dc)
        .filter(Boolean);

      const phaseCounts = phaseDcList.reduce((acc, p) => {
        acc[p] = (acc[p] || 0) + 1;
        return acc;
      }, {});
      const majorityPhase =
        Object.keys(phaseCounts).length > 0
          ? Object.entries(phaseCounts).sort((a, b) => b[1] - a[1])[0][0]
          : null;

      const stablePhase =
        majorityPhase && phaseDcList.length >= 3
          ? phaseCounts[majorityPhase] >= Math.min(4, phaseDcList.length)
          : false;

      const confidenceHigh = meanConf === null ? false : meanConf >= 0.7;

      // For auto mode: if not stable or not confident, silently skip
      if (source === "auto" && (!stablePhase || !confidenceHigh)) {
        console.log(
          "[nudge] auto: skipping due to unstable/low-confidence phase",
          { phase, meanConf, stablePhase, majorityPhase, phaseDcList }
        );
        return;
      }

      // For button mode: tell the user if it’s too noisy
      if (source === "button" && (!stablePhase || !confidenceHigh)) {
        setMessages((prev) => [
          ...prev,
          {
            sender: "bot",
            text:
              "I analyzed your recent activity, but the phase is not yet stable or confident enough for a strong recommendation. " +
              "Try working a bit more (or clustering a few ideas), then ask again.",
          },
        ]);
        return;
      }

      const confPct = meanConf !== null ? (meanConf * 100).toFixed(1) : null;
      const phaseNice = phase[0].toUpperCase() + phase.slice(1);

      // const phaseLine = confPct
      //   ? `Current phase (last ${current_phase.window_ids.length} windows): **${phaseNice}** (confidence ~${confPct}%).`
      //   : `Current phase (last ${current_phase.window_ids.length} windows): **${phaseNice}**.`;

      const phaseLine = confPct
        ? `I’m pretty sure you’re in a ${phaseNice.toLowerCase()} phase (about ${confPct}% confident).`
        : `It looks like you’re in a ${phaseNice.toLowerCase()} phase.`;

      let nudgeText = "";
      let chips = [];
      let nudgeType = "nudge";

      if (phase === "divergent") {
        nudgeText =
          "You’re in a brainstorming mode with lots of ideas. This might be a good moment to group related options or ask AI to help contrast a few promising directions.";
        chips = [
          "Cluster similar ideas into groups",
          "Highlight 3 most different ideas",
        ];
        nudgeType = "catalyst";
      } else if (phase === "convergent") {
        nudgeText =
          "You’re narrowing things down. It may help to summarize your top options and check if any important constraints or trade-offs are missing.";
        chips = [
          "Summarize top 3 options with pros/cons",
          "Ask for missing constraints or risks",
        ];
        nudgeType = "communicator";
      } else if (phase === "incubation") {
        nudgeText =
          "Activity has slowed down a bit. You could step back to scan the board, or ask AI to surface a few overlooked directions to restart the discussion.";
        chips = [
          "Scan the board and surface overlooked clusters",
          "Suggest 2–3 fresh directions from existing notes",
        ];
        nudgeType = "catalyst";
      } else if (phase === "conflict") {
        nudgeText =
          "Signals look mixed, as if there are competing ideas. It might help to make disagreements and decision criteria explicit before moving on.";
        chips = [
          "List key points of disagreement",
          "Reframe options in a neutral summary",
        ];
        nudgeType = "communicator";
      } else {
        nudgeText =
          "I analyzed your recent activity, but things are a bit noisy. It might help to summarize what you have and decide together what to do next.";
        chips = [
          "Summarize what we have so far",
          "Suggest next step for the group",
        ];
        nudgeType = "nudge";
      }

      if (trigger && trigger.id) {
        console.log("[nudge] trigger hit:", trigger.id, trigger);
        const triggerLabel = trigger.label || trigger.id;

        nudgeText =
          trigger.user_text ||
          nudgeText ||
          `Something interesting is happening: ${triggerLabel}. Want help responding to it?`;

        if (Array.isArray(trigger.chips) && trigger.chips.length) {
          chips = trigger.chips;
        }

        // Remember: msg.type controls which agent runs when a chip is clicked
        if (trigger.role) {
          nudgeType = trigger.role; // e.g., "provocateur" or "communicator"
        }
      }

      // 🔗 let parent know which shapes were in the tail windows
      if (typeof onNudgeComputed === "function") {
        onNudgeComputed({
          currentPhase: current_phase,
          windows,
          tailShapeIds,
          trigger,
          metrics,
          source,
        });
      }

      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: `${phaseLine}\n\n${nudgeText}`,
          type: nudgeType,
          chips,
          meta: {
            phase,
            source,
            tailShapeIds,
            windowIds: current_phase.window_ids || [],
            episodeId,
            triggerId: trigger?.id || null,
          },
        },
      ]);

      lastAnalyzeRef.current.time = now;
      lastAnalyzeRef.current.moveCount = shapes.length;
    } catch (err) {
      console.error("Nudge request failed:", err);
      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: "⚠️ Could not reach the phase-analysis backend.",
        },
      ]);
    } finally {
      lastAnalyzeRef.current.inFlight = false;
      setNudgesLoading(false);
    }
  };

  const handleRequestNudges = () => runAnalyzeNudge("button");

  const toggleNudgeExpand = (idx) => {
    setMessages((prev) =>
      prev.map((m, i) => (i === idx ? { ...m, expanded: !m.expanded } : m))
    );
  };

  const handleSend = async () => {
    if (!userInput.trim()) return;

    const context = gatherContextFromClips(clipNotes);
    const newMessages = [
      ...messages,
      {
        sender: "user",
        text: userInput,
        image_urls: context.images,
        attached_texts: context.texts,
      },
    ];

    const history = buildHistoryForBackend(newMessages);

    console.log("New Messages:", newMessages);
    setMessages(newMessages);
    setUserInput("");
    // setClipNotes([]);
    setLoading(true);

    try {
      // const response = await fetch("http://127.0.0.1:5000/api/chatgpt-helper", {
      const response = await fetch(
        "https://flask-app-jqwkqdscaq-uc.a.run.app/api/chatgpt-helper",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userInput,
            canvas_id: canvasId,
            role,
            user_id,
            targets: targets || [],
            params: params || {},
            context: {
              images: context.images,
              texts: context.texts,
            },
            history,
          }),
        }
      );

      const data = await response.json();
      if (data.reply) {
        let firebaseUrls = null;
        console.log(
          `canvasId - ${canvasId} - user_id - ${user_id} - data`,
          data
        );

        const b64s = data.images_b64 || data.image_b64;

        if (Array.isArray(b64s) && b64s.length) {
          try {
            firebaseUrls = await uploadManyB64ToFirebase(b64s, {
              canvasId,
              // user_id,
              storage, // from your firebaseConfig import
            });
          } catch (e) {
            console.error("Uploading images failed", e);
          }
        }

        setMessages([
          ...newMessages,
          {
            sender: "bot",
            text: formatBotReply(data.reply),
            image_urls: firebaseUrls, // will now be Firebase URLs
          },
        ]);
      } else {
        setMessages([
          ...newMessages,
          { sender: "bot", text: "Something went wrong." },
        ]);
      }
    } catch (error) {
      console.error(error);
      setMessages([
        ...newMessages,
        { sender: "bot", text: "Error connecting to server." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  // put near top of component
  const toLines = (val) => {
    if (val === null || val === undefined) return [];
    if (typeof val === "string") return val.split("\n");
    if (typeof val === "number" || typeof val === "boolean")
      return String(val).split("\n");
    // objects / arrays → pretty JSON
    try {
      return JSON.stringify(val, null, 2).split("\n");
    } catch {
      return [String(val)];
    }
  };

  // Turn /act result into a readable chat message
  const summarizeActResult = (res, { chip, role }) => {
    if (!res) return `✅ ${chip} via ${role || "agent"} — no result`;
    if (res.status === "error" || res.error)
      return `❌ ${res.error || "Action failed"}`;

    // 1) collect LLM outputs
    const chunks = Array.isArray(res.outputs)
      ? res.outputs.map((o) => {
          const tag = o?.type ? `[${o.type}] ` : "";
          const content =
            typeof o?.content === "string"
              ? o.content
              : JSON.stringify(o?.content, null, 2);
          return `${tag}${content}`;
        })
      : [];

    // 2) created shapes (ids)
    const created = res.created_shapes?.length
      ? `Created shapes: ${res.created_shapes.map((s) => s.id).join(", ")}`
      : "";

    // 3) any skipped
    const skipped = res.skipped?.length
      ? `Skipped: ${res.skipped.length} target(s)`
      : "";

    // 4) header + parts
    return [
      `✅ ${chip} via ${role || "agent"}`,
      chunks.join("\n\n"),
      created,
      skipped,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  // Helpers to classify and gather context from clipNotes
  // const isImageLike = (val) =>
  //   typeof val === "string" &&
  //   (/^data:image\//i.test(val) || /^https?:\/\//i.test(val));
  // Only treat real URLs as images for backend context
  const isImageLike = (val) =>
    typeof val === "string" && /^https?:\/\//i.test(val);

  const dedupeBy = (arr, keyFn) => {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const key = keyFn(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  };

  const gatherContextFromClips = (clips) => {
    console.group("[gatherContextFromClips] START");

    if (!Array.isArray(clips)) {
      console.log("[gatherContextFromClips] clips is not an array:", clips);
      console.groupEnd();
      return { images: [], texts: [] };
    }

    const images = [];
    const texts = [];

    clips.forEach((c, index) => {
      console.log(`\n---- Clip #${index} ----`);
      console.log("Full clip object:", c);

      const snip = c?.snip;
      const kind = c?.kind;

      console.log("kind:", kind);
      console.log("snip:", snip);

      if (!snip) {
        console.log("Skipping clip — snip is empty or null");
        return;
      }

      // 1. Hosted HTTPS image?
      if (typeof snip === "string" && /^https?:\/\//i.test(snip)) {
        console.log("➡️ Detected HTTPS image URL → pushing to images:", snip);
        images.push(snip);
        return;
      }

      // 2. Base64 data URL?
      if (typeof snip === "string" && snip.startsWith("data:image/")) {
        console.log(
          "➡️ Detected data:image (base64) → NOT sending, adding marker text"
        );
        texts.push("[canvas image selected]");
        return;
      }

      // 3. Anything else → treat as text
      if (typeof snip === "string" && snip.trim()) {
        console.log("➡️ Detected normal text → pushing:", snip.trim());
        texts.push(snip.trim());
        return;
      }

      console.log("❓ snip exists but did not match any rule:", snip);
    });

    const ctx = {
      images: dedupeBy(images, (x) => x),
      texts: dedupeBy(texts, (x) => x),
    };

    console.log("\n===== FINAL CONTEXT SENT TO BACKEND =====");
    console.log("Images:", ctx.images);
    console.log("Texts:", ctx.texts);

    console.groupEnd();

    return ctx;
  };

  const badgePing = (key) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const notifyCanvas = (payload) => {
    try {
      window.dispatchEvent(
        new CustomEvent("chatbot-copy", { detail: payload })
      );
    } catch {}
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text || "");
      badgePing(key);
      notifyCanvas({ kind: "text", content: text || "" });
    } catch (e) {
      console.error("Copy text failed:", e);
    }
  };

  const copyImage = async (url, key) => {
    try {
      let blob;
      // handles https: and data: URIs
      const res = await fetch(url);
      blob = await res.blob();

      if (navigator.clipboard && window.ClipboardItem) {
        const item = new ClipboardItem({ [blob.type || "image/png"]: blob });
        await navigator.clipboard.write([item]);
        badgePing(key);
        notifyCanvas({ kind: "image", content: url });
      } else {
        // fallback: copy the URL instead
        await navigator.clipboard.writeText(url);
        badgePing(key);
        notifyCanvas({ kind: "image-url", content: url });
      }
    } catch (err) {
      console.error("Image copy failed, falling back to URL:", err);
      try {
        await navigator.clipboard.writeText(url);
        badgePing(key);
        notifyCanvas({ kind: "image-url", content: url });
      } catch (e2) {
        console.error("URL copy failed:", e2);
      }
    }
  };

  const renderInner = () => {
    return (
      <div className="chatbot-container">
        <div className="chatbot-header chatbot-drag">
          <div className="chatbot-header-left">
            <div className="chatbot-header-icon">
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <div className="chatbot-header-text">
              <div className="chatbot-header-title">
                {variant === "floating" ? "Canvas AI" : "Chat History"}
              </div>
              <div className="chatbot-header-subtitle">
                Ask questions about your selection
              </div>
            </div>
          </div>

          <div className="chatbot-header-actions">
            {/* <button
              className="chatbot-header-btn"
              // onClick={toggleSidebar}
              onClick={() => toggleSidebar?.()}
              title="Toggle chat history"
            >
              <FontAwesomeIcon icon={faClockRotateLeft} />
            </button> */}

            {variant === "floating" && (
              <button
                className="chatbot-header-btn"
                onClick={() => toggleSidebar?.()}
                title="Open chat history"
              >
                <FontAwesomeIcon icon={faClockRotateLeft} />
              </button>
            )}

            <button
              className="chatbot-header-btn"
              onClick={handleRequestNudges}
              title={nudgesLoading ? "Analyzing..." : "Get canvas-based nudge"}
              disabled={nudgesLoading}
            >
              <FontAwesomeIcon icon={faBolt} />
            </button>

            <button
              className="chatbot-header-btn"
              // onClick={() => setIsOpen(false)}
              onClick={() => {
                if (variant === "floating") {
                  setIsOpen(false); // just close the floating widget
                } else {
                  toggleSidebar?.(); // close the sidebar wrapper
                }
              }}
              title="Close"
            >
              <FontAwesomeIcon icon={faXmarkCircle} />
            </button>
          </div>
        </div>

        <div className="chatbot-messages">
          {messages.map((msg, idx) => {
            const hasFocusShape =
              nudgeFocusShapeId &&
              msg.meta &&
              Array.isArray(msg.meta.tailShapeIds) &&
              msg.meta.tailShapeIds.includes(nudgeFocusShapeId);

            const isNudgeLike =
              msg.type &&
              ["nudge", "provocateur", "communicator", "catalyst"].includes(
                msg.type
              );

            const isExpanded = !isNudgeLike || msg.expanded;
            const lines = toLines(msg.text);
            const preview =
              lines.length > 0
                ? lines[0].length > 120
                  ? lines[0].slice(0, 120) + "…"
                  : lines[0]
                : "";
            const tailIds = Array.isArray(msg.meta?.tailShapeIds)
              ? msg.meta.tailShapeIds
              : [];

            const handleNudgeHover = (active) => {
              if (!tailIds.length) return;
              try {
                window.dispatchEvent(
                  new CustomEvent("chatbot-nudge-hover", {
                    detail: { active, tailShapeIds: tailIds },
                  })
                );
              } catch (e) {
                console.error("Failed to dispatch chatbot-nudge-hover:", e);
              }
            };

            return (
              <div
                key={idx}
                ref={hasFocusShape ? nudgeScrollRef : null}
                className={`chatbot-message ${msg.sender}${
                  hasFocusShape ? " chatbot-message--highlight" : ""
                }${isNudgeLike ? " chatbot-message--nudge" : ""}`}
              >
                {/* Nudge header (collapsed/expand control) */}
                {isNudgeLike && (
                  <div
                    className="chatbot-nudge-header"
                    onClick={() => toggleNudgeExpand(idx)}
                    onMouseEnter={() => handleNudgeHover(true)}
                    onMouseLeave={() => handleNudgeHover(false)}
                  >
                    <div className="chatbot-nudge-header-left">
                      <span className="chatbot-nudge-pill">
                        AI nudge{" "}
                        {msg.meta?.triggerId ? `· ${msg.meta.triggerId}` : ""}
                      </span>
                      {preview && (
                        <span className="chatbot-nudge-preview">{preview}</span>
                      )}
                    </div>
                    <div className="chatbot-nudge-toggle">
                      {isExpanded ? "Hide" : "Show"}
                    </div>
                  </div>
                )}

                {/* Only show full body when expanded (or if not a nudge) */}
                {isExpanded && (
                  <>
                    {msg.sender === "bot" && (
                      <button
                        className="chatbot-copy-btn"
                        title="Copy reply"
                        onClick={() =>
                          copyText(toLines(msg.text).join("\n"), `msg-${idx}`)
                        }
                      >
                        <FontAwesomeIcon icon={faCopy} />
                      </button>
                    )}
                    {copiedKey === `msg-${idx}` && (
                      <span className="chatbot-copied-pill">Copied</span>
                    )}

                    {toLines(msg.text).map((line, i) => (
                      <p key={i} style={{ margin: 0 }}>
                        {line}
                      </p>
                    ))}

                    {msg.type && (
                      <div className="chatbot-nudge-type">
                        <strong>Type:</strong> {msg.type}
                      </div>
                    )}

                    {msg.chips && msg.chips.length > 0 && (
                      <div className="chatbot-nudge-chips">
                        {msg.chips.map((chip, i) => (
                          <div
                            key={i}
                            className="chatbot-chip"
                            onClick={() => {
                              handleChipClick(chip, msg.type, msg);
                            }}
                            title={`Click to use "${chip}"`}
                          >
                            {chip}
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.image_urls && Array.isArray(msg.image_urls) && (
                      <div className="chatbot-image-grid">
                        {msg.image_urls.map((url, i) => (
                          <div key={i} className="chatbot-image-wrap">
                            <img
                              src={url}
                              alt={`Generated visual ${i + 1}`}
                              style={{
                                width: "100%",
                                borderRadius: "6px",
                                objectFit: "cover",
                              }}
                            />
                            <button
                              className="chatbot-copy-img-btn"
                              title="Copy image"
                              onClick={() => copyImage(url, `img-${idx}-${i}`)}
                            >
                              <FontAwesomeIcon icon={faCopy} />
                            </button>
                            {copiedKey === `img-${idx}-${i}` && (
                              <span className="chatbot-copied-pill">
                                Copied
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {Array.isArray(msg.attached_texts) &&
                      msg.attached_texts.length > 0 && (
                        <div className="chatbot-text-attachments">
                          {msg.attached_texts.map((t, i) => (
                            <div key={i} className="chatbot-text-attachment">
                              {t.length > 400 ? t.slice(0, 400) + "…" : t}
                            </div>
                          ))}
                        </div>
                      )}
                  </>
                )}
              </div>
            );
          })}

          {loading && <div className="chatbot-message bot">Thinking...</div>}
        </div>

        <div className="chatbot-clipnote-bar">
          {clipNotes.map((clip, index) => {
            const isImage =
              clip.kind === "image" ||
              (typeof clip.snip === "string" &&
                (clip.snip.startsWith("data:image/") ||
                  clip.snip.startsWith("http://") ||
                  clip.snip.startsWith("https://")));

            const label =
              clip.kind === "summary"
                ? "Selection"
                : clip.kind === "image"
                ? "Image"
                : "Note";

            return (
              <div
                key={`${clip.id}-${index}`}
                className="chatbot-clip-box"
                title={clip.snip}
              >
                {isImage ? (
                  <img
                    src={clip.snip}
                    alt={label}
                    className="chatbot-clip-img"
                  />
                ) : (
                  <span className="chatbot-clip-text">
                    {clip.snip.length > 30
                      ? clip.snip.slice(0, 30) + "…"
                      : clip.snip}
                  </span>
                )}

                <div className="chatbot-clip-label">{label}</div>

                <div
                  className="chatbot-clip-delete"
                  onClick={() => {
                    setClipNotes((prev) => prev.filter((_, i) => i !== index));
                  }}
                >
                  <FontAwesomeIcon icon={faXmarkCircle} />
                </div>
              </div>
            );
          })}

          {/* NEW: toggle selection mode */}
          <div
            className={`chatbot-clip-box add-box ${
              isSelectingFromCanvas ? "active" : ""
            }`}
            title={
              isSelectingFromCanvas
                ? "Click again to stop selecting from canvas"
                : "Click, then click items on the canvas to add them"
            }
            onClick={() => {
              const next = !isSelectingFromCanvas;
              setIsSelectingFromCanvas(next);

              try {
                window.dispatchEvent(
                  new CustomEvent("chatbot-selection-mode", {
                    detail: { enabled: next },
                  })
                );
              } catch (e) {
                console.error("Failed to toggle selection mode:", e);
              }
            }}
          >
            {isSelectingFromCanvas ? (
              <div className="chatbot-clip-add-expanded">
                <span className="chatbot-clip-add-text">Selecting…</span>
                <span className="chatbot-clip-add-stop">Click to stop</span>
              </div>
            ) : (
              <FontAwesomeIcon icon={faPlusCircle} />
            )}
          </div>
        </div>

        <div className="chatbot-input">
          <input
            type="text"
            placeholder="Ask me something..."
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
          />
          <button onClick={handleSend}>Send</button>
        </div>
      </div>
    );
  };

  if (!isOpen && variant === "floating") return null;

  return variant === "floating" ? (
    <Rnd
      position={position}
      className="chatbot-rnd"
      default={{
        x: window.innerWidth - 400 - 20,
        y: window.innerHeight - 540 - 20,
      }}
      size={{ width: 400, height: 500 }}
      onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
      dragHandleClassName="chatbot-drag"
      enableResizing={{
        topLeft: true,
        bottomRight: false,
        top: true,
        right: false,
        bottom: false,
        left: false,
        topRight: false,
        bottomLeft: false,
      }}
      maxWidth={600}
      maxHeight={800}
    >
      {renderInner()}
    </Rnd>
  ) : (
    // Sidebar / embedded version, no Rnd
    <div className="chatbot-embedded">{renderInner()}</div>
  );

  // return (
  //   <>
  //     {isOpen && (
  //       <Rnd
  //         position={position}
  //         // bounds="parent"
  //         className="chatbot-rnd"
  //         default={{
  //           x: window.innerWidth - 400 - 20,
  //           y: window.innerHeight - 540 - 20,
  //         }}
  //         size={{ width: 400, height: 500 }}
  //         onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
  //         dragHandleClassName="chatbot-drag"
  //         enableResizing={{
  //           topLeft: true,
  //           bottomRight: false,
  //           top: true,
  //           right: false,
  //           bottom: false,
  //           left: false,
  //           topRight: false,
  //           bottomLeft: false,
  //         }}
  //         maxWidth={600}
  //         maxHeight={800}
  //       >
  //         {renderInner()}
  //       </Rnd>
  //     ) : (<div className="chatbot-embedded">{renderInner()}</div>);
  //     }
  //   </>
  // );
};

export default ChatBot;
