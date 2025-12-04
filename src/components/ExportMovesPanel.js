// src/components/ExportMovesPanel.js
import React, { useState } from "react";
import { getFirestore } from "firebase/firestore";
import { useParams } from "react-router-dom";
import {
  DEFAULTS,
  buildMovesPayload,
  downloadJsonFile,
  savePayloadToFirestore,
  buildSegmentedPayloads,
  saveSegmentedToFirestore,
} from "../utils/movesExporter";

export default function ExportMovesPanel(props) {
  const db = getFirestore();

  // Prefer URL params > explicit props > DEFAULTS
  const { className, projectName, teamName } = useParams() ?? {};
  const course = className ?? props.course ?? DEFAULTS.COURSE;
  const project = projectName ?? props.project ?? DEFAULTS.PROJECT;
  const team = teamName ?? props.team ?? DEFAULTS.TEAM;

  const [busy, setBusy] = useState(false);
  const [lastResult, setLastResult] = useState(null);
  const [error, setError] = useState(null);

  const [segResult, setSegResult] = useState(null);
  const [minutes, setMinutes] = useState(10);

  const cfg = { COURSE: course, PROJECT: project, TEAM: team };

  async function handleExport() {
    setBusy(true);
    setError(null);
    setLastResult(null);
    try {
      const payload = await buildMovesPayload(db, cfg);

      // Download (TeamKey_moves.json)
      const teamKey = Object.keys(payload)[0];
      downloadJsonFile(payload, `${teamKey}_moves.json`);

      // Save to Firestore (chunked)
      const result = await savePayloadToFirestore(db, payload, cfg);
      setLastResult(result);
    } catch (e) {
      console.error(e);
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  async function handleExportSegmented() {
    setBusy(true);
    setError(null);
    setLastResult(null);
    setSegResult(null);
    try {
      const segmented = await buildSegmentedPayloads(
        getFirestore(),
        cfg,
        minutes
      );

      // download each segment as its own file
      for (const seg of segmented.segments) {
        const fileObj = {
          [segmented.teamKey]: {
            title: seg.title,
            moves: seg.moves, // your viewer reads either `moves` or array directly
          },
        };
        // filename: Team1_YYYYMMDDTHHMM_to_HHMM_seg-02.json
        const start = seg.startISO?.replaceAll(/[:]/g, "-") ?? "start";
        const end = seg.endISO?.replaceAll(/[:]/g, "-") ?? "end";
        downloadJsonFile(
          fileObj,
          `${segmented.teamKey}_${start}_to_${end}_seg-${String(
            seg.index
          ).padStart(2, "0")}.json`
        );
      }

      // also save to Firestore with segment meta
      const result = await saveSegmentedToFirestore(
        getFirestore(),
        segmented,
        cfg,
        minutes
      );
      setSegResult(result);
    } catch (e) {
      setError(String(e?.message || e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="p-4 border rounded-xl max-w-xl">
      <h3 className="font-semibold text-lg mb-2">Export Team Moves</h3>
      <div className="text-sm mb-3">
        <div>
          Course: <b>{course}</b>
        </div>
        <div>
          Project: <b>{project}</b>
        </div>
        <div>
          Team: <b>{team}</b>
        </div>
      </div>

      <div className="flex gap-2 items-center">
        <button
          onClick={handleExport}
          disabled={busy}
          className={`px-4 py-2 rounded ${
            busy ? "bg-gray-400" : "bg-black text-white"
          }`}
        >
          {busy ? "Exporting…" : "Export & Save"}
        </button>

        <div className="flex items-center gap-2">
          <label className="text-sm">Segment every</label>
          <input
            type="number"
            min={1}
            value={minutes}
            onChange={(e) => setMinutes(Math.max(1, Number(e.target.value)))}
            className="w-16 border rounded px-2 py-1 text-sm"
          />
          <span className="text-sm">minutes</span>
        </div>

        <button
          onClick={handleExportSegmented}
          disabled={busy}
          className={`px-3 py-2 rounded ${
            busy ? "bg-gray-400" : "bg-indigo-600 text-white"
          }`}
        >
          {busy ? "Working…" : "Export segmented & save"}
        </button>
      </div>

      {lastResult && (
        <div className="mt-3 text-sm">
          <div className="font-medium">Saved to Firestore</div>
          <div>
            exportId: <code>{lastResult.exportId}</code>
          </div>
          <div>chunks: {lastResult.chunkCount}</div>
          <div>total moves: {lastResult.total}</div>
          <div className="text-gray-500 mt-1">
            Location: teams/{team}/exports/{lastResult.exportId}/chunks/*
          </div>
        </div>
      )}

      {error && <div className="mt-3 text-sm text-red-600">Error: {error}</div>}
    </div>
  );
}
