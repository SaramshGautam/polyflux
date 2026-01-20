import React, { useState, useEffect, useRef } from "react";
import "./ChatBot.css";
import { formatBotReply } from "../utils/formatBotReply";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import Draggable from "react-draggable";
import { storage } from "../firebaseConfig";
import { ref as sRef, uploadBytes, getDownloadURL } from "firebase/storage";
import { db } from "../firebaseConfig";
import { collection, addDoc, serverTimestamp } from "firebase/firestore";
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

function linkifyText(text) {
  if (!text) return "";

  const urlRegex = /((https?:\/\/|www\.)[^\s<]+)/gi;

  return text.replace(urlRegex, (url) => {
    const href = url.startsWith("http") ? url : `https://${url}`;
    return `<a href="${href}" target="_blank" rel="noopener noreferrer">${url}</a>`;
  });
}

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
  const { b64: raw, contentType } = normalizeB64(b64);
  // const path = `generated/${canvasSafe}/${uidSafe}/${ts}-${idx}.png`;

  const ext =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/webp"
      ? "webp"
      : contentType === "image/gif"
      ? "gif"
      : contentType === "image/svg+xml"
      ? "svg"
      : "png";

  // const path = `generated/${canvasSafe}/${uid}/${ts}-${idx}.png`;
  const path = `generated/${canvasSafe}/${uid}/${ts}-${idx}.${ext}`;

  // const blob = b64ToBlob(b64, "image/png");
  const blob = b64ToBlob(raw, contentType);

  const ref = sRef(storage, path);

  await uploadBytes(ref, blob, {
    // contentType: "image/png",
    contentType,
    cacheControl: "public, max-age=31536000, immutable",
    customMetadata: {
      source: "chatbot",
      // canvasId,
      canvasId: String(canvasId || ""),
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
  // const {
  //   ref: sRef,
  //   uploadBytes,
  //   getDownloadURL,
  // } = await import("firebase/storage"); // already imported higher; left for clarity
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

const normKey = (v) =>
  String(v || "")
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_"); // handles spaces, hyphens

function getNudgeHeader({ phase, triggerId, triggerLabel }) {
  const p = String(phase || "")
    .trim()
    .toLowerCase();
  const raw = triggerId || triggerLabel || "";
  const t = normKey(raw);

  // -----------------------
  // Exact backend triggers
  // -----------------------

  // Scattered divergence
  if (t === "scattered_divergence") {
    if (p === "divergent")
      return "Ideas are staying too close. Try branching out.";
    return "Ideas feel clustered. Try exploring a new direction.";
  }

  // Underexplored / stagnant divergence
  if (t === "stagnant_divergence" || t.includes("underexplored")) {
    if (p === "divergent") return "Ideas are repeating. Try a fresh direction.";
    return "You may be circling the same ideas. Try a new angle.";
  }

  // Long-running divergence
  if (t === "long_running_divergence") {
    return "Lots of ideas, little narrowing. Pick 2–3 to evaluate.";
  }

  // Early convergence
  if (t === "early_convergence") {
    return "You’re narrowing fast. Check for missing alternatives.";
  }

  // Refinement loop
  if (t === "refinement_loop") {
    return "Stuck polishing details. Step back and reassess options.";
  }

  // Long lull
  if (t === "long_lull") {
    return "Momentum dipped. Want a quick next step to restart?";
  }

  // Participation imbalance
  if (t === "participation_imbalance_group") {
    return "One voice is dominating. Invite quieter input.";
  }

  // -----------------------
  // Fallback
  // -----------------------
  const nicePhase = p ? ` (${p})` : "";
  return `Noticing a pattern${nicePhase}. Want a quick next step?`;
}

const SimpleLinkPreview = ({ url }) => {
  if (!url) return null;
  let host = url;
  try {
    host = new URL(url).hostname;
  } catch {}
  return (
    <a
      className="chatbot-link-preview"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      title={url}
    >
      <div className="chatbot-link-preview-title">{host}</div>
      <div className="chatbot-link-preview-url">{url}</div>
    </a>
  );
};

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
  onTriggerFired,
  forceOpen = false,
  onClose,
}) => {
  const [userInput, setUserInput] = useState("");
  // const [isOpen, setIsOpen] = useState(variant === 'floating');
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clipNotes, setClipNotes] = useState([]);
  const [isSelectingFromCanvas, setIsSelectingFromCanvas] = useState(false);
  const [position, setPosition] = useState({
    x: window.innerWidth - 400 - 20,
    y: window.innerHeight - 540 - 20,
  });
  const [copiedKey, setCopiedKey] = useState(null);
  const [nudgesLoading, setNudgesLoading] = useState(false);
  const [phaseTheme, setPhaseTheme] = useState("neutral");
  const lastExternalTriggerRef = useRef({ key: null, time: 0 });
  const EXTERNAL_TRIGGER_DEDUPE_MS = 2000;
  const shellThemeTokenRef = useRef(0);
  const shellThemeTimeoutRef = useRef(null);

  const sessionIdRef = useRef(
    `${Date.now()}-${Math.random().toString(16).slice(2)}`
  );

  const redactText = (s = "", max = 5000) => {
    // Avoid logging huge payloads or secrets; tune as you like.
    const str = String(s || "");
    return str.length > max ? str.slice(0, max) + "…[truncated]" : str;
  };

  const logBotEvent = async (eventName, payload = {}) => {
    try {
      // Identify user consistently:
      const auth = getAuth();
      const uid = auth.currentUser?.uid || null;

      // const safeCanvasId = String(canvasId || "unknown").replace(/_/g, "/");
      const toCanvasPath = (flatId) => {
        const raw = String(flatId || "").trim();

        // Expect: <condition>_<project>_<team>
        const parts = raw.split("_");
        const classroom = parts[0] || "unknown";
        const team = parts.length >= 2 ? parts[parts.length - 1] : "unknown";
        const project =
          parts.length >= 3 ? parts.slice(1, -1).join("_") : "unknown";

        return `/${classroom}/Projects/${project}/teams/${team}/`;
      };

      const toFirestoreDocId = (flatId) =>
        String(flatId || "unknown").replace(/[^\w.@-]/g, "_"); // keep it safe

      // Basic envelope
      const doc = {
        event: String(eventName || "unknown"),
        createdAt: serverTimestamp(),
        clientTs: Date.now(), // useful for ordering even if offline
        canvasId: toCanvasPath(canvasId) || null,
        appUserId: user_id || null, // your own user_id
        firebaseUid: uid,
        role: role || null,
        variant: variant || null,
        sessionId: sessionIdRef.current,

        // Keep payload small + safe
        payload: payload,
        // Optional: user agent / page info
        meta: {
          href: typeof window !== "undefined" ? window.location.href : null,
        },
      };

      console.log("[bot-log] logging event:", doc);
      // Firestore path: canvases/{canvasId}/bot_logs
      // const col = collection(db, String(safeCanvasId || "unknown"), "bot_logs");
      // const col = collection(
      //   db,
      //   "classrooms",
      //   canvasId || "unknown",
      //   "bot_logs"
      // );

      // const canvasDocId = toFirestoreDocId(canvasId);
      // const col = collection(db, "canvases", canvasDocId, "bot_logs");

      const flatId = String(canvasId || "unknown");
      const parts = flatId.split("_");
      const classroom = parts[0] || "unknown";
      const team = parts.at(-1) || "unknown";
      const project = parts.slice(1, -1).join("_") || "unknown";

      const col = collection(
        db,
        "classrooms",
        classroom,
        "Projects",
        project,
        "teams",
        team,
        "bot_logs"
      );

      await addDoc(col, doc);
    } catch (e) {
      // Don’t break UX if logging fails
      console.warn("[bot-log] failed:", e);
    }
  };

  const setShellThemeTemporarily = (theme, ms = 30_000) => {
    const token = Date.now();
    shellThemeTokenRef.current = token;

    // set theme immediately
    setPhaseTheme(theme);

    // clear any prior timer
    if (shellThemeTimeoutRef.current) {
      clearTimeout(shellThemeTimeoutRef.current);
    }

    shellThemeTimeoutRef.current = setTimeout(() => {
      // only revert if nothing newer happened
      if (shellThemeTokenRef.current === token) {
        setPhaseTheme("neutral");
      }
    }, ms);
  };

  useEffect(() => {
    if (forceOpen) setIsOpen(true);
  }, [forceOpen]);

  useEffect(() => {
    return () => {
      if (shellThemeTimeoutRef.current)
        clearTimeout(shellThemeTimeoutRef.current);
    };
  }, []);

  // --- Nudge notification control ---
  const lastNotifiedRef = useRef({
    triggerId: null,
    time: 0,
  });

  const NUDGE_NOTIFY_COOLDOWN_MS = 45_000; // adjust

  const notifyUser = (text) => {
    // Option A: push a small bot “system” message (simple & reliable)
    setMessages((prev) => [
      ...prev,
      { sender: "bot", text: `🔔 ${text}`, type: "system" },
    ]);

    // Option B (optional): also dispatch an event if you want a toast in UI somewhere else
    try {
      window.dispatchEvent(
        new CustomEvent("chatbot-nudge-notify", { detail: { text } })
      );
    } catch {}
  };

  const nudgeScrollRef = useRef(null);

  const getPhaseTheme = (phase) => {
    if (!phase) return "neutral";
    const p = String(phase).toLowerCase();

    if (p === "divergent") return "divergent";
    if (p === "convergent") return "convergent";
    if (p === "incubation") return "incubation";
    if (p === "conflict") return "conflict";

    return "neutral";
  };

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
      // setIsOpen(true);
      setMessages((prev) => [...prev, ...externalMessages]);
    }
  }, [externalMessages, setMessages]);

  useEffect(() => {
    const handleExternalTrigger = async (e) => {
      const detail = e.detail || {};
      const {
        snippet,
        source,
        position,
        meta,

        text, // main message text (optional)
        chips, // array of chips (optional)
        role: roleType, // "provocateur" | "communicator" | "catalyst" | "nudge"
        type, // fallback name if you used "type" in payload
        phase, // optional
      } = detail;

      setIsOpen(true);

      if (position) {
        setPosition({ x: position.x, y: position.y });
      }

      const dedupeKey =
        meta?.dedupe_key ||
        meta?.dedupeKey ||
        meta?.trigger?.dedupe_key ||
        meta?.trigger?.dedupeKey ||
        null;

      if (dedupeKey) {
        const now = Date.now();
        const last = lastExternalTriggerRef.current || { key: null, time: 0 };
        if (
          last.key === dedupeKey &&
          now - last.time < EXTERNAL_TRIGGER_DEDUPE_MS
        ) {
          return; // drop duplicate
        }
        lastExternalTriggerRef.current = { key: dedupeKey, time: now };
      }

      // ---- clip notes logic (keep yours) ----
      setClipNotes((prev) => {
        const next = [...prev];

        if (meta?.selection && Array.isArray(meta.selection)) {
          meta.selection.forEach((item) => {
            const textVal =
              item.text ||
              item.label ||
              (typeof item === "string" ? item : "") ||
              "";

            next.push({
              id: item.id,
              snip:
                item.type === "image"
                  ? item.url ||
                    item.imageUrl ||
                    item.src ||
                    item.downloadUrl ||
                    ""
                  : textVal,
              kind: item.type,
            });
          });
        } else if (snippet) {
          next.push({ id: source, snip: snippet, kind: "summary" });
        }

        return next;
      });

      // ✅ NEW: actually push a message that contains chips
      // const resolvedType = String(roleType || type || "nudge").toLowerCase();
      // const resolvedChips = Array.isArray(chips) ? chips : [];

      const resolvedType = String(
        roleType || type || meta?.role || meta?.trigger?.role || "nudge"
      ).toLowerCase();

      const resolvedChips =
        Array.isArray(chips) && chips.length
          ? chips
          : Array.isArray(meta?.chips) && meta.chips.length
          ? meta.chips
          : Array.isArray(meta?.trigger?.chips) && meta.trigger.chips.length
          ? meta.trigger.chips
          : [];

      // choose message text priority: explicit text > snippet note > fallback
      // const messageText =
      //   typeof text === "string" && text.trim()
      //     ? text.trim()
      //     : snippet
      //     ? `💡 Selection sent to AI:\n${snippet}`
      //     : "💡 Selection received.";

      const messageText =
        (typeof text === "string" && text.trim() ? text.trim() : "") ||
        (typeof meta?.nudgeText === "string" && meta.nudgeText.trim()
          ? meta.nudgeText.trim()
          : "") ||
        (typeof meta?.trigger?.user_text === "string" &&
        meta.trigger.user_text.trim()
          ? meta.trigger.user_text.trim()
          : "") ||
        (typeof meta?.trigger?.userText === "string" &&
        meta.trigger.userText.trim()
          ? meta.trigger.userText.trim()
          : "") ||
        (snippet
          ? `💡 Selection sent to AI:\n${snippet}`
          : "💡 Selection received.");

      const resolvedPhase =
        phase ||
        meta?.phase ||
        meta?.trigger?.phase ||
        meta?.trigger?.current_phase_dc ||
        meta?.trigger?.current_phase_full ||
        null;

      if (resolvedPhase) {
        const theme = getPhaseTheme(resolvedPhase);
        // setPhaseTheme(theme);
        setShellThemeTemporarily(theme, 30_000);
      }

      const theme = resolvedPhase ? getPhaseTheme(resolvedPhase) : "neutral";

      // ✅ Log: proactive nudge appeared in chat
      await logBotEvent("proactive_nudge_shown", {
        role: resolvedType,
        phase: resolvedPhase || null,
        chipsCount: Array.isArray(resolvedChips) ? resolvedChips.length : 0,
        triggerId: meta?.triggerId || meta?.trigger?.id || null,
        triggerLabel: meta?.triggerLabel || meta?.trigger?.label || null,
        source: source || "trigger-chatbot",
        hasSnippet: !!snippet,
        textPreview: redactText(messageText, 300),
        dedupeKey: dedupeKey || null,
        tailShapeIdsCount: Array.isArray(meta?.tailShapeIds)
          ? meta.tailShapeIds.length
          : 0,
      });

      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: messageText,
          type: resolvedType,
          chips: resolvedChips,
          meta: {
            ...(meta || {}),
            source: source || "trigger-chatbot",
            phase: resolvedPhase || phase || meta?.phase || null,
            phaseTheme: theme,
            forceVisible: true,
          },
        },
      ]);
    };

    window.addEventListener("trigger-chatbot", handleExternalTrigger);
    return () =>
      window.removeEventListener("trigger-chatbot", handleExternalTrigger);
  }, [setMessages]);

  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      logBotEvent("bot_open_force", {});
    }
  }, [forceOpen]);

  const handleChipClick = async (chip, roleType, nudgeMsg) => {
    console.log("Chip clicked with nudgeMsg:", { chip, roleType, nudgeMsg });

    await logBotEvent("chip_click", {
      chip: redactText(chip, 300),
      role: String(roleType || "").toLowerCase(),
      triggerId: nudgeMsg?.meta?.triggerId || null,
      phase: nudgeMsg?.meta?.phase || null,
      tailShapeIdsCount: Array.isArray(nudgeMsg?.meta?.tailShapeIds)
        ? nudgeMsg.meta.tailShapeIds.length
        : 0,
      chipIndex: Array.isArray(nudgeMsg?.chips)
        ? nudgeMsg.chips.indexOf(chip)
        : -1,
      chipsCount: Array.isArray(nudgeMsg?.chips) ? nudgeMsg.chips.length : 0,
      nudgeSource: nudgeMsg?.meta?.source || null,
      messageType: nudgeMsg?.type || nudgeMsg?.role || null,
    });

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
        // image_urls: dedupe(imageUrls),
        source: meta.source || "phase_nudge",
      };
    } catch (e) {
      console.error("Failed to build nudgeContext:", e);
      nudgeContext = { error: "context_build_failed" };
    }

    const inferredTargets = Array.isArray(nudgeMsg?.meta?.tailShapeIds)
      ? nudgeMsg.meta.tailShapeIds
      : [];

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
      // { sender: "bot", text: `🔧 Running action: ${chip}` },
    ];
    setMessages(newMessages);
    setLoading(true);

    const resolvedRole = String(
      nudgeMsg?.role || nudgeMsg?.type || roleType || "catalyst"
    ).toLowerCase();

    try {
      const response = await fetch(
        "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/act",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chip,
            canvas_id: canvasId,
            role: resolvedRole,
            user_id,
            targets: inferredTargets.length ? inferredTargets : targets || [],
            params: {
              ...(params || {}),
              // helpful top-level keys
              phase: nudgeContext?.phase || null,
              triggerId: nudgeContext?.triggerId || null,
              tailShapeIds: nudgeContext?.tailShapeIds || [],
              windowIds: nudgeContext?.windowIds || [],
              // full context blob
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

      // const botReply = formatBotReply(
      //   result?.outputs?.find((o) => o?.type === "summary")?.content ??
      //     result?.output?.[0]?.content ??
      //     "Action completed."
      // );
      const primaryOutput =
        // 1) prefer summary if present
        // result?.outputs?.find((o) => o?.type === "summary")?.content ??
        // 2) otherwise take first output content (covers contrarian_ideas, etc.)
        result?.outputs?.[0]?.content ??
        // 3) last fallback
        "Action completed.";

      const botReply = formatBotReply(primaryOutput);

      // console.log(
      //   "[images] raw b64 count:",
      //   Array.isArray(b64s) ? b64s.length : 0
      // );
      console.log("[images] firebaseUrls:", firebaseUrls);

      setMessages([
        ...newMessages,
        {
          sender: "bot",
          text: botReply,
          type: resolvedRole,
          image_urls: firebaseUrls,
          meta: {
            phase: nudgeMsg?.meta?.phase || null,
            phaseTheme:
              nudgeMsg?.meta?.phaseTheme ||
              getPhaseTheme(nudgeMsg?.meta?.phase),
            source: "act-followup",
            triggerId: nudgeMsg?.meta?.triggerId || null,
            forceVisible: true,
            headerText: chip.length > 60 ? chip.slice(0, 60) + "…" : chip,
          },
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

  // useEffect(() => {
  //   if (!shapes || shapes.length === 0) return;

  //   const now = Date.now();
  //   const last = lastAnalyzeRef.current;
  //   const elapsed = last.time ? now - last.time : Infinity;
  //   const deltaMoves = shapes.length - (last.moveCount || 0);

  //   const shouldCall = elapsed >= 30_000 || deltaMoves >= 8;
  //   if (!shouldCall) return;

  //   runAnalyzeNudge("auto");
  // }, [shapes]);

  const runAnalyzeNudge = async (source = "auto") => {
    if (!shapes || !Array.isArray(shapes) || shapes.length === 0) return;

    if (source === "auto") {
      await logBotEvent("auto_nudge_analyze_start", {
        shapesCount: shapes.length,
      });
    }

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
      // const res = await fetch("http://127.0.0.1:8060/analyze", {
      // const res = await fetch("http://167.96.111.150:8060/analyze", {
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

      console.log("TAIL IDS FROM BACKEND:", tailShapeIds);

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

      await logBotEvent("nudge_result", {
        source,
        phase,
        meanConf,
        stablePhase,
        triggerId: trigger?.id || null,
        triggerLabel: trigger?.label || null,
        chipsCount: Array.isArray(chips) ? chips.length : 0,
        tailShapeIdsCount: tailShapeIds.length,
      });

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

      // let nudgeText = "";
      // let chips = [];
      // let nudgeType = "nudge";

      const phaseThemeValue = getPhaseTheme(phase);
      // setPhaseTheme(phaseThemeValue);
      setShellThemeTemporarily(phaseThemeValue, 30_000);

      // Prefer backend-provided nudge always
      const backendNudge = data.nudge || null;

      let nudgeText =
        backendNudge?.text ||
        trigger?.user_text ||
        "I analyzed your recent activity. If you'd like, I can suggest a helpful next step.";

      let chips =
        Array.isArray(backendNudge?.chips) && backendNudge.chips.length
          ? backendNudge.chips
          : Array.isArray(trigger?.chips) && trigger.chips.length
          ? trigger.chips
          : [];

      let nudgeType = String(
        backendNudge?.role || trigger?.role || "nudge"
      ).toLowerCase();

      // 🔗 let parent know which shapes were in the tail windows
      if (typeof onNudgeComputed === "function") {
        onNudgeComputed({
          currentPhase: current_phase,
          windows,
          tailShapeIds,
          trigger,
          metrics,
          source,
          nudgeText,
          nudgeType,
          chips,
          phase,
          backendNudge,
        });
      }

      // --- Decide whether to notify the user ---
      const nowTs = Date.now();
      const lastN = lastNotifiedRef.current || { triggerId: null, time: 0 };

      console.log("[trigger] :", trigger);

      const triggerId = trigger?.id || null;
      console.log("[nudge] triggerId:", triggerId);
      if (trigger?.id && typeof onTriggerFired === "function") {
        // props.onTriggerFired(trigger.id);
        onTriggerFired(trigger.id);
      }
      const isTriggerHit = !!triggerId;

      // Notify rules:
      // - If user clicked the bolt: optional short notice (not necessary, but ok)
      // - If auto: notify only when a trigger hits AND we haven’t notified recently for same trigger
      let shouldNotify = false;

      if (source === "button") {
        // optional: you can skip this since user requested it
        // shouldNotify = isTriggerHit; // or true if you want always
        shouldNotify = true; // or true if you want always
      } else {
        // auto
        if (isTriggerHit) {
          const changedTrigger = triggerId !== lastN.triggerId;
          const cooldownPassed =
            nowTs - (lastN.time || 0) > NUDGE_NOTIFY_COOLDOWN_MS;

          if (changedTrigger || cooldownPassed) {
            shouldNotify = true;
          }
        }
      }

      if (shouldNotify) {
        lastNotifiedRef.current = { triggerId, time: nowTs };

        // Text for notification
        const label = trigger?.label || triggerId || "a pattern";
        // if (shouldNotify && triggerId && typeof onTriggerFired === "function") {
        //   onTriggerFired(triggerId);
        // }

        // notifyUser(`Nudge triggered: ${label}`);
      }
      const msgTheme = getPhaseTheme(phase);

      // ✅ Log: analyze nudge appeared in chat
      await logBotEvent("nudge_shown", {
        source, // "auto" or "button"
        phase,
        meanConf: meanConf ?? null,
        stablePhase,
        triggerId: trigger?.id || null,
        triggerLabel: trigger?.label || null,
        role: nudgeType,
        chipsCount: Array.isArray(chips) ? chips.length : 0,
        tailShapeIdsCount: Array.isArray(tailShapeIds)
          ? tailShapeIds.length
          : 0,
        windowCount: Array.isArray(current_phase?.window_ids)
          ? current_phase.window_ids.length
          : 0,
        textPreview: redactText(nudgeText, 300),
      });

      setMessages((prev) => [
        ...prev,
        {
          sender: "bot",
          text: `\n${nudgeText}`,
          type: nudgeType,
          chips,
          meta: {
            phase,
            phaseTheme: msgTheme,
            source,
            tailShapeIds,
            windowIds: current_phase.window_ids || [],
            episodeId,
            triggerId: trigger?.id || null,
            forceVisible: true,
            triggerLabel: trigger?.label || backendNudge?.label || null,
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

  // const handleRequestNudges = () => runAnalyzeNudge("button");

  const handleRequestNudges = async () => {
    await logBotEvent("request_nudge_button", {
      shapesCount: shapes?.length || 0,
    });
    return runAnalyzeNudge("button");
  };

  // const toggleNudgeExpand = (idx) => {
  //   setMessages((prev) =>
  //     prev.map((m, i) => (i === idx ? { ...m, expanded: !m.expanded } : m))
  //   );
  // };

  const toggleNudgeExpand = async (idx) => {
    const msg = messages?.[idx];
    const nextExpanded = !msg?.expanded;

    await logBotEvent("nudge_toggle", {
      expanded: nextExpanded,
      msgIndex: idx,
      role: msg?.type || null,
      phase: msg?.meta?.phase || null,
      triggerId: msg?.meta?.triggerId || null,
      triggerLabel: msg?.meta?.triggerLabel || null,
      chipsCount: Array.isArray(msg?.chips) ? msg.chips.length : 0,
      tailShapeIdsCount: Array.isArray(msg?.meta?.tailShapeIds)
        ? msg.meta.tailShapeIds.length
        : 0,
      source: msg?.meta?.source || null,
    });

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

    await logBotEvent("send_message", {
      text: redactText(userInput),
      hasImages: (context.images || []).length,
      hasTexts: (context.texts || []).length,
      targetsCount: (targets || []).length,
    });

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

      await logBotEvent("bot_reply", {
        replyPreview: redactText(data.reply, 1000),
        imageCount: Array.isArray(data.image_urls) ? data.image_urls.length : 0,
        b64Count: Array.isArray(data.images_b64) ? data.images_b64.length : 0,
      });

      if (data.reply) {
        let imageUrlsFinal = [];

        // 1) base64 route (your existing path)
        const b64s = data.images_b64 || data.image_b64;
        if (Array.isArray(b64s) && b64s.length) {
          try {
            const firebaseUrls = await uploadManyB64ToFirebase(b64s, {
              canvasId,
              user_id,
              storage,
            });
            imageUrlsFinal = firebaseUrls;
          } catch (e) {
            console.error("Uploading images failed", e);
          }
        }

        // 2) URL route (✅ THIS is what your backend is sending)
        const urls = data.image_urls;
        if (!imageUrlsFinal.length && Array.isArray(urls) && urls.length) {
          try {
            // optional: mirror to Firebase for durability + easier copying
            const firebaseUrls = await mirrorAllImagesToFirebase(urls, {
              canvasId,
              user_id,
            });
            imageUrlsFinal = firebaseUrls;
          } catch (e) {
            console.error("Mirroring image_urls failed:", e);
            imageUrlsFinal = urls; // fallback to original signed URLs
          }
        }

        setMessages([
          ...newMessages,
          {
            sender: "bot",
            text: formatBotReply(data.reply),
            image_urls: imageUrlsFinal,
            previewUrl: extractFirstUrl(data.reply),
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

  // ---- Link parsing helpers ----
  const isHttpUrl = (s) => typeof s === "string" && /^https?:\/\/\S+$/i.test(s);

  // Splits a string into React nodes with:
  // - markdown links: [label](https://...)
  // - bare urls: https://...
  function renderRichInline(text, keyPrefix = "rt") {
    const str = String(text ?? "");
    const nodes = [];

    // (label)(https://url)  <-- YOUR CURRENT FORMAT
    const parenLinkRe = /\(([^)]+)\)\((https?:\/\/[^\s)]+)\)/g;

    // [label](https://url)  <-- markdown format
    const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

    // bare https://url
    // const urlRe = /(https?:\/\/[^\s<>()]+[^\s<>().,!?;:"')\]])/g;
    const urlRe = /((?:https?:\/\/|www\.)[^\s<>()]+[^\s<>().,!?;:"')\]])/g;

    // 1) tokenize (label)(url) first
    let parts = [];
    let last = 0;
    let m;

    while ((m = parenLinkRe.exec(str)) !== null) {
      const [full, label, url] = m;
      const start = m.index;
      const end = start + full.length;

      if (start > last)
        parts.push({ type: "text", value: str.slice(last, start) });
      parts.push({ type: "link", label, url });
      last = end;
    }
    if (last < str.length) parts.push({ type: "text", value: str.slice(last) });

    // 2) within remaining text parts, tokenize markdown links
    const parts2 = [];
    parts.forEach((p) => {
      if (p.type !== "text") return parts2.push(p);

      const chunk = p.value;
      let li = 0;
      let mm;
      while ((mm = mdLinkRe.exec(chunk)) !== null) {
        const [full, label, url] = mm;
        const s = mm.index;
        const e = s + full.length;

        if (s > li) parts2.push({ type: "text", value: chunk.slice(li, s) });
        parts2.push({ type: "link", label, url });
        li = e;
      }
      if (li < chunk.length)
        parts2.push({ type: "text", value: chunk.slice(li) });
    });

    // 3) within remaining text parts, auto-link bare URLs
    parts2.forEach((p, i) => {
      if (p.type === "link") {
        nodes.push(
          <a
            key={`${keyPrefix}-link-${i}`}
            href={p.url}
            target="_blank"
            rel="noopener noreferrer"
            className="chatbot-link"
          >
            {p.label}
          </a>
        );
        return;
      }

      const chunk = p.value;
      let li = 0;
      let mu;
      while ((mu = urlRe.exec(chunk)) !== null) {
        const url = mu[1];
        const s = mu.index;
        const e = s + url.length;

        if (s > li)
          nodes.push(
            <span key={`${keyPrefix}-t-${i}-${li}`}>{chunk.slice(li, s)}</span>
          );

        nodes.push(
          <a
            key={`${keyPrefix}-url-${i}-${s}`}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="chatbot-link"
          >
            {url}
          </a>
        );

        li = e;
      }
      if (li < chunk.length)
        nodes.push(
          <span key={`${keyPrefix}-tail-${i}-${li}`}>{chunk.slice(li)}</span>
        );
    });

    return nodes;
  }

  const extractFirstUrl = (text) => {
    const s = String(text || "");
    const m = s.match(/https?:\/\/[^\s)]+/i);
    return m ? m[0] : null;
  };

  const renderMessageText = (text) => {
    const lines = toLines(text);

    // Simple fenced code block support ```...```
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let listBuf = [];

    // const flushList = () => {
    //   if (!listBuf.length) return;

    //   out.push(
    //     <ul key={`list-${out.length}`} className="chatbot-list">
    //       {listBuf.map((li, idx) => (
    //         <li key={idx}>{li}</li>
    //       ))}
    //     </ul>
    //   );
    //   listBuf = [];
    // };

    const flushList = () => {
      if (!listBuf.length) return;

      const listKey = `list-${out.length}`;

      out.push(
        <ul key={listKey} className="chatbot-list">
          {listBuf.map((li, idx) => (
            <li key={`${listKey}-li-${idx}`}>
              {renderRichInline(li, `${listKey}-li-${idx}`)}
            </li>
          ))}
        </ul>
      );

      listBuf = [];
    };

    const flushCode = () => {
      if (!codeBuf.length) return;
      out.push(
        <pre key={`code-${out.length}`} className="chatbot-code">
          <code>{codeBuf.join("\n")}</code>
        </pre>
      );
      codeBuf = [];
    };

    lines.forEach((rawLine, i) => {
      const line = String(rawLine ?? "");

      // toggle fenced code
      if (line.trim().startsWith("```")) {
        if (inCode) {
          // closing
          flushCode();
          inCode = false;
        } else {
          // opening
          flushList();
          inCode = true;
        }
        return;
      }

      if (inCode) {
        codeBuf.push(line);
        return;
      }

      const bullet = line.match(/^\s*(?:-|\*|•)\s+(.*)$/);
      if (bullet) {
        listBuf.push(bullet[1]);
        return;
      }

      // flush any active list before normal paragraph
      flushList();

      // blank line -> spacing
      if (!line.trim()) {
        out.push(<div key={`sp-${i}`} className="chatbot-spacer" />);
        return;
      }

      out.push(
        <p key={`p-${i}`} className="chatbot-paragraph">
          {/* {line} */}
          {renderRichInline(line, `p-${i}`)}
        </p>
      );
    });

    flushList();
    if (inCode) flushCode();

    return out;
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
      await logBotEvent("copy_text", { key, length: (text || "").length });
    } catch (e) {
      console.error("Copy text failed:", e);
    }
  };

  const copySelectedOrAll = async (fallbackText, key) => {
    const sel = window.getSelection?.()?.toString?.() || "";
    const textToCopy = sel.trim() ? sel : fallbackText || "";
    await copyText(textToCopy, key);
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
      await logBotEvent("copy_image", { key, url: redactText(url, 800) });
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
      <div className={`chatbot-container chatbot-phase-${phaseTheme}`}>
        <div className="chatbot-header chatbot-drag">
          <div className="chatbot-header-left">
            <div className="chatbot-header-icon">
              <FontAwesomeIcon icon={faRobot} />
            </div>
            <div className="chatbot-header-text">
              <div className="chatbot-header-title">
                {variant === "floating" ? "PolyFlux AI" : "Chat History"}
              </div>
              <div className="chatbot-header-subtitle">
                Ask questions about your selection
              </div>
            </div>
          </div>

          <div className="chatbot-header-actions">
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
              title={nudgesLoading ? "Analyzing..." : "Get AI's help"}
              disabled={nudgesLoading}
            >
              <FontAwesomeIcon icon={faBolt} />
            </button>

            <button
              className="chatbot-header-btn"
              // onClick={() => setIsOpen(false)}
              onClick={() => {
                logBotEvent("bot_close", { variant });
                if (variant === "floating") {
                  setIsOpen(false);
                  onClose?.();
                } else {
                  toggleSidebar?.();
                  onClose?.();
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

            const msgPhase = msg.meta?.phase || null;
            const msgPhaseTheme = msgPhase
              ? getPhaseTheme(msgPhase)
              : "neutral";
            // const msgTheme = msgPhase ? getPhaseTheme(msgPhase) : "neutral";
            const msgTheme =
              msg.meta?.phaseTheme ||
              (msg.meta?.phase ? getPhaseTheme(msg.meta.phase) : "neutral");

            const isPhaseScopedNudge = isNudgeLike && !!msgPhase;
            const forceVisible = !!msg.meta?.forceVisible;

            // const isPhaseVisible =
            //   forceVisible ||
            //   !isPhaseScopedNudge ||
            //   msgPhaseTheme === "neutral" ||
            //   msgPhaseTheme === phaseTheme;

            // if (!isPhaseVisible) {
            //   return null;
            // }

            // const isNudgeLike =
            //   msg.type &&
            //   ["nudge", "provocateur", "communicator", "catalyst"].includes(
            //     msg.type
            //   );

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
                className={`chatbot-message ${msg.sender}
                ${hasFocusShape ? " chatbot-message--highlight" : ""}${
                  isNudgeLike ? " chatbot-message--nudge" : ""
                }
                chatbot-message-theme-${msgTheme}
                `}
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
                      {/* <span className="chatbot-nudge-pill">
                        AI nudge{" "}
                        {msg.meta?.triggerId ? `· ${msg.meta.triggerId}` : ""}
                        Predicted Phase:{" "}
                        {msg.meta?.phase ? `${msg.meta.phase}` : ""}
                      </span> */}
                      {/* {preview && (
                        <span className="chatbot-nudge-preview">{preview}</span>
                      )} */}
                      {/* <span className="chatbot-nudge-pill">
                        {getNudgeHeader({
                          phase: msg.meta?.phase,
                          triggerId: msg.meta?.triggerId,
                          triggerLabel: msg.meta?.triggerLabel,
                        })}
                      </span> */}
                      <span className="chatbot-nudge-pill">
                        {msg.meta?.headerText ||
                          getNudgeHeader({
                            phase: msg.meta?.phase,
                            triggerId: msg.meta?.triggerId,
                            triggerLabel: msg.meta?.triggerLabel,
                          })}
                      </span>
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
                        // onClick={() =>
                        //   copyText(toLines(msg.text).join("\n"), `msg-${idx}`)
                        // }
                        onClick={() =>
                          copySelectedOrAll(
                            toLines(msg.text).join("\n"),
                            `msg-${idx}`
                          )
                        }
                      >
                        <FontAwesomeIcon icon={faCopy} />
                      </button>
                    )}
                    {copiedKey === `msg-${idx}` && (
                      <span className="chatbot-copied-pill">Copied</span>
                    )}

                    {/* <div className="chatbot-message-body">
                      {toLines(msg.text).map((line, i) => (
                        <ul key={i} style={{ margin: 0 }}>
                          {line}
                        </ul>
                      ))}
                    </div> */}

                    <div className="chatbot-message-body chatbot-card">
                      {renderMessageText(msg.text)}
                    </div>

                    {msg.previewUrl && (
                      <div
                        className="chatbot-link-preview"
                        style={{ marginTop: 8 }}
                      >
                        <SimpleLinkPreview url={msg.previewUrl} />
                      </div>
                    )}

                    {/* {msg.type && (
                      <div className="chatbot-nudge-type">
                        <strong>Type:</strong> {msg.type}
                      </div>
                    )} */}

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

          {loading && (
            <div className="chatbot-message bot">Working on it...</div>
          )}
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
};

export default ChatBot;
