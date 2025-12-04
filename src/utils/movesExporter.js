// src/utils/movesExporter.js
import {
  getFirestore,
  collection,
  doc,
  getDocs,
  getDoc,
  addDoc,
  setDoc,
  serverTimestamp,
  query,
  orderBy,
  limit,
  onSnapshot,
} from "firebase/firestore";
import { saveAs } from "file-saver";

/**
 * CONFIG: change defaults if needed.
 */
export const DEFAULTS = {
  COURSE: "CSC4444",
  PROJECT: "Image Classifier",
  TEAM: "Team 1",
  // Where to store export chunks in Firestore
  EXPORTS_COLLECTION: "exports",
  // Each Firestore doc must be <= 1MB. Keep chunks conservative.
  MAX_DOC_SIZE_B: 700_000,
  // Safety cap on chunk length
  MAX_ITEMS_PER_CHUNK: 500,
};

/**
 * Build team refs quickly.
 */
export function teamRefs(db, { COURSE, PROJECT, TEAM } = DEFAULTS) {
  const base = doc(
    db,
    "classrooms",
    COURSE,
    "Projects",
    PROJECT,
    "teams",
    TEAM
  );
  return {
    base,
    historyCol: collection(base, "history"),
    shapesCol: collection(base, "shapes"),
    exportsCol: collection(base, DEFAULTS.EXPORTS_COLLECTION),
  };
}

/**
 * Fetch all shapes into a map for quick enrichment.
 */
export async function fetchShapesMap(db, cfg = DEFAULTS) {
  const { shapesCol } = teamRefs(db, cfg);
  const snap = await getDocs(shapesCol);
  const map = new Map();
  snap.forEach((d) => map.set(d.id, d.data()));
  return map;
}

/**
 * Fetch history items ordered by timestamp if present.
 * If your 'history' docs already look like your "TeamX" schema,
 * this will mostly pass-through with light normalization.
 */
export async function fetchHistory(db, cfg = DEFAULTS) {
  const { historyCol } = teamRefs(db, cfg);
  // Order by createdAt or timestamp if your docs have that field
  // Fallback to unordered (Firestore won’t guarantee order)
  let qTry = query(historyCol, orderBy("timestamp", "asc"));
  try {
    const snap = await getDocs(qTry);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  } catch {
    const snap = await getDocs(historyCol);
    return snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  }
}

/**
 * Normalize various timestamp shapes → ISO string.
 */
export function isoTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  // Firestore Timestamp
  if (typeof ts?.toDate === "function") return ts.toDate().toISOString();
  // Date
  if (ts instanceof Date) return ts.toISOString();
  // string/number
  try {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d.toISOString();
  } catch {}
  return new Date().toISOString();
}

/**
 * Rolling APM & simple velocity estimate.
 * We do a light-weight pass to compute per-event tempo fields:
 * - gap_prev_ms: time between this and previous
 * - apm_rolling: actions/minute over a sliding 60s window
 * - velocity_px_s: if any delta position is present in history payload
 */
export function computeTempoFields(events) {
  const windowMs = 60_000;
  const times = events.map((e) => new Date(e.timestamp).getTime());
  const apm = [];
  let j = 0;

  for (let i = 0; i < times.length; i++) {
    const t = times[i];
    while (j < i && t - times[j] > windowMs) j++;
    const count = i - j + 1;
    apm.push((count / (windowMs / 1000)) * 60); // actions per minute
  }

  return events.map((ev, i) => {
    const gap_prev_ms = i === 0 ? null : times[i] - times[i - 1];

    // naive velocity from optional dx, dy fields in the history item (if any)
    const dx = ev?.micro?.dx ?? null;
    const dy = ev?.micro?.dy ?? null;
    let velocity_px_s = null;
    if (dx != null && dy != null && gap_prev_ms && gap_prev_ms > 0) {
      const dist = Math.hypot(dx, dy);
      velocity_px_s = dist / (gap_prev_ms / 1000);
    }

    return {
      ...ev,
      tempo: {
        ...(ev.tempo || {}),
        gap_prev_ms: gap_prev_ms ?? ev?.tempo?.gap_prev_ms ?? null,
        apm_rolling: Number(apm[i].toFixed(1)),
        velocity_px_s: velocity_px_s ?? ev?.tempo?.velocity_px_s ?? null,
      },
    };
  });
}

