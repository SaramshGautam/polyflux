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
  faChevronDown,
  faTableColumns,
  faNoteSticky,
  faFont,
  faTrashCan,
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

// canvasId is a flat "<classroom>_<project>_<team>" string; this mirrors
// logBotEvent's toCanvasPath below since both need to turn it back into a
// Firestore path segment set. Shared here so the chip follow-through
// broadcasts (see handleChipClick's "Do a quick round" / "Create a shared
// prompt" branches) write to the exact same classrooms/.../teams/{team}
// path CollaborativeWhiteboard.js reads its "nudges" collection from.
function parseCanvasId(flatId) {
  const raw = String(flatId || "").trim();
  const parts = raw.split("_");
  const classroom = parts[0] || "unknown";
  const team = parts.length >= 2 ? parts[parts.length - 1] : "unknown";
  const project = parts.length >= 3 ? parts.slice(1, -1).join("_") : "unknown";
  return { classroom, project, team };
}

// BUG FIX (user report): the chat window used to always open pinned to
// the bottom-right corner of the screen (see the `position` useState
// default below), regardless of where the robot dock the user actually
// clicked to open it was. That felt disconnected — clicking a button in
// one place and having a panel appear somewhere unrelated. This computes
// a position right beside the dock instead, given its live on-screen
// rect (see CollaborativeWhiteboard.js's robotPosition/ROBOT_SIZE,
// passed through as the `dockAnchor` prop).
const CHAT_WINDOW_WIDTH = 400;
const CHAT_WINDOW_HEIGHT = 500;
const DOCK_CHAT_GAP_PX = 14;

function computePositionBesideDock(anchor) {
  if (!anchor) return null;

  const { left, right, top, bottom, size = 50, avoidBelowY } = anchor;
  const viewportW = window.innerWidth;
  const viewportH = window.innerHeight;

  // RobotDock (and CollaborativeWhiteboard's robotPosition state) uses
  // the same left/right/top/bottom convention as CSS `position: fixed` —
  // only one of each pair is normally set. Resolve to an absolute
  // left/top so we can do arithmetic regardless of which one was given.
  const ancLeft =
    typeof left === "number"
      ? left
      : typeof right === "number"
      ? viewportW - right - size
      : 16;

  const ancTop =
    typeof top === "number"
      ? top
      : typeof bottom === "number"
      ? viewportH - bottom - size
      : Math.max(8, viewportH - size - 16);

  // Prefer opening to the right of the dock (matches how it visually
  // reads: dock, then chat beside it). If that would push the window
  // past the right edge of the screen, open to the left of the dock
  // instead.
  let x = ancLeft + size + DOCK_CHAT_GAP_PX;
  if (x + CHAT_WINDOW_WIDTH > viewportW - 8) {
    x = ancLeft - CHAT_WINDOW_WIDTH - DOCK_CHAT_GAP_PX;
  }
  x = Math.max(8, Math.min(x, viewportW - CHAT_WINDOW_WIDTH - 8));

  // BUG FIX (user report): the window was landing lower than intended —
  // it was clamping only against the raw viewport bottom (8px margin),
  // which ignores that tldraw's own bottom nav/zoom panel (the same
  // element the dock positions itself above — see
  // CollaborativeWhiteboard.js's [data-navpanel="true"] tracking) sits in
  // that space too, so the window ended up overlapping/crowding it
  // instead of sitting a clean few pixels above it. `avoidBelowY` is that
  // panel's real live top edge; clamp the window's BOTTOM edge to stay
  // above it (with a small gap) instead of guessing a fixed pixel margin
  // from the raw viewport height. Falls back to the old viewport-relative
  // clamp when avoidBelowY isn't available (e.g. nav panel not mounted
  // yet).
  const maxBottom =
    typeof avoidBelowY === "number"
      ? avoidBelowY - DOCK_CHAT_GAP_PX
      : viewportH - 8;

  // Manual fine-tune knob: shift the final vertical position by this many
  // pixels (negative = up, positive = down) without changing the
  // underlying anchor/clamp logic above.
  const VERTICAL_OFFSET_PX = -50;

  const y = Math.max(
    8,
    Math.min(ancTop, maxBottom - CHAT_WINDOW_HEIGHT) + VERTICAL_OFFSET_PX
  );

  return { x, y };
}

// The two participation_imbalance_group chips that now DO something
// concrete instead of just replying in chat — see handleChipClick.
const QUICK_ROUND_CHIP = "Do a quick round: each person adds 1 idea";
const SHARED_PROMPT_CHIP = "Create a shared prompt for everyone to react to";
const QUICK_ROUND_ACK_CHIP = "I added mine ✓";

// Current participation_imbalance_group chip (triggers_engine.py). Must
// match that backend string exactly, same as the three above — this is a
// plain string equality check in handleChipClick, not a fuzzy match.
const INVITE_PARTICIPANTS_CHIP =
  "Suggestion: Ask other participants to add their ideas";

