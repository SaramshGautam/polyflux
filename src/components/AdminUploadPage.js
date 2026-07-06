import React, { useEffect, useMemo, useState } from "react";
import {
  doc,
  setDoc,
  serverTimestamp,
  collection,
  getDocs,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useFlashMessage } from "../FlashMessageContext";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import "./AdminUploadPage.css";
import { db } from "../firebaseConfig";

// One blank row for the entry table.
const emptyRow = () => ({
  key: crypto.randomUUID(),
  email: "",
  participantId: "",
  studyId: "",
  taskName: "",
  teamId: "",
});

const SITE_ORIGIN = window.location.origin;

const AdminUploadPage = () => {
  const navigate = useNavigate();
  const addMessage = useFlashMessage();

  const [rows, setRows] = useState([emptyRow(), emptyRow(), emptyRow()]);
  const [submitting, setSubmitting] = useState(false);
  const [results, setResults] = useState(null); // { created: [...], errors: [...] }

  // Nested lookup of everything a participant can be assigned to, pulled
  // straight from Firestore so the dropdowns can only ever offer real
  // studies/tasks/teams. Shape:
  // { [classId]: { label, projects: { [projectId]: { label, teams: [teamId, ...] } } } }
  const [catalog, setCatalog] = useState({});
  const [catalogLoading, setCatalogLoading] = useState(true);

  // Client-side gate only — this does NOT replace Firestore security rules.
  // Make sure your rules also restrict writes to the `users` collection to
  // admins/teachers, since anyone could otherwise call setDoc directly.
  useEffect(() => {
    const role = localStorage.getItem("role");
    if (role !== "admin" && role !== "teacher") {
      addMessage("danger", "You don't have access to this page.");
      navigate("/login");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const fetchCatalog = async () => {
      try {
        setCatalogLoading(true);
        const classroomsSnap = await getDocs(collection(db, "classrooms"));

        const nextCatalog = {};

        await Promise.all(
          classroomsSnap.docs.map(async (classroomDoc) => {
            const classId = classroomDoc.id;
            const classData = classroomDoc.data();

            const projectsSnap = await getDocs(
              collection(db, "classrooms", classId, "Projects")
            );

            const projects = {};

            await Promise.all(
              projectsSnap.docs.map(async (projectDoc) => {
                const projectId = projectDoc.id;
                const projectData = projectDoc.data();

                const teamsSnap = await getDocs(
                  collection(
                    db,
                    "classrooms",
                    classId,
                    "Projects",
                    projectId,
                    "teams"
                  )
                );

                projects[projectId] = {
                  label: projectData.projectName || projectId,
                  teams: teamsSnap.docs.map((teamDoc) => teamDoc.id),
                };
              })
            );

            nextCatalog[classId] = {
              label: classData.courseID
                ? `${classData.courseID} - ${classData.class_name || classId}`
                : classData.class_name || classId,
              projects,
            };
          })
        );

        setCatalog(nextCatalog);
      } catch (error) {
        console.error("Error loading study/task/team catalog:", error);
        addMessage(
          "danger",
          "Could not load studies. Try refreshing the page."
        );
      } finally {
        setCatalogLoading(false);
      }
    };

    fetchCatalog();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const updateRow = (key, field, value) => {
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;

        // Changing a parent selection invalidates the children below it —
        // a leftover taskName/teamId from a different study would silently
        // point at the wrong Firestore path.
        if (field === "studyId") {
          return { ...r, studyId: value, taskName: "", teamId: "" };
        }
        if (field === "taskName") {
          return { ...r, taskName: value, teamId: "" };
        }
        return { ...r, [field]: value };
      })
    );
  };

  const addRow = () => setRows((prev) => [...prev, emptyRow()]);

  const removeRow = (key) =>
    setRows((prev) =>
      prev.length > 1 ? prev.filter((r) => r.key !== key) : prev
    );

  const duplicateLastRow = () => {
    setRows((prev) => {
      const last = prev[prev.length - 1];
      return [
        ...prev,
        {
          ...last,
          key: crypto.randomUUID(),
          email: "",
          participantId: "",
        },
      ];
    });
  };

  // Rows with the same email get merged into one user doc with multiple
  // assignment entries (matches the login page's "multiple assignments"
  // flow, which sends the participant to a picker instead of guessing).
  const groupedByEmail = useMemo(() => {
    const map = new Map();

    for (const row of rows) {
      const email = row.email.trim().toLowerCase();
      if (!email) continue;

      const assignment = {
        studyId: row.studyId,
        taskName: row.taskName,
        teamId: row.teamId,
      };

      if (!map.has(email)) {
        map.set(email, {
          email,
          participantId: row.participantId.trim(),
          assignment: [assignment],
        });
      } else {
        map.get(email).assignment.push(assignment);
      }
    }

    return Array.from(map.values());
  }, [rows]);

  const validate = () => {
    const problems = [];
    const filledRows = rows.filter(
      (r) => r.email.trim() || r.participantId.trim() || r.studyId
    );

    if (filledRows.length === 0) {
      problems.push("Add at least one participant row.");
    }

    filledRows.forEach((r, i) => {
      const label = `Row ${i + 1}`;
      if (!r.email.trim()) problems.push(`${label}: email is required.`);
      if (!r.participantId.trim())
        problems.push(`${label}: Participant ID is required.`);
      if (!r.studyId) problems.push(`${label}: pick a Study.`);
      if (!r.taskName) problems.push(`${label}: pick a Task.`);
      if (!r.teamId) problems.push(`${label}: pick a Team.`);
    });

    return problems;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    const problems = validate();
    if (problems.length > 0) {
      addMessage("danger", problems[0]);
      return;
    }

    setSubmitting(true);
    setResults(null);

    const created = [];
    const errors = [];

    for (const participant of groupedByEmail) {
      try {
        await setDoc(
          doc(db, "users", participant.email),
          {
            email: participant.email,
            role: "participant",
            participantId: participant.participantId,
            assignment: participant.assignment,
            updatedAt: serverTimestamp(),
          },
          { merge: false }
        );

        const link = `${SITE_ORIGIN}/login?email=${encodeURIComponent(
          participant.email
        )}&pid=${encodeURIComponent(participant.participantId)}`;

        created.push({ ...participant, link });
      } catch (err) {
        console.error("Failed to create participant:", participant.email, err);
        errors.push({ email: participant.email, error: err.message });
      }
    }

    setResults({ created, errors });
    setSubmitting(false);

    if (errors.length === 0) {
      addMessage(
        "success",
        `Created ${created.length} participant record${
          created.length === 1 ? "" : "s"
        }.`
      );
    } else {
      addMessage(
        "danger",
        `Created ${created.length}, but ${errors.length} failed. See details below.`
      );
    }
  };

  const copyLink = async (link) => {
    try {
      await navigator.clipboard.writeText(link);
      addMessage("success", "Link copied.");
    } catch {
      addMessage("danger", "Could not copy link.");
    }
  };

  const copyAllLinks = async () => {
    if (!results?.created?.length) return;
    const text = results.created
      .map((c) => `${c.participantId} <${c.email}>: ${c.link}`)
      .join("\n");
    try {
      await navigator.clipboard.writeText(text);
      addMessage("success", "All links copied.");
    } catch {
      addMessage("danger", "Could not copy links.");
    }
  };

  const hasStudies = Object.keys(catalog).length > 0;

  return (
    <div className="container py-4 admin-upload-page">
      <div className="d-flex justify-content-between align-items-center mb-3">
        <h2 style={{ fontWeight: 700 }}>Bulk-add participants</h2>
        <button
          className="btn btn-outline-secondary"
          onClick={() => navigate("/dashboard")}
        >
          Back to dashboard
        </button>
      </div>

      <p className="text-muted">
        Add one row per participant. Study, Task, and Team are pulled directly
        from your classrooms, so every assignment points at something real. Rows
        that share the same email are combined into a single account with
        multiple session assignments.
      </p>

      {!catalogLoading && !hasStudies && (
        <div className="alert alert-warning">
          No studies found yet.{" "}
          <button
            type="button"
            className="btn btn-link p-0 align-baseline"
            onClick={() => navigate("/add-classroom")}
          >
            Add a classroom
          </button>{" "}
          (with a project and team) before assigning participants.
        </div>
      )}

      <form onSubmit={handleSubmit}>
        <div className="table-responsive">
          <table className="table align-middle">
            <thead>
              <tr>
                <th style={{ minWidth: 200 }}>Email</th>
                <th style={{ minWidth: 130 }}>Participant ID</th>
                <th style={{ minWidth: 190 }}>Study</th>
                <th style={{ minWidth: 190 }}>Task</th>
                <th style={{ minWidth: 150 }}>Team</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const studyEntry = catalog[row.studyId];
                const taskEntries = studyEntry ? studyEntry.projects : {};
                const taskEntry = taskEntries[row.taskName];
                const teamOptions = taskEntry ? taskEntry.teams : [];

                return (
                  <tr key={row.key}>
                    <td>
                      <input
                        type="email"
                        className="form-control form-control-sm"
                        placeholder="p014@lsu.edu"
                        value={row.email}
                        onChange={(e) =>
                          updateRow(row.key, "email", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="form-control form-control-sm"
                        placeholder="P014"
                        value={row.participantId}
                        onChange={(e) =>
                          updateRow(row.key, "participantId", e.target.value)
                        }
                      />
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.studyId}
                        disabled={catalogLoading || !hasStudies}
                        onChange={(e) =>
                          updateRow(row.key, "studyId", e.target.value)
                        }
                      >
                        <option value="">
                          {catalogLoading ? "Loading..." : "Select a study..."}
                        </option>
                        {Object.entries(catalog).map(([classId, entry]) => (
                          <option key={classId} value={classId}>
                            {entry.label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.taskName}
                        disabled={!row.studyId}
                        onChange={(e) =>
                          updateRow(row.key, "taskName", e.target.value)
                        }
                      >
                        <option value="">
                          {row.studyId
                            ? "Select a task..."
                            : "Pick a study first"}
                        </option>
                        {Object.entries(taskEntries).map(
                          ([projectId, entry]) => (
                            <option key={projectId} value={projectId}>
                              {entry.label}
                            </option>
                          )
                        )}
                      </select>
                    </td>
                    <td>
                      <select
                        className="form-select form-select-sm"
                        value={row.teamId}
                        disabled={!row.taskName}
                        onChange={(e) =>
                          updateRow(row.key, "teamId", e.target.value)
                        }
                      >
                        <option value="">
                          {row.taskName
                            ? "Select a team..."
                            : "Pick a task first"}
                        </option>
                        {teamOptions.map((teamId) => (
                          <option key={teamId} value={teamId}>
                            {teamId}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <button
                        type="button"
                        className="btn btn-sm btn-outline-danger"
                        onClick={() => removeRow(row.key)}
                        title="Remove row"
                      >
                        <i className="bi bi-x-lg"></i>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="d-flex gap-2 mb-4">
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={addRow}
          >
            + Add row
          </button>
          <button
            type="button"
            className="btn btn-outline-secondary btn-sm"
            onClick={duplicateLastRow}
          >
            + Duplicate last row's study/task/team
          </button>
        </div>

        <button type="submit" className="btn btn-dark" disabled={submitting}>
          {submitting ? "Saving..." : "Create participant accounts"}
        </button>
      </form>

      {results && (
        <div className="mt-4">
          {results.created.length > 0 && (
            <>
              <div className="d-flex justify-content-between align-items-center mb-2">
                <h5 className="mb-0">Created ({results.created.length})</h5>
                <button
                  className="btn btn-sm btn-outline-dark"
                  onClick={copyAllLinks}
                >
                  Copy all links
                </button>
              </div>
              <div className="table-responsive mb-4">
                <table className="table table-sm">
                  <thead>
                    <tr>
                      <th>Participant</th>
                      <th>Email</th>
                      <th>Login link</th>
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {results.created.map((c) => (
                      <tr key={c.email}>
                        <td>{c.participantId}</td>
                        <td>{c.email}</td>
                        <td className="text-truncate" style={{ maxWidth: 280 }}>
                          <code>{c.link}</code>
                        </td>
                        <td>
                          <button
                            className="btn btn-sm btn-outline-secondary"
                            onClick={() => copyLink(c.link)}
                          >
                            Copy
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {results.errors.length > 0 && (
            <div className="alert alert-danger">
              <strong>Some rows failed:</strong>
              <ul className="mb-0">
                {results.errors.map((e) => (
                  <li key={e.email}>
                    {e.email}: {e.error}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminUploadPage;