/**
 * Map a single raw history doc → "move" record.
 * We enrich using shapes when available.
 */
export function mapHistoryToMove(h, shapesMap) {
  const items = Array.isArray(h.items) ? h.items : [];
  // content text fallback: try shapes’ texts if missing
  const textFromShapes = items
    .map((id) => shapesMap.get(id)?.text)
    .filter(Boolean);

  const shapeTypes = items
    .map((id) => shapesMap.get(id)?.shapeType)
    .filter(Boolean);

  const itemType =
    h.itemType ||
    (shapeTypes[0] ? String(shapeTypes[0]).toLowerCase() : "note");

  const contentText =
    h?.content?.text?.trim() ||
    h?.text?.trim() ||
    (textFromShapes.length ? textFromShapes.join(", ") : "");

  const tags = (
    h?.content?.tags && Array.isArray(h.content.tags) && h.content.tags.length
      ? h.content.tags
      : (contentText || "")
          .split(/[,\s]+/)
          .map((t) => t.trim())
          .filter(Boolean)
  ).slice(0, 6); // keep tidy

  const move = {
    text: h.text || contentText || "",
    actor: typeof h.actor === "number" ? h.actor : 0,
    timestamp: isoTimestamp(h.timestamp || h.createdAt),
    action: (h.action || "edit").toLowerCase(),
    itemType,
    items,
    content: {
      text: contentText,
      imageUrls: Array.isArray(h?.content?.imageUrls)
        ? h.content.imageUrls
        : [],
      tags,
    },
    micro: {
      // pass through if present; otherwise nulls
      pointer_path_px: h?.micro?.pointer_path_px ?? null,
      dwell_ms: h?.micro?.dwell_ms ?? null,
      reselect_count: h?.micro?.reselect_count ?? null,
      hover_ms: h?.micro?.hover_ms ?? null,
      scrub_px: h?.micro?.scrub_px ?? null,
      // optional raw deltas (used for naive velocity calc)
      dx: h?.micro?.dx ?? null,
      dy: h?.micro?.dy ?? null,
    },
    tempo: {
      gap_prev_ms: h?.tempo?.gap_prev_ms ?? null,
      apm_rolling: h?.tempo?.apm_rolling ?? null,
      velocity_px_s: h?.tempo?.velocity_px_s ?? null,
    },
  };

  return move;
}

/**
 * Full export pipeline:
 * - read shapes
 * - read history
 * - map → moves
 * - compute tempo
 * - optionally group by team key (TeamX)
 */
export async function buildMovesPayload(db, cfg = DEFAULTS) {
  const shapesMap = await fetchShapesMap(db, cfg);
  const history = await fetchHistory(db, cfg);

  // Map & sort by timestamp
  const movesRaw = history.map((h) => mapHistoryToMove(h, shapesMap));
  movesRaw.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Fill tempo fields (APM, gaps, velocity)
  const moves = computeTempoFields(movesRaw);

  const teamKey = cfg.TEAM.replace(/\s+/g, "");
  return { [teamKey]: moves };
}

/**
 * Download JSON blob locally.
 */