async function uploadB64ToFirebase({ storage, canvasId, b64, idx = 0 }) {
  const auth = getAuth();
  if (!auth.currentUser) {
    await signInAnonymously(auth);
  }
  const uid = auth.currentUser?.uid || "anon";

  const ts = Date.now();
  const canvasSafe = (canvasId || "canvas").replace(/[^\w.@-]/g, "_");
  const { b64: raw, contentType } = normalizeB64(b64);

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

  const path = `generated/${canvasSafe}/${uid}/${ts}-${idx}.${ext}`;

  const blob = b64ToBlob(raw, contentType);

  const ref = sRef(storage, path);

  await uploadBytes(ref, blob, {
    contentType,
    cacheControl: "public, max-age=31536000, immutable",
    customMetadata: {
      source: "chatbot",
      canvasId: String(canvasId || ""),
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

// cache so we don't re-upload the same source URL in one session
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

function getNudgeHeader({ phase, triggerId, triggerLabel, quoteText }) {
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
    return "Circling around same ideas. Try a new angle.";
  }

  // Early convergence
  if (t === "early_convergence") {
    return "Ideas are too concerntrated. Let's spread it out.";
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

  // Verbal, not captured. Unlike every trigger above, the useful part of
  // this one isn't a fixed phrase — it's the actual thing someone said
  // (see triggers_engine.py's _check_verbal_not_captured, which formats
  // the full message as `You mentioned "..." — want to add that to the
  // board?`). Pull the quote back out of quoteText (the message's own
  // full text, passed in by the caller) so the collapsed pill shows what
  // was actually said instead of a generic line — that's the whole point
  // of this trigger. Falls back to a generic line when there's no quote
  // to extract (the trigger's own no-quote fallback text, or an older
  // cached message from before this field existed).
  if (t === "verbal_not_captured") {
    const match = /"([^"]+)"/.exec(String(quoteText || ""));
    const quote = match?.[1]?.trim();
    if (quote) {
      const short = quote.length > 48 ? quote.slice(0, 45) + "…" : quote;
      return `You said: "${short}"`;
    }
    return "Something you said hasn't made it to the board yet.";
  }

  // Facilitation activities started via a chip follow-through (see
  // handleChipClick's QUICK_ROUND_CHIP / SHARED_PROMPT_CHIP branches)
  if (t === "quick_round_activity") {
    return "Quick round in progress — add your idea!";
  }
  if (t === "shared_prompt_activity") {
    return "A shared prompt was just posted for the group.";
  }

  // -----------------------
  // Fallback
  // -----------------------
  const nicePhase = p ? ` (${p})` : "";
  return `Noticing a pattern${nicePhase}. Want a quick next step?`;
}

const SimpleLinkPreview = ({ url, title }) => {
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
      {/* title comes from the backend's web_search "sites" list (the
          model's own citation title) when present — falls back to the
          bare hostname for the older single-preview-link usage. */}
      <div className="chatbot-link-preview-title">{title || host}</div>
      <div className="chatbot-link-preview-url">{url}</div>
    </a>
  );
};

// mode -> small badge shown above a bot reply's body, so it's obvious at a
// glance which context actually answered (see the /api/chatgpt-helper
// three-mode contract: "web_search" | "chatgpt_text" | "chatgpt_image").
const MODE_BADGES = {
  web_search: { icon: "🌐", label: "Web Search" },
  chatgpt_image: { icon: "🎨", label: "PolyFlux AI" },
  chatgpt_text: { icon: "✨", label: "PolyFlux AI" },
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
  moves,
  onNudgeComputed,
  nudgeFocusShapeId,
  onNudgeFocusComputed,
  variant = "floating",
  onTriggerFired,
  forceOpen = false,
  onClose,
  // Live on-screen rect of the robot dock (see RobotDock.js /
  // CollaborativeWhiteboard.js's robotPosition + ROBOT_SIZE), used so the
  // chat window opens right beside the dock instead of its old hardcoded
  // bottom-right-of-screen default. Shape: { left?, right?, top?, bottom?,
  // size } — same left/right/top/bottom convention RobotDock itself uses
  // (only one of left/right and one of top/bottom will typically be set).
  dockAnchor = null,
}) => {
  const [userInput, setUserInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clipNotes, setClipNotes] = useState([]);
  const [isSelectingFromCanvas, setIsSelectingFromCanvas] = useState(false);
  const [position, setPosition] = useState({
    x: window.innerWidth - 400 - 20,
    y: window.innerHeight - 540 - 20,
  });
  // BUG FIX (user report): resizing the chat window "relapsed back to
  // original size". Cause — the <Rnd> below was passed a hardcoded
  // literal `size={{ width: 400, height: 500 }}` instead of state. A
  // literal object makes Rnd a *controlled* component for size, so on
  // every re-render (which happens constantly — new message, loading
  // toggling, etc.) it snapped straight back to 400x500, undoing
  // whatever the user had just dragged it to. Tracking size in state
  // (like position already was) and feeding it back via onResizeStop
  // makes a resize stick while the window stays open — and the
  // forceOpen effect below explicitly resets it back to this default
  // every time the chat is reopened (e.g. by clicking the robot dock),
  // so a resize only persists for that one open session, not forever.
  const DEFAULT_RND_SIZE = { width: 400, height: 500 };
  const [rndSize, setRndSize] = useState(DEFAULT_RND_SIZE);
  const [copiedKey, setCopiedKey] = useState(null);
  const [nudgesLoading, setNudgesLoading] = useState(false);
  const [phaseTheme, setPhaseTheme] = useState("neutral");
  const lastExternalTriggerRef = useRef({ key: null, time: 0 });
  const EXTERNAL_TRIGGER_DEDUPE_MS = 2000;
  // Set while we're waiting for the user's next typed message to become
  // the broadcast text for "Create a shared prompt for everyone to react
  // to" (see handleChipClick / handleSend) — lets that chip reuse the
  // existing chat input instead of a separate modal.
  const pendingSharedPromptRef = useRef(false);
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

      // Firestore path: classrooms/{classroom}/Projects/{project}/teams/{team}/bot_logs
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
      // Don't break UX if logging fails
      console.error("[bot-log] failed:", e);
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
    if (forceOpen) {
      setIsOpen(true);
      // Snap to beside the robot dock every time it's opened this way
      // (i.e. by clicking the dock — see CollaborativeWhiteboard.js's
      // onOpenChat/chatbotOpen, the only thing that drives forceOpen).
      // The user can still drag it elsewhere afterward; this just fixes
      // where it lands by default instead of the old fixed bottom-right
      // corner.
      const besidePos = computePositionBesideDock(dockAnchor);
      if (besidePos) setPosition(besidePos);

      // BUG FIX (user report): a resize should only stick for the
      // session it happened in — closing and reopening (always via this
      // forceOpen path, the only way back in once closed) should restart
      // from the original scale rather than carry the last resize
      // forward indefinitely.
      setRndSize(DEFAULT_RND_SIZE);
    } else {
      // Clicking the robot dock now toggles chatbotOpen in
      // CollaborativeWhiteboard.js instead of only ever setting it true,
      // so forceOpen going false is a real "close" signal, not just its
      // default resting state — mirror what the in-widget X button
      // already does locally.
      setIsOpen(false);
    }
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
    // Option A: push a small bot "system" message (simple & reliable)
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
  const messagesEndRef = useRef(null);

  useEffect(() => {
    if (!messagesEndRef.current) return;
    messagesEndRef.current.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [messages, loading, isOpen]);

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

      // Defense-in-depth, same rationale as runAnalyzeNudge's check above:
      // whatever dispatched this "trigger-chatbot" event (CollaborativeWhiteboard's
      // pushNudgeToChatbot, or the "nudges" Firestore listener) is supposed to
      // have already filtered out private triggers meant for someone else
      // before dispatching. Re-checking here means a bug in either of those
      // dispatch sites can't leak a private nudge onto this client too.
      const detailTrigger = meta?.trigger || null;
      const detailScope = meta?.scope || detailTrigger?.scope || null;
      const detailTargetActor =
        meta?.target_actor ||
        meta?.targetActor ||
        detailTrigger?.target_actor ||
        detailTrigger?.targetActor ||
        null;
      if (
        detailScope &&
        detailScope !== "public" &&
        detailTargetActor &&
        detailTargetActor !== user_id
      ) {
        console.debug(
          "[nudge] suppressing private trigger-chatbot event not targeted at this actor",
          { triggerId: detailTrigger?.id, targetActor: detailTargetActor }
        );
        return;
      }

      // Proactive/public nudges are now surfaced first as a toast beside
      // the robot dock (see CollaborativeWhiteboard's showDockToast) —
      // this used to force the whole chat window open the instant a nudge
      // arrived, which is exactly what the toast is meant to replace.
      // Opening now happens only when the user clicks Accept on that
      // toast (RobotDock's onAcceptToast -> setChatbotOpen(true) ->
      // forceOpen below). Any other trigger source (explicit selection
      // sends, "open chat for this shape", etc.) still opens immediately
      // since those are direct user actions, not unprompted nudges.
      const isProactiveNudge =
        source === "public-nudge" || source === "auto-nudge";
      if (!isProactiveNudge) {
        setIsOpen(true);
      }

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

      // ---- clip notes logic ----
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

      // BUG FIX (user report): the floating "Ask AI" hover button (and
      // "open chat for this shape" from the context menu) both dispatch
      // trigger-chatbot via buildAiPayloadFromSelection, which only ever
      // carries snippet/source/position/image_urls/meta{type,selection}
      // — no real trigger/nudge data. That used to still get pushed into
      // the chat as a generic nudge-styled message ("Noticing a pattern.
      // Want a quick next step?" + "Selection sent to AI: ..."), which
      // was just noise ahead of whatever the user was actually about to
      // ask — the clip-note population above and opening the chat
      // already surface the selection; no separate announcement message
      // is needed. Any REAL nudge/trigger always sets at least one of
      // these (text, chips, a role, or meta.trigger), so this only
      // matches the bare selection-send case.
      const isPlainSelectionSend =
        !text &&
        !meta?.trigger &&
        !meta?.nudgeText &&
        !roleType &&
        !type &&
        !(Array.isArray(chips) && chips.length) &&
        !(Array.isArray(meta?.chips) && meta.chips.length);

      if (isPlainSelectionSend) return;

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
        setShellThemeTemporarily(theme, 30_000);
      }

      const theme = resolvedPhase ? getPhaseTheme(resolvedPhase) : "neutral";

      // Log: proactive nudge appeared in chat
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
            // CALIBRATION: normalize triggerId/dedupeKey/score onto the
            // message's top-level meta regardless of whether the caller
            // nested them under meta.trigger or passed them flat — so
            // handleChipClick's nudgeMsg?.meta?.dedupeKey reads reliably no
            // matter which path (runAnalyzeNudge vs. this handler) produced
            // the message. Without a consistent join key here, chip_click
            // engagement events for externally-pushed nudges (e.g.
            // long_lull's public broadcast) couldn't be matched back to the
            // backend's nudge_events fire record at analysis time.
            triggerId: meta?.triggerId || meta?.trigger?.id || null,
            dedupeKey: dedupeKey || null,
            score: meta?.trigger?.score ?? meta?.score ?? null,
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

  // Broadcasts a real, structured activity to every connected participant
  // by reusing the SAME Firestore "nudges" collection + onSnapshot
  // listener CollaborativeWhiteboard.js already built for public-scope
  // triggers (see the trigger-chatbot dispatch there). Writing here is
  // enough for every other client to render it — this component doesn't
  // have className/projectName/teamName as separate props, only the flat
  // canvasId, so parseCanvasId reconstructs the same path segments.
  const broadcastActivityNudge = async (trigger) => {
    const { classroom, project, team } = parseCanvasId(canvasId);
    const nudgesRef = collection(
      db,
      "classrooms",
      classroom,
      "Projects",
      project,
      "teams",
      team,
      "nudges"
    );
    const auth = getAuth();
    await addDoc(nudgesRef, {
      trigger,
      tailShapeIds: [],
      metrics: null,
      publishedBy: auth.currentUser?.uid || "anon",
      createdAt: serverTimestamp(),
      expiresAt: Date.now() + 180_000,
    });
  };

  const handleChipClick = async (chip, roleType, nudgeMsg) => {
    // --- Facilitation chips that DO something concrete instead of just
    // replying in chat (see triggers_engine.py's participation_imbalance_
    // group trigger, and the design note there about why these two
    // specific chips exist) ---
    if (chip === QUICK_ROUND_CHIP) {
      await logBotEvent("chip_click", {
        chip: redactText(chip, 300),
        role: String(roleType || "").toLowerCase(),
        triggerId: nudgeMsg?.meta?.triggerId || null,
        // CALIBRATION: join key back to the backend's nudge_events fire
        // record (see app.py's write_nudge_event) and to this same
        // message's nudge_shown log — see calibration/analyze_calibration.py.
        dedupeKey: nudgeMsg?.meta?.dedupeKey || null,
      });
      const roundMessages = [...messages, { sender: "user", text: chip }];
      setMessages(roundMessages);
      try {
        await broadcastActivityNudge({
          id: "quick_round_activity",
          scope: "public",
          role: "communicator",
          label: "Quick round",
          user_text:
            "🎯 Quick round! Everyone, take a moment to add one idea to the board.",
          chips: [QUICK_ROUND_ACK_CHIP],
        });
        setMessages([
          ...roundMessages,
          {
            sender: "bot",
            text: "Round started — everyone else in the session just got this prompt too. Add your own idea, then let us know:",
            chips: [QUICK_ROUND_ACK_CHIP],
          },
        ]);
      } catch (e) {
        console.error("Failed to broadcast quick round:", e);
        setMessages([
          ...roundMessages,
          {
            sender: "bot",
            text: "Couldn't start the round — please try again.",
          },
        ]);
      }
      return;
    }

    if (chip === QUICK_ROUND_ACK_CHIP) {
      await logBotEvent("chip_click", { chip: redactText(chip, 300) });
      setMessages([
        ...messages,
        { sender: "user", text: chip },
        { sender: "bot", text: "Nice — noted! 🙌" },
      ]);
      return;
    }

    if (chip === SHARED_PROMPT_CHIP) {
      await logBotEvent("chip_click", {
        chip: redactText(chip, 300),
        role: String(roleType || "").toLowerCase(),
        triggerId: nudgeMsg?.meta?.triggerId || null,
        dedupeKey: nudgeMsg?.meta?.dedupeKey || null,
      });
      pendingSharedPromptRef.current = true;
      setMessages([
        ...messages,
        { sender: "user", text: chip },
        {
          sender: "bot",
          text: "What should the shared prompt be? Type it below and send it — I'll share it with everyone in the session.",
        },
      ]);
      return;
    }

    if (chip === INVITE_PARTICIPANTS_CHIP) {
      await logBotEvent("chip_click", {
        chip: redactText(chip, 300),
        role: String(roleType || "").toLowerCase(),
        triggerId: nudgeMsg?.meta?.triggerId || null,
        dedupeKey: nudgeMsg?.meta?.dedupeKey || null,
      });
      const askerId = user_id || "A teammate";
      const askMessages = [...messages, { sender: "user", text: chip }];
      setMessages(askMessages);
      try {
        // broadcastActivityNudge writes a public nudge to Firestore that
        // every OTHER connected client picks up via the "nudges"
        // onSnapshot listener in CollaborativeWhiteboard.js and renders
        // as a chat message — that listener already filters out the
        // publisher's own client (see the publishedBy === myUid check
        // there), so this reaches everyone except the person who clicked.
        await broadcastActivityNudge({
          id: "participation_imbalance_group",
          scope: "public",
          role: "communicator",
          label: "Participation imbalance",
          user_text: `📣 ${askerId} is asking you to add your ideas.`,
        });
        setMessages([
          ...askMessages,
          { sender: "bot", text: "Done — I let the team know." },
        ]);
      } catch (e) {
        console.error("Failed to broadcast participation invite:", e);
        setMessages([
          ...askMessages,
          { sender: "bot", text: "Couldn't send that — try again?" },
        ]);
      }
      return;
    }

    await logBotEvent("chip_click", {
      chip: redactText(chip, 300),
      role: String(roleType || "").toLowerCase(),
      triggerId: nudgeMsg?.meta?.triggerId || null,
      dedupeKey: nudgeMsg?.meta?.dedupeKey || null,
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
        source: meta.source || "phase_nudge",
      };
    } catch (e) {
      console.error("Failed to build nudgeContext:", e);
      nudgeContext = { error: "context_build_failed" };
    }

    const inferredTargets = Array.isArray(nudgeMsg?.meta?.tailShapeIds)
      ? nudgeMsg.meta.tailShapeIds
      : [];

    const newMessages = [...messages, { sender: "user", text: chip }];
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
              phase: nudgeContext?.phase || null,
              triggerId: nudgeContext?.triggerId || null,
              tailShapeIds: nudgeContext?.tailShapeIds || [],
              windowIds: nudgeContext?.windowIds || [],
              nudge_context: nudgeContext,
            },
          }),
        }
      );

      const data = await response.json();

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

      const primaryOutput =
        result?.outputs?.[0]?.content ?? "Action completed.";

      const botReply = formatBotReply(primaryOutput);

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

  const runAnalyzeNudge = async (source = "auto") => {
    const hasShapes = Array.isArray(shapes) && shapes.length > 0;
    const hasMoves = Array.isArray(moves) && moves.length > 0;
    if (!hasShapes && !hasMoves) return;

    if (source === "auto") {
      await logBotEvent("auto_nudge_analyze_start", {
        shapesCount: hasShapes ? shapes.length : 0,
        movesCount: hasMoves ? moves.length : 0,
      });
    }

    const now = Date.now();
    const last = lastAnalyzeRef.current || {
      time: 0,
      moveCount: 0,
      inFlight: false,
    };

    // HYBRID TRIGGER — only for auto mode. Prefer moves.length as the
    // activity signal when we have it (a real count of discrete
    // interaction events), falling back to shapes.length — the previous
    // and only available proxy — when moves isn't populated yet.
    const activityCount = hasMoves
      ? moves.length
      : hasShapes
      ? shapes.length
      : 0;

    if (source === "auto") {
      const elapsed = now - (last.time || 0); // ms
      const moveDelta = activityCount - (last.moveCount || 0);

      // If not enough time and not enough new moves, skip
      if (elapsed < 30_000 && moveDelta < 6) {
        return;
      }
    }

    // Prevent overlapping calls
    if (last.inFlight) return;
    lastAnalyzeRef.current.inFlight = true;
    setNudgesLoading(true);

    // Only show "Analyzing…" if the user explicitly clicked
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
      const res = await fetch(
        "https://prediction-backend-g5x7odgpiq-uc.a.run.app/analyze",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            episode_id: episodeId,
            // Real per-person identity of whoever clicked "analyze" —
            // user_id is now resolveMyActorId(auth.currentUser) at the
            // call site (CollaborativeWhiteboard.js), the same string
            // tagged on this person's own moves, so the backend can
            // deliver (or queue, see app.py's _queue_pending_nudge) a
            // private trigger to the right person.
            actor_id: user_id,
            shapes: hasShapes ? shapes : [],
            // Real interaction-event stream, preferred by the backend
            // over reconstructing moves from `shapes` when present (see
            // export_buffer_moves_to_episode in
            // phase_prediction_pipeline.py).
            moves: hasMoves ? moves : [],
            window_sec: 15,
            min_link: 0.5,
            tail_window_count: 6, // match backend default
          }),
        }
      );

      const data = await res.json();

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

      // Defense-in-depth: app.py's /analyze already refuses to put a
      // privately-targeted trigger (participation_imbalance_group,
      // verbal_not_captured, etc.) in the response for anyone but its
      // target_actor — it queues it for that person's own next poll
      // instead (see _queue_pending_nudge/_pop_pending_nudge). This
      // mirrors that same check client-side, the same pattern
      // CollaborativeWhiteboard.js's pushNudgeToChatbot already uses, so
      // a bug or a future change on the server side can't surface someone
      // else's private nudge in this chat window.
      if (
        trigger?.scope &&
        trigger.scope !== "public" &&
        trigger.target_actor &&
        trigger.target_actor !== user_id
      ) {
        console.debug(
          "[nudge] suppressing private trigger not targeted at this actor",
          { triggerId: trigger.id, targetActor: trigger.target_actor }
        );
        return;
      }

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
              text: "I couldn't detect any stable windows of activity yet. Try working on the canvas a bit more first.",
            },
          ]);
        }
        return;
      }

      // PHASE CONFIDENCE + STABILITY GATING
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

      // Prefer backend-provided nudge always — computed early because the
      // logging call right below (and the button-mode gate after it) both
      // need to read `chips`/`nudgeText`/`nudgeType`.
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

      // For auto mode: if not stable or not confident, silently skip
      if (source === "auto" && (!stablePhase || !confidenceHigh)) {
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

      // For button mode: tell the user if it's too noisy
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

      const phaseLine = confPct
        ? `I'm pretty sure you're in a ${phaseNice.toLowerCase()} phase (about ${confPct}% confident).`
        : `It looks like you're in a ${phaseNice.toLowerCase()} phase.`;

      const phaseThemeValue = getPhaseTheme(phase);
      setShellThemeTemporarily(phaseThemeValue, 30_000);

      // let parent know which shapes were in the tail windows
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

      const triggerId = trigger?.id || null;
      if (trigger?.id && typeof onTriggerFired === "function") {
        onTriggerFired(trigger.id);
      }
      const isTriggerHit = !!triggerId;

      // Notify rules:
      // - If user clicked the bolt: optional short notice (not necessary, but ok)
      // - If auto: notify only when a trigger hits AND we haven't notified recently for same trigger
      let shouldNotify = false;

      if (source === "button") {
        shouldNotify = true;
      } else {
        // auto
        if (isTriggerHit) {
          const changedTrigger = triggerId !== lastN.triggerId;
          // BUG FIX: use the backend's own per-trigger cooldown_sec (see
          // app.py's /analyze response and triggers_engine.py's
          // get_trigger_cooldown_sec — 120s vs 300s depending on trigger
          // id) instead of the fixed NUDGE_NOTIFY_COOLDOWN_MS for every
          // trigger. Same fix as CollaborativeWhiteboard.js's
          // pushNudgeToChatbot; NUDGE_NOTIFY_COOLDOWN_MS remains the
          // fallback for responses that don't carry cooldown_sec.
          const triggerCooldownMs =
            typeof trigger?.cooldown_sec === "number" &&
            trigger.cooldown_sec > 0
              ? trigger.cooldown_sec * 1000
              : NUDGE_NOTIFY_COOLDOWN_MS;
          const cooldownPassed =
            nowTs - (lastN.time || 0) > triggerCooldownMs;

          if (changedTrigger || cooldownPassed) {
            shouldNotify = true;
          }
        }
      }

      // BUG FIX: shouldNotify was computed above per the "notify only when
      // a trigger hits AND we haven't notified recently" rule, but nothing
      // actually gated the logBotEvent/setMessages calls below on it — they
      // ran unconditionally, so "auto" mode pushed a chat message on every
      // successful poll: either the real trigger text, or (when trigger was
      // null — including the now-common case where a private trigger fired
      // but was queued for someone else, see the target_actor gate above)
      // the generic "I analyzed your recent activity..." filler. Bailing
      // out here when shouldNotify is false restores the documented intent:
      // auto-mode stays silent unless there's something new to say. Button
      // mode is unaffected — shouldNotify is always true for it.
      if (!shouldNotify) {
        lastAnalyzeRef.current.time = now;
        lastAnalyzeRef.current.moveCount = activityCount;
        return;
      }
      lastNotifiedRef.current = { triggerId, time: nowTs };
      const msgTheme = getPhaseTheme(phase);

      // Log: analyze nudge appeared in chat
      // CALIBRATION: score + dedupeKey added so this event can be joined
      // (via dedupeKey) against the backend's nudge_events fire record —
      // see app.py's write_nudge_event call — which carries the same
      // dedupeKey plus the raw metric snapshot the trigger fired on. score
      // alone wasn't previously sent from the backend to the frontend at
      // all (trigger_res.score was computed for ranking, then discarded);
      // see the "score" key added to fresh_trigger_payload in app.py.
      await logBotEvent("nudge_shown", {
        source, // "auto" or "button"
        phase,
        meanConf: meanConf ?? null,
        stablePhase,
        triggerId: trigger?.id || null,
        triggerLabel: trigger?.label || null,
        dedupeKey: trigger?.dedupe_key || null,
        score: typeof trigger?.score === "number" ? trigger.score : null,
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
            // CALIBRATION: carried on the message so handleChipClick can
            // stamp any resulting chip_click with the same join key (see
            // the dedupeKey field added to each chip_click logBotEvent
            // call below).
            dedupeKey: trigger?.dedupe_key || null,
            score: typeof trigger?.score === "number" ? trigger.score : null,
          },
        },
      ]);

      lastAnalyzeRef.current.time = now;
      lastAnalyzeRef.current.moveCount = activityCount;
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

  const handleRequestNudges = async () => {
    await logBotEvent("request_nudge_button", {
      shapesCount: shapes?.length || 0,
    });
    return runAnalyzeNudge("button");
  };

  const toggleNudgeExpand = async (idx) => {
    const msg = messages?.[idx];
    const currentlyExpanded = msg?.expanded !== false;
    const nextExpanded = !currentlyExpanded;

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
      prev.map((m, i) => (i === idx ? { ...m, expanded: nextExpanded } : m))
    );
  };

  // Shared by handleSend (a brand-new user message) and
  // handleSwitchChipClick (re-asking the SAME message under a different
  // forced mode) — this is everything from "call /api/chatgpt-helper"
  // through "turn the response into a bot message", parameterized by
  // whether a user bubble needs adding first and whether a force_mode
  // override should be sent.
  //
  // Backend contract (see app.py's three-mode rewrite): every reply now
  // carries `mode` ("web_search" | "chatgpt_text" | "chatgpt_image"), an
  // optional `sites` array ({title, url} pairs from real web citations,
  // web_search only), and a `suggested_switch` ({label, mode}) chip meant
  // to offer the other side — clicking it is exactly what
  // handleSwitchChipClick does, resending this same text with force_mode
  // set to that chip's mode.
  const sendChatMessage = async (
    text,
    { forceMode = null, appendUserBubble = false } = {}
  ) => {
    const context = gatherContextFromClips(clipNotes);

    let baseMessages = messages;
    if (appendUserBubble) {
      baseMessages = [
        ...messages,
        {
          sender: "user",
          text,
          image_urls: context.images,
          attached_texts: context.texts,
        },
      ];
      setMessages(baseMessages);
    }

    const history = buildHistoryForBackend(baseMessages);

    setLoading(true);
    try {
      // Backend now requires a real Firebase ID token (see /api/chatgpt-helper
      // server-side changes) instead of trusting a client-supplied user_id.
      const auth = getAuth();
      const idToken = await auth.currentUser?.getIdToken();

      if (!idToken) {
        setMessages([
          ...baseMessages,
          {
            sender: "bot",
            text: "You need to be signed in to chat with the AI.",
          },
        ]);
        return;
      }

      const body = {
        message: text,
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
      };
      if (forceMode) body.force_mode = forceMode;

      const response = await fetch(
        "https://flask-app-jqwkqdscaq-uc.a.run.app/api/chatgpt-helper",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${idToken}`,
          },
          body: JSON.stringify(body),
        }
      );

      const data = await response.json();

      if (!response.ok) {
        const errMsg =
          response.status === 401
            ? "You need to be signed in to chat with the AI."
            : response.status === 429
            ? "You're sending messages a bit too quickly — please wait a moment and try again."
            : data?.error || "Something went wrong.";

        setMessages([...baseMessages, { sender: "bot", text: errMsg }]);
        return;
      }

      await logBotEvent("bot_reply", {
        replyPreview: redactText(data.reply, 1000),
        imageCount: Array.isArray(data.image_urls) ? data.image_urls.length : 0,
        b64Count: Array.isArray(data.images_b64) ? data.images_b64.length : 0,
        mode: data.mode || null,
        sitesCount: Array.isArray(data.sites) ? data.sites.length : 0,
        forcedMode: forceMode || null,
      });

      const hasSites = Array.isArray(data.sites) && data.sites.length > 0;

      if (data.reply || hasSites) {
        let imageUrlsFinal = [];

        // 1) base64 route (AI-generated art, or web_search's real-photo
        // grid — both come back the same way from the backend)
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

        // 2) URL route
        const urls = data.image_urls;
        if (!imageUrlsFinal.length && Array.isArray(urls) && urls.length) {
          try {
            // mirror to Firebase for durability + easier copying
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
          ...baseMessages,
          {
            sender: "bot",
            text: formatBotReply(data.reply || ""),
            image_urls: imageUrlsFinal,
            previewUrl: extractFirstUrl(data.reply),
            mode: data.mode || null,
            sites: Array.isArray(data.sites) ? data.sites : [],
            suggestedSwitch: data.suggested_switch || null,
            // Stashed so the suggested_switch chip can resend this exact
            // text later — see handleSwitchChipClick.
            originalUserText: text,
          },
        ]);
      } else {
        setMessages([
          ...baseMessages,
          { sender: "bot", text: "Something went wrong." },
        ]);
      }
    } catch (error) {
      console.error(error);
      setMessages([
        ...baseMessages,
        { sender: "bot", text: "Error connecting to server." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!userInput.trim()) return;

    // Follow-through for the "Create a shared prompt for everyone to
    // react to" chip (see handleChipClick) — the NEXT message the user
    // sends becomes the broadcast prompt instead of going to the AI.
    if (pendingSharedPromptRef.current) {
      pendingSharedPromptRef.current = false;
      const promptText = userInput.trim();
      const sentMessages = [...messages, { sender: "user", text: promptText }];
      setMessages(sentMessages);
      setUserInput("");
      try {
        await broadcastActivityNudge({
          id: "shared_prompt_activity",
          scope: "public",
          role: "communicator",
          label: "Shared prompt",
          user_text: `📢 Shared prompt from the group: "${promptText}" — what do you think?`,
          chips: [],
        });
        setMessages([
          ...sentMessages,
          {
            sender: "bot",
            text: "Shared with everyone in the session.",
          },
        ]);
      } catch (e) {
        console.error("Failed to broadcast shared prompt:", e);
        setMessages([
          ...sentMessages,
          { sender: "bot", text: "Couldn't share that — please try again." },
        ]);
      }
      return;
    }

    const textToSend = userInput;
    const context = gatherContextFromClips(clipNotes);

    await logBotEvent("send_message", {
      text: redactText(textToSend),
      hasImages: (context.images || []).length,
      hasTexts: (context.texts || []).length,
      targetsCount: (targets || []).length,
    });

    setUserInput("");
    await sendChatMessage(textToSend, { appendUserBubble: true });
  };

  // Follow-through for a bot reply's "suggested_switch" chip (see the
  // sendChatMessage doc comment above) — re-asks the SAME original
  // question with force_mode set to whichever mode the chip points at, and
  // does NOT add a new user bubble, since it's the same question, just
  // answered a different way.
  const handleSwitchChipClick = async (msg) => {
    const target = msg?.suggestedSwitch;
    if (!target?.mode || !msg?.originalUserText) return;

    await logBotEvent("switch_chip_click", {
      fromMode: msg?.mode || null,
      toMode: target.mode,
      label: redactText(target.label, 200),
    });

    await sendChatMessage(msg.originalUserText, {
      forceMode: target.mode,
      appendUserBubble: false,
    });
  };

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

    // (label)(https://url)  <-- current format
    const parenLinkRe = /\(([^)]+)\)\((https?:\/\/[^\s)]+)\)/g;

    // [label](https://url)  <-- markdown format
    const mdLinkRe = /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g;

    // bare https://url
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

  // msgIdx (the message's index in the messages array) makes each list
  // item's copy/add-as-note/add-as-text key globally unique across the
  // whole conversation, not just within this one call.
  const renderMessageText = (text, msgIdx = 0) => {
    const lines = toLines(text);

    // Simple fenced code block support ```...```
    const out = [];
    let inCode = false;
    let codeBuf = [];
    let listBuf = [];

    const flushList = () => {
      if (!listBuf.length) return;

      const listKey = `list-${out.length}`;

      out.push(
        <div key={listKey} className="chatbot-list">
          {listBuf.map((item, i) => {
            const itemBase = `${msgIdx}-${listKey}-${i}`;
            const copyKey = `copy-${itemBase}`;
            const noteKey = `note-${itemBase}`;
            const textKey = `text-${itemBase}`;

            return (
              <div key={`${listKey}-li-${i}`} className="chatbot-list-item">
                <span className="chatbot-list-item-marker">{item.marker}</span>
                <span className="chatbot-list-item-text">
                  {renderRichInline(item.text, `${listKey}-li-${i}`)}
                </span>

                <div className="chatbot-list-item-actions">
                  <button
                    type="button"
                    className="chatbot-list-item-btn"
                    title="Copy"
                    onClick={() => copyText(item.text, copyKey)}
                  >
                    <FontAwesomeIcon icon={faCopy} />
                  </button>
                  <button
                    type="button"
                    className="chatbot-list-item-btn"
                    title="Add as note"
                    onClick={() => addToCanvas("note", item.text, noteKey)}
                  >
                    <FontAwesomeIcon icon={faNoteSticky} />
                  </button>
                  <button
                    type="button"
                    className="chatbot-list-item-btn"
                    title="Add as text"
                    onClick={() => addToCanvas("text", item.text, textKey)}
                  >
                    <FontAwesomeIcon icon={faFont} />
                  </button>
                </div>

                {copiedKey === copyKey && (
                  <span className="chatbot-list-item-pill">Copied</span>
                )}
                {(copiedKey === noteKey || copiedKey === textKey) && (
                  <span className="chatbot-list-item-pill">Added</span>
                )}
              </div>
            );
          })}
        </div>
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

      const ordered = line.match(/^\s*(\d+)[.)]\s+(.*)$/);
      const bullet = !ordered && line.match(/^\s*(?:-|\*|•)\s+(.*)$/);
      if (ordered || bullet) {
        listBuf.push({
          marker: ordered ? `${ordered[1]}.` : "•",
          text: ordered ? ordered[2] : bullet[1],
        });
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
    if (!Array.isArray(clips)) {
      return { images: [], texts: [] };
    }

    const images = [];
    const texts = [];

    clips.forEach((c) => {
      const snip = c?.snip;

      if (!snip) return;

      // 1. Hosted HTTPS image?
      if (typeof snip === "string" && /^https?:\/\//i.test(snip)) {
        images.push(snip);
        return;
      }

      // 2. Base64 data URL?
      if (typeof snip === "string" && snip.startsWith("data:image/")) {
        texts.push("[canvas image selected]");
        return;
      }

      // 3. Anything else → treat as text
      if (typeof snip === "string" && snip.trim()) {
        texts.push(snip.trim());
        return;
      }
    });

    const ctx = {
      images: dedupeBy(images, (x) => x),
      texts: dedupeBy(texts, (x) => x),
    };

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

  // Drops a single reply item onto the canvas as a "note" or "text"
  // shape. ChatBot doesn't hold a live tldraw editor reference itself —
  // CollaborativeWhiteboard.js does — so this just broadcasts, the same
  // way chatbot-request-selection already does for the opposite
  // direction (canvas -> chat). See CollaborativeWhiteboard.js's
  // handleAddShapeFromChat listener for where the shape actually gets
  // created.
  const addToCanvas = async (kind, text, key) => {
    const content = String(text || "").trim();
    if (!content) return;
    try {
      window.dispatchEvent(
        new CustomEvent("chatbot-add-shape", { detail: { kind, content } })
      );
      badgePing(key);
      await logBotEvent(kind === "note" ? "add_as_note" : "add_as_text", {
        key,
        length: content.length,
      });
    } catch (e) {
      console.error("Add to canvas failed:", e);
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
                title="Open chat sidebar"
              >
                <FontAwesomeIcon icon={faTableColumns} />
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
            const msgTheme =
              msg.meta?.phaseTheme ||
              (msg.meta?.phase ? getPhaseTheme(msg.meta.phase) : "neutral");

            const isPhaseScopedNudge = isNudgeLike && !!msgPhase;
            const forceVisible = !!msg.meta?.forceVisible;

            const isExpanded = !isNudgeLike || msg.expanded !== false;
            const lines = toLines(msg.text);
            const hasVisibleBody =
              lines.some((l) => String(l ?? "").trim()) ||
              (Array.isArray(msg.chips) && msg.chips.length > 0) ||
              (Array.isArray(msg.image_urls) && msg.image_urls.length > 0) ||
              (Array.isArray(msg.attached_texts) &&
                msg.attached_texts.length > 0);
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
                      <span
                        className={`chatbot-nudge-dot chatbot-nudge-dot-${msgTheme}`}
                        aria-hidden="true"
                      />
                      <span className="chatbot-nudge-pill">
                        {msg.meta?.headerText ||
                          getNudgeHeader({
                            phase: msg.meta?.phase,
                            triggerId: msg.meta?.triggerId,
                            triggerLabel: msg.meta?.triggerLabel,
                            quoteText: msg.text,
                          })}
                      </span>
                    </div>
                    <div
                      className={`chatbot-nudge-toggle${
                        isExpanded ? " is-open" : ""
                      }`}
                    >
                      <FontAwesomeIcon icon={faChevronDown} />
                    </div>
                  </div>
                )}

                {/* Only show full body when expanded (or if not a nudge) */}
                {isExpanded && (
                  <div
                    className={`chatbot-message-reveal${
                      isNudgeLike && !hasVisibleBody
                        ? " chatbot-message-reveal--empty"
                        : ""
                    }`}
                  >
                    {msg.sender === "bot" && (
                      <button
                        className="chatbot-copy-btn"
                        title="Copy reply"
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

                    {msg.mode && MODE_BADGES[msg.mode] && (
                      <div
                        className={`chatbot-mode-badge chatbot-mode-badge--${msg.mode}`}
                      >
                        <span aria-hidden="true">
                          {MODE_BADGES[msg.mode].icon}
                        </span>
                        {MODE_BADGES[msg.mode].label}
                      </div>
                    )}

                    <div className="chatbot-message-body chatbot-card">
                      {renderMessageText(msg.text, idx)}
                    </div>

                    {msg.previewUrl && (
                      <div
                        className="chatbot-link-preview"
                        style={{ marginTop: 8 }}
                      >
                        <SimpleLinkPreview url={msg.previewUrl} />
                      </div>
                    )}

                    {/* Real web-search citations — the "sites" grid, see
                        app.py's extract_web_citations. Rendered before the
                        image grid so a web_search reply reads: text, then
                        sources, then the photo grid. */}
                    {Array.isArray(msg.sites) && msg.sites.length > 0 && (
                      <div className="chatbot-sites-list">
                        {msg.sites.map((s, i) => (
                          <SimpleLinkPreview
                            key={i}
                            url={s.url}
                            title={s.title}
                          />
                        ))}
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

                    {/* "Do a web search instead?" / "Generate an image
                        with ChatGPT instead?" — see sendChatMessage's doc
                        comment and handleSwitchChipClick. */}
                    {msg.suggestedSwitch && (
                      <div className="chatbot-switch-row">
                        <button
                          type="button"
                          className="chatbot-switch-chip"
                          onClick={() => handleSwitchChipClick(msg)}
                        >
                          {msg.suggestedSwitch.label}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}

          {loading && (
            <div className="chatbot-message bot">
              <span className="chatbot-typing">
                <span></span>
                <span></span>
                <span></span>
              </span>
            </div>
          )}
          <div ref={messagesEndRef} />
        </div>

        <div
          className={`chatbot-clipnote-bar${
            clipNotes.length > 0 ? " has-clips" : ""
          }`}
        >
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
                {/* Clipping (rounded corners around the image/text) lives
                    on this inner wrapper now, not the outer box — the
                    outer box used to have overflow:hidden itself, which
                    clipped the delete button below (positioned just
                    outside the box's edge) instead of letting it sit
                    fully on top of the corner. */}
                <div className="chatbot-clip-inner">
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
                </div>

                <div
                  className="chatbot-clip-delete"
                  title="Remove this item"
                  onClick={() => {
                    setClipNotes((prev) => prev.filter((_, i) => i !== index));
                  }}
                >
                  <FontAwesomeIcon icon={faXmarkCircle} />
                </div>
              </div>
            );
          })}

          {/* Toggle selection mode */}
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

          {/* Clears every selected item at once — only shown once there's
              actually something to clear. Sized to match the add-box
              above it, with the icon stacked over the label instead of
              inline, so it reads as a peer chip rather than a wide pill. */}
          {clipNotes.length > 0 && (
            <button
              type="button"
              className="chatbot-clip-clear-all"
              title="Remove all selected items"
              onClick={() => setClipNotes([])}
            >
              <FontAwesomeIcon icon={faTrashCan} />
              <span>Clear all</span>
            </button>
          )}
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
      size={rndSize}
      onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
      onResizeStop={(e, direction, ref, delta, newPosition) => {
        setRndSize({ width: ref.style.width, height: ref.style.height });
        // Resizing from the top / top-left edges (the only handles
        // enabled below) moves the box's x/y as it grows so the opposite
        // (bottom-right) corner stays put — Rnd hands back the correct
        // adjusted position here, so this must be applied too or the
        // window would jump on the next render.
        setPosition(newPosition);
      }}
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
      minWidth={320}
      minHeight={360}
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