export function downloadJsonFile(obj, filename = "moves.json") {
  const blob = new Blob([JSON.stringify(obj, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  saveAs(blob, filename);
}

/**
 * Save JSON payload into Firestore in CHUNKS to respect 1MB limits.
 * We write a parent doc with metadata, and chunk array into child docs.
 *
 * Result:
 * teams/{TEAM}/exports/{exportId}
 *   - meta: { createdAt, count, team, course, project, chunkCount }
 *   - chunks/{i} : { data: [ ... up to N moves ... ] }
 */
export async function savePayloadToFirestore(db, payload, cfg = DEFAULTS) {
  const { base, exportsCol } = teamRefs(db, cfg);
  const teamKey = Object.keys(payload)[0];
  const moves = payload[teamKey] || [];

  const metaDoc = await addDoc(collection(base, DEFAULTS.EXPORTS_COLLECTION), {
    team: cfg.TEAM,
    course: cfg.COURSE,
    project: cfg.PROJECT,
    key: teamKey,
    count: moves.length,
    createdAt: serverTimestamp(),
    format: "moves.v1",
  });

  // chunk writer
  const chunksCol = collection(metaDoc, "chunks");

  let chunk = [];
  let chunkBytes = 0;
  let i = 0;
  let written = 0;

  const flush = async () => {
    if (!chunk.length) return;
    await setDoc(doc(chunksCol, String(i)), { data: chunk });
    written += chunk.length;
    i += 1;
    chunk = [];
    chunkBytes = 0;
  };

  for (const m of moves) {
    const asStr = JSON.stringify(m);
    const size = new TextEncoder().encode(asStr).length;

    const wouldExceed =
      chunkBytes + size > DEFAULTS.MAX_DOC_SIZE_B ||
      chunk.length + 1 > DEFAULTS.MAX_ITEMS_PER_CHUNK;

    if (wouldExceed) await flush();

    chunk.push(m);
    chunkBytes += size;
  }
  await flush();

  // write chunkCount back to meta
  await setDoc(metaDoc, { chunkCount: i }, { merge: true });

  return {
    exportId: metaDoc.id,
    chunkCount: i,
    total: moves.length,
  };
}

/**
 * Optional: lightweight realtime buffer hook you can reuse later.
 * Emits a stable "moves array" you can stream to your linker or preview.
 */
export function subscribeRealtimeMoves(db, cfg, onBatch) {
  const { historyCol } = teamRefs(db, cfg);
  // Listen newest-first or oldest-first as you prefer; here we do newest-first & re-sort
  const qLive = query(historyCol, orderBy("timestamp", "asc"), limit(1000));
  const shapesPromise = fetchShapesMap(db, cfg);

  const unsub = onSnapshot(qLive, async (snap) => {
    const shapes = await shapesPromise;
    const raw = [];
    snap.forEach((d) => raw.push({ id: d.id, ...d.data() }));
    const moves = computeTempoFields(
      raw
        .map((h) => mapHistoryToMove(h, shapes))
        .sort(
          (a, b) =>
            new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
        )
    );
    onBatch(moves);
  });

  return unsub;
}

// === NEW: time segmentation helpers ===

/** Return [minISO, maxISO] over a list of moves (safe for empty). */
export function movesTimeRange(moves) {
  if (!moves.length) return [null, null];
  const ts = moves.map((m) => new Date(m.timestamp).getTime());
  const min = new Date(Math.min(...ts)).toISOString();
  const max = new Date(Math.max(...ts)).toISOString();
  return [min, max];
}

/**
 * Split a sorted moves array into fixed-size time buckets.
 * @param {Array} moves - must be time-sorted ASC
 * @param {number} minutes - bucket length in minutes (default 10)
 * @returns {Array<{index:number, startISO:string, endISO:string, moves:Array}>}
 */
export function splitMovesByInterval(moves, minutes = 10) {
  if (!moves.length) return [];
  const ms = minutes * 60_000;

  const t0 = new Date(moves[0].timestamp).getTime();
  const buckets = new Map();

  for (const m of moves) {
    const t = new Date(m.timestamp).getTime();
    const idx = Math.floor((t - t0) / ms);
    if (!buckets.has(idx)) buckets.set(idx, []);
    buckets.get(idx).push(m);
  }

  const segments = [];
  for (const [index, segMoves] of Array.from(buckets.entries()).sort(
    (a, b) => a[0] - b[0]
  )) {
    const [startISO, endISO] = movesTimeRange(segMoves);
    segments.push({ index, startISO, endISO, moves: segMoves });
  }
  return segments;
}

/**
 * Build the full moves payload *and* return fixed-size segments.
 * Keeps your existing normalization, tempo, etc.
 */
export async function buildSegmentedPayloads(db, cfg = DEFAULTS, minutes = 10) {
  // reuse your pipeline
  const payload = await buildMovesPayload(db, cfg); // { Team1: [moves...] }
  const teamKey = Object.keys(payload)[0];
  const moves = payload[teamKey] || [];
  // already sorted + tempo computed by buildMovesPayload
  const segments = splitMovesByInterval(moves, minutes).map((seg) => ({
    teamKey,
    index: seg.index,
    startISO: seg.startISO,
    endISO: seg.endISO,
    moves: seg.moves,
    // optional: episode title useful for your viewer
    title: `${cfg.TEAM} — ${minutes}m segment #${seg.index} (${seg.startISO} → ${seg.endISO})`,
  }));
  return { teamKey, segments };
}

/**
 * Save *segmented* payload to Firestore:
 *   teams/{TEAM}/exports/{exportId}
 *     meta: {..., segmented: true, minutesPerSegment, segmentCount}
 *     segments/{i}
 *       meta: { index, startISO, endISO, count }
 *       chunks/{j} : { data: [ ... ] }   // reusing chunk logic
 */
export async function saveSegmentedToFirestore(
  db,
  segmented,
  cfg = DEFAULTS,
  minutes = 10
) {
  const { base } = teamRefs(db, cfg);

  // parent export doc
  const exportMetaRef = await addDoc(
    collection(base, DEFAULTS.EXPORTS_COLLECTION),
    {
      team: cfg.TEAM,
      course: cfg.COURSE,
      project: cfg.PROJECT,
      key: segmented.teamKey,
      createdAt: serverTimestamp(),
      format: "moves.v1",
      segmented: true,
      minutesPerSegment: minutes,
      segmentCount: segmented.segments.length,
    }
  );

  let totalWritten = 0;
  let segDocs = [];

  for (const seg of segmented.segments) {
    // segment meta doc
    const segRef = doc(
      collection(exportMetaRef, "segments"),
      String(seg.index)
    );
    await setDoc(segRef, {
      index: seg.index,
      startISO: seg.startISO,
      endISO: seg.endISO,
      count: seg.moves.length,
      title: seg.title,
    });

    // write chunks (reuse your 1MB-chunk writer)
    const chunksCol = collection(segRef, "chunks");
    let chunk = [];
    let chunkBytes = 0;
    let j = 0;

    const flush = async () => {
      if (!chunk.length) return;
      await setDoc(doc(chunksCol, String(j)), { data: chunk });
      j += 1;
      chunk = [];
      chunkBytes = 0;
    };

    for (const m of seg.moves) {
      const asStr = JSON.stringify(m);
      const size = new TextEncoder().encode(asStr).length;
      const wouldExceed =
        chunkBytes + size > DEFAULTS.MAX_DOC_SIZE_B ||
        chunk.length + 1 > DEFAULTS.MAX_ITEMS_PER_CHUNK;

      if (wouldExceed) await flush();

      chunk.push(m);
      chunkBytes += size;
    }
    await flush();

    // store chunk count on the segment meta
    await setDoc(segRef, { chunkCount: j }, { merge: true });

    totalWritten += seg.moves.length;
    segDocs.push({
      index: seg.index,
      chunkCount: j,
      count: seg.moves.length,
      startISO: seg.startISO,
      endISO: seg.endISO,
    });
  }

  // write summary back to parent export
  await setDoc(exportMetaRef, { total: totalWritten }, { merge: true });

  return {
    exportId: exportMetaRef.id,
    total: totalWritten,
    segmentCount: segmented.segments.length,
    segments: segDocs,
  };
}
