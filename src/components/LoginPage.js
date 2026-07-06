import React, { useState, useEffect } from "react";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  signInAnonymously,
  updateProfile,
} from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  getDocs,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { useFlashMessage } from "../FlashMessageContext";
import "bootstrap/dist/css/bootstrap.min.css";
import "bootstrap-icons/font/bootstrap-icons.css";
import { db, auth, googleProvider } from "../firebaseConfig";

const LoginPage = () => {
  const DEVELOPER_EMAIL = "saramshgautam@gmail.com";

  const accessMailto = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(
    "Requesting access to PolyFlux"
  )}&body=${encodeURIComponent(
    "Hi,\n\nI want to use PolyFlux and need access.\n\nName: (Enter your name)\nEmail: (Enter your email)\nPassword: (Enter a password)\n\nThanks."
  )}`;

  const [message, setMessage] = useState(null); // optional local messages
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showParticipantForm, setShowParticipantForm] = useState(false);
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [participantSubmitting, setParticipantSubmitting] = useState(false);
  const [prefilledFromLink, setPrefilledFromLink] = useState(false);

  const navigate = useNavigate();
  const addMessage = useFlashMessage();

  useEffect(() => {
    document.body.classList.add("login-page");
    return () => {
      document.body.classList.remove("login-page");
    };
  }, []);

  // Support personalized "magic links" like:
  //   /login?email=p014@lsu.edu&pid=P014
  // so participants don't have to type anything on the day of the study.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const linkEmail = params.get("email");
    const linkPid = params.get("pid");

    if (linkEmail && linkPid) {
      setParticipantEmail(linkEmail.trim().toLowerCase());
      setParticipantId(linkPid.trim());
      setShowParticipantForm(true);
      setPrefilledFromLink(true);
    }
  }, []);

  const participantQuickLogin = async (e) => {
    e.preventDefault();

    const normalizedEmail = participantEmail.trim().toLowerCase();
    const pid = participantId.trim();

    if (!normalizedEmail || !pid) {
      addMessage("danger", "Please enter both email and Participant ID.");
      return;
    }

    setParticipantSubmitting(true);

    try {
      // Doc ID is the lowercase email, so this is a direct, cheap lookup
      // (and lets Firestore rules allow single-doc "get" without opening
      // up collection-wide "list" access to the whole users collection).
      const userDocRef = doc(db, "users", normalizedEmail);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        addMessage(
          "danger",
          "Not found. Please check your email and Participant ID."
        );
        return;
      }

      const userData = userDocSnap.data();

      // Validate the Participant ID against what's on file, rather than
      // trusting whatever was typed in. Case-insensitive to be forgiving
      // of "p014" vs "P014".
      const storedPid = (userData.participantId || "").trim().toUpperCase();
      if (storedPid && storedPid !== pid.toUpperCase()) {
        addMessage(
          "danger",
          "Email and Participant ID don't match our records."
        );
        return;
      }

      const rawAssignments = userData.assignment;
      const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];

      if (assignments.length === 0) {
        addMessage("danger", "No team assignments found for this participant.");
        return;
      }

      // Sign in anonymously up front, regardless of how many assignments
      // this participant has. DashboardRouter (and any other page gated on
      // auth state) needs a real Firebase user to exist — if we skip this
      // for the multi-assignment case, onAuthStateChanged fires with
      // user = null and the dashboard shows "No user logged in", even
      // though we already set the right values in localStorage.
      const anonRes = await signInAnonymously(auth);
      const uid = anonRes.user.uid;

      await updateProfile(anonRes.user, {
        displayName: pid,
      });

      if (assignments.length === 1) {
        const a = assignments[0];

        await setDoc(doc(db, "participantSessions", uid), {
          uid,
          email: normalizedEmail,
          participantId: pid,
          role: userData.role || "participant",
          studyId: a.studyId,
          taskName: a.taskName,
          teamId: a.teamId,
          createdAt: serverTimestamp(),
        });

        addMessage("success", "Welcome! Redirecting to your whiteboard...");

        navigate(
          `/whiteboard/${encodeURIComponent(a.studyId)}/${encodeURIComponent(
            a.taskName
          )}/${encodeURIComponent(a.teamId)}`
        );
        return;
      }

      // Multiple assignments (e.g. participant is in more than one
      // session/condition): let them choose from a dashboard instead of
      // guessing which one they meant to join. Still write a session doc
      // (without a single studyId/taskName/teamId) so there's an audit
      // trail of the login itself.
      await setDoc(doc(db, "participantSessions", uid), {
        uid,
        email: normalizedEmail,
        participantId: pid,
        role: userData.role || "participant",
        createdAt: serverTimestamp(),
      });

      const assignedWhiteboards = await Promise.all(
        assignments.map(async (a) => {
          const classId = a.studyId || "";
          const classSnap = await getDoc(doc(db, "classrooms", classId));
          const classData = classSnap.exists() ? classSnap.data() : {};

          return {
            classId,
            className: classId,
            classDisplayName: classData.class_name || classId,
            courseID: classData.courseID || classId,
            semester: classData.semester || "",
            teacherEmail: classData.teacherEmail || "",
            projectName: a.taskName || "",
            teamName: a.teamId || "",
          };
        })
      );

      localStorage.setItem("userEmail", normalizedEmail);
      localStorage.setItem("role", "participant");
      localStorage.setItem(
        "assignedWhiteboards",
        JSON.stringify(assignedWhiteboards)
      );

      addMessage("success", "Welcome! Please choose your assigned board.");
      navigate("/dashboard");
    } catch (err) {
      console.error("Participant quick login failed:", err);
      addMessage("danger", "Login failed. Please try again.");
    } finally {
      setParticipantSubmitting(false);
    }
  };

  const handleProfileAndRedirect = async (user) => {
    const userEmail = (user.email || "").trim().toLowerCase();

    try {
      const userDocRef = doc(db, "users", userEmail);
      const userDocSnap = await getDoc(userDocRef);

      if (!userDocSnap.exists()) {
        addMessage(
          "danger",
          "Your account is not registered in the system. Please contact the instructor."
        );
        return;
      }

      const userData = userDocSnap.data();
      const role = userData.role || "";

      localStorage.setItem("userEmail", userEmail);
      localStorage.setItem("role", role);
      localStorage.removeItem("assignedWhiteboards");

      if (role === "teacher" || role === "admin") {
        addMessage("success", "Welcome! Redirecting to your dashboard.");
        navigate("/dashboard");
        return;
      }

      if (role === "student") {
        const classroomsRef = collection(db, "classrooms");
        const classroomsSnap = await getDocs(classroomsRef);

        const assignedWhiteboards = [];

        for (const classroomDoc of classroomsSnap.docs) {
          const classId = classroomDoc.id;
          const classroomData = classroomDoc.data();

          const projectsRef = collection(db, "classrooms", classId, "Projects");
          const projectsSnap = await getDocs(projectsRef);

          for (const projectDoc of projectsSnap.docs) {
            const projectId = projectDoc.id;
            const projectData = projectDoc.data();

            const teamsRef = collection(
              db,
              "classrooms",
              classId,
              "Projects",
              projectId,
              "teams"
            );
            const teamsSnap = await getDocs(teamsRef);

            for (const teamDoc of teamsSnap.docs) {
              const teamData = teamDoc.data();

              const memberEmails = Object.keys(teamData)
                .filter((key) => key !== "previewUrl")
                .map((email) => email.trim().toLowerCase());

              if (memberEmails.includes(userEmail)) {
                assignedWhiteboards.push({
                  classId,
                  className: classId,
                  classDisplayName: classroomData.class_name || classId,
                  courseID: classroomData.courseID || classId,
                  semester: classroomData.semester || "",
                  teacherEmail: classroomData.teacherEmail || "",
                  projectName: projectData.projectName || projectId,
                  teamName: teamDoc.id,
                });
              }
            }
          }
        }

        if (assignedWhiteboards.length === 0) {
          addMessage("danger", "You are not assigned to any whiteboards.");
          return;
        }

        localStorage.setItem(
          "assignedWhiteboards",
          JSON.stringify(assignedWhiteboards)
        );

        addMessage("success", "Welcome! Redirecting to your dashboard.");
        navigate("/dashboard");
        return;
      }

      addMessage("danger", "Your account role is not recognized.");
    } catch (err) {
      console.error("Error during login redirect:", err);
      addMessage("danger", "Could not load your dashboard.");
    }
  };

  const googleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      await handleProfileAndRedirect(result.user);
    } catch (error) {
      console.error("Google login failed:", error);
      addMessage("danger", "Google login failed. Please try again.");
    }
  };

  const emailPasswordLogin = async (e) => {
    e.preventDefault();
    try {
      const result = await signInWithEmailAndPassword(auth, email, password);
      await handleProfileAndRedirect(result.user);
    } catch (error) {
      console.error("Email/password login failed:", error);

      let msg = "Login failed. Please check your email and password.";
      if (error.code === "auth/user-not-found") {
        msg = "No account found for this email.";
      } else if (error.code === "auth/wrong-password") {
        msg = "Incorrect password. Please try again.";
      } else if (error.code === "auth/invalid-email") {
        msg = "Please enter a valid email address.";
      }

      addMessage("danger", msg);
    }
  };

  const renderDeveloperAccessLink = () => (
    <div className="mt-3">
      <a href={accessMailto} className="btn btn-link p-0 text-decoration-none">
        Email the developer for access
      </a>
    </div>
  );

  return (
    <div
      className="d-flex justify-content-center align-items-center min-vh-100"
      style={{
        backgroundImage: 'url("/body-bg3.png")',
        backgroundSize: "cover",
        backgroundPosition: "center",
      }}
    >
      <div className="login-container p-4 bg-white rounded shadow text-center">
        <h2
          className="mb-4"
          style={{ fontWeight: 700, fontSize: "28px", color: "#333" }}
        >
          Welcome to PolyFlux
        </h2>
        <img
          src="/logo.png"
          alt="App logo"
          style={{ width: "150px", marginBottom: "20px" }}
        />

        <p className="mb-4 text-muted">Collaborate. Create. Reflect.</p>

        {/* Local flash messages (if you still use `message` state here) */}
        {message && (
          <div
            className={`alert ${
              message.includes("failed") ? "alert-danger" : "alert-info"
            }`}
            role="alert"
          >
            <strong>{message}</strong>
          </div>
        )}

        {/* If we arrived via a personalized study link, skip straight to
            the participant flow with a single confirm step. */}
        {prefilledFromLink && showParticipantForm && (
          <div className="alert alert-info text-start" role="alert">
            You're signed in as <strong>{participantId}</strong> (
            {participantEmail}). Not you?{" "}
            <button
              type="button"
              className="btn btn-link p-0 align-baseline"
              onClick={() => {
                setPrefilledFromLink(false);
                setParticipantEmail("");
                setParticipantId("");
              }}
            >
              Clear
            </button>
          </div>
        )}

        {/* Google login */}
        <div className="mb-3">
          <div className="d-flex justify-content-center">
            <button className="googlebutton" onClick={googleLogin}>
              <svg
                xmlns="http://www.w3.org/2000/svg"
                preserveAspectRatio="xMidYMid"
                viewBox="0 0 256 262"
              >
                <path
                  fill="#4285F4"
                  d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
                ></path>
                <path
                  fill="#34A853"
                  d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
                ></path>
                <path
                  fill="#FBBC05"
                  d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"
                ></path>
                <path
                  fill="#EB4335"
                  d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
                ></path>
              </svg>
              Login with Google
            </button>
          </div>
        </div>

        {/* Small link to reveal email/password form */}
        {!showEmailForm && (
          <div className="mt-2">
            <button
              type="button"
              className="btn btn-outline-primary w-100"
              onClick={() => setShowEmailForm(true)}
            >
              Sign in with email instead
            </button>
          </div>
        )}

        {/* Email/password login: only visible after clicking the link */}
        {showEmailForm && (
          <>
            <div className="d-flex align-items-center my-3">
              <hr className="flex-grow-1" />
              <span className="mx-2 text-muted">OR</span>
              <hr className="flex-grow-1" />
            </div>
            <form onSubmit={emailPasswordLogin}>
              <div className="mb-2 text-start">
                <label className="form-label mb-1">Email</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
              </div>

              <div className="mb-3 text-start">
                <label className="form-label mb-1">Password</label>
                <input
                  type="password"
                  className="form-control"
                  placeholder="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-100">
                Login with Email
              </button>
            </form>
            {renderDeveloperAccessLink()}
          </>
        )}

        {/* Small link to reveal participant quick login */}
        {!showParticipantForm && (
          <div className="mt-3">
            <button
              type="button"
              className="btn btn-outline-dark w-100"
              onClick={() => setShowParticipantForm(true)}
            >
              Participant quick login
            </button>
          </div>
        )}

        {showParticipantForm && (
          <>
            <div className="d-flex align-items-center my-3">
              <hr className="flex-grow-1" />
              <span className="mx-2 text-muted">OR</span>
              <hr className="flex-grow-1" />
            </div>

            <form onSubmit={participantQuickLogin}>
              <div className="mb-2 text-start">
                <label className="form-label mb-1">Email</label>
                <input
                  type="email"
                  className="form-control"
                  placeholder="yourname@lsu.edu"
                  value={participantEmail}
                  onChange={(e) => {
                    setParticipantEmail(e.target.value);
                    setPrefilledFromLink(false);
                  }}
                  required
                />
              </div>

              <div className="mb-3 text-start">
                <label className="form-label mb-1">Participant ID</label>
                <input
                  type="text"
                  className="form-control"
                  placeholder="e.g., P014"
                  value={participantId}
                  onChange={(e) => {
                    setParticipantId(e.target.value);
                    setPrefilledFromLink(false);
                  }}
                  required
                />
              </div>

              <button
                type="submit"
                className="btn btn-dark w-100"
                disabled={participantSubmitting}
              >
                {participantSubmitting ? "Signing in..." : "Go to Whiteboard"}
              </button>

              <button
                type="button"
                className="btn btn-link mt-2 p-0"
                onClick={() => {
                  setShowParticipantForm(false);
                  setPrefilledFromLink(false);
                }}
              >
                Cancel
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
};

export default LoginPage;

// import React, { useState, useEffect } from "react";
// import {
//   signInWithPopup,
//   signInWithEmailAndPassword,
//   signInAnonymously,
//   updateProfile,
// } from "firebase/auth";
// import {
//   doc,
//   getDoc,
//   collection,
//   query,
//   where,
//   getDocs,
//   setDoc,
//   updateDoc,
//   serverTimestamp,
// } from "firebase/firestore";
// import { useNavigate } from "react-router-dom";
// import { useFlashMessage } from "../FlashMessageContext";
// import "bootstrap/dist/css/bootstrap.min.css";
// import "bootstrap-icons/font/bootstrap-icons.css";
// import { db, auth, googleProvider } from "../firebaseConfig";

// const LoginPage = () => {
//   const DEVELOPER_EMAIL = "saramshgautam@gmail.com";

//   const accessMailto = `mailto:${DEVELOPER_EMAIL}?subject=${encodeURIComponent(
//     "Requesting access to PolyFlux"
//   )}&body=${encodeURIComponent(
//     "Hi,\n\nI want to use PolyFlux and need access.\n\nName: (Enter your name)\nEmail: (Enter your email)\nPassword: (Enter a password)\n\nThanks."
//   )}`;

//   const [message, setMessage] = useState(null); // optional local messages
//   const [email, setEmail] = useState("");
//   const [password, setPassword] = useState("");
//   const [showEmailForm, setShowEmailForm] = useState(false);
//   const [showParticipantForm, setShowParticipantForm] = useState(false);
//   const [participantEmail, setParticipantEmail] = useState("");
//   const [participantId, setParticipantId] = useState("");

//   const navigate = useNavigate();
//   const addMessage = useFlashMessage();

//   useEffect(() => {
//     document.body.classList.add("login-page");
//     return () => {
//       document.body.classList.remove("login-page");
//     };
//   }, []);

//   // const participantQuickLogin = async (e) => {
//   //   e.preventDefault();

//   //   const normalizedEmail = participantEmail.trim().toLowerCase();
//   //   const pid = participantId.trim();

//   //   if (!normalizedEmail || !pid) {
//   //     addMessage("danger", "Please enter both email and Participant ID.");
//   //     return;
//   //   }

//   //   try {
//   //     // 1) Verify participant exists in Firestore
//   //     const userRef = collection(db, "users");
//   //     const q = query(userRef, where("email", "==", normalizedEmail));

//   //     const snap = await getDocs(q);

//   //     if (snap.empty) {
//   //       addMessage(
//   //         "danger",
//   //         "Not found. Please check your email and Participant ID."
//   //       );
//   //       return;
//   //     }

//   //     const userData = snap.docs[0].data();

//   //     // 2) Sign in via Firebase Auth (fastest: anonymous)
//   //     const anonRes = await signInAnonymously(auth);
//   //     const uid = anonRes.user.uid;

//   //     await updateProfile(anonRes.user, {
//   //       displayName: pid,
//   //     });

//   //     await setDoc(doc(db, "participantSessions", uid), {
//   //       uid,
//   //       email: normalizedEmail,
//   //       participantId: pid,
//   //       role: userData.role || "participant",
//   //       studyId: userData.studyId || "evaluation",
//   //       taskName: userData.taskName || "Plan a vacation in United States",
//   //       teamId: userData.teamId || "TeamA",
//   //       createdAt: serverTimestamp(),
//   //     });

//   //     addMessage("success", "Welcome! Redirecting to the whiteboard...");

//   //     const studyId = userData.studyId || "evaluation";
//   //     const taskName = userData.taskName || "Plan a vacation in United States";
//   //     const teamId = userData.teamId || "TeamA";

//   //     navigate(
//   //       `/whiteboard/${encodeURIComponent(studyId)}/${encodeURIComponent(
//   //         taskName
//   //       )}/${encodeURIComponent(teamId)}`
//   //     );
//   //   } catch (err) {
//   //     console.error("Participant quick login failed:", err);
//   //     addMessage("danger", "Login failed. Please try again.");
//   //   }
//   // };

//   const participantQuickLogin = async (e) => {
//     e.preventDefault();

//     const normalizedEmail = participantEmail.trim().toLowerCase();
//     const pid = participantId.trim();

//     if (!normalizedEmail || !pid) {
//       addMessage("danger", "Please enter both email and Participant ID.");
//       return;
//     }

//     try {
//       const userRef = collection(db, "users");
//       const q = query(
//         userRef,
//         where("email", "==", normalizedEmail)
//         // where("participantId", "==", pid)
//       );

//       const snap = await getDocs(q);

//       if (snap.empty) {
//         addMessage(
//           "danger",
//           "Not found. Please check your email and Participant ID."
//         );
//         return;
//       }

//       const userDataSnap = snap.docs[0];
//       const userData = userDataSnap.data();

//       // const assignments = userData.assignments || [];
//       // const rawAssignments = userData.assignments;

//       const rawAssignments = userData.assignment || [];
//       const assignments = Array.isArray(rawAssignments) ? rawAssignments : [];

//       if (assignments.length === 0) {
//         addMessage("danger", "No team assignments found for this participant.");
//         return;
//       }

//       if (assignments.length === 1) {
//         const a = assignments[0];

//         const anonRes = await signInAnonymously(auth);
//         const uid = anonRes.user.uid;

//         await updateProfile(anonRes.user, {
//           displayName: pid,
//         });

//         await setDoc(doc(db, "participantSessions", uid), {
//           uid,
//           email: normalizedEmail,
//           participantId: pid,
//           role: userData.role || "participant",
//           studyId: a.studyId,
//           taskName: a.taskName,
//           teamId: a.teamId,
//           createdAt: serverTimestamp(),
//         });

//         addMessage("success", "Welcome! Redirecting to your whiteboard...");

//         navigate(
//           `/whiteboard/${encodeURIComponent(a.studyId)}/${encodeURIComponent(
//             a.taskName
//           )}/${encodeURIComponent(a.teamId)}`
//         );
//         return;
//       }

//       if (assignments.length > 1) {
//         const assignedWhiteboards = await Promise.all(
//           assignments.map(async (a) => {
//             const classId = a.studyId || "";
//             const classSnap = await getDoc(doc(db, "classrooms", classId));
//             const classData = classSnap.exists() ? classSnap.data() : {};

//             return {
//               classId,
//               className: classId,
//               classDisplayName: classData.class_name || classId,
//               courseID: classData.courseID || classId,
//               semester: classData.semester || "",
//               teacherEmail: classData.teacherEmail || "",
//               projectName: a.taskName || "",
//               teamName: a.teamId || "",
//             };
//           })
//         );

//         console.log("raw assignments:", assignments);
//         console.log("assignedWhiteboards:", assignedWhiteboards);

//         localStorage.setItem("userEmail", normalizedEmail);
//         localStorage.setItem("role", "participant");
//         localStorage.setItem(
//           "assignedWhiteboards",
//           JSON.stringify(assignedWhiteboards)
//         );

//         addMessage("success", "Welcome! Please choose your assigned board.");
//         navigate("/dashboard");
//         return;
//       }
//     } catch (err) {
//       console.error("Participant quick login failed:", err);
//       addMessage("danger", "Login failed. Please try again.");
//     }
//   };

//   // const participantQuickLogin = async (e) => {
//   //   e.preventDefault();

//   //   const normalizedEmail = participantEmail.trim().toLowerCase();
//   //   const pid = participantId.trim();

//   //   if (!normalizedEmail || !pid) {
//   //     addMessage("danger", "Please enter both email and Participant ID.");
//   //     return;
//   //   }

//   //   try {
//   //     const userRef = collection(db, "users");
//   //     const q = query(
//   //       userRef,
//   //       where("email", "==", normalizedEmail)
//   //       // where("participantId", "==", pid)
//   //     );

//   //     const snap = await getDocs(q);

//   //     if (snap.empty) {
//   //       addMessage(
//   //         "danger",
//   //         "Not found. Please check your email and Participant ID."
//   //       );
//   //       return;
//   //     }

//   //     const userDataSnap = snap.docs[0];
//   //     const userData = userDataSnap.data();

//   //     const assignments = userData.assignments || [];
//   //     if (assignments.length === 0) {
//   //       addMessage("danger", "No team assignments found for this participant.");
//   //       return;
//   //     }

//   //     if (assignments.length === 1) {
//   //       const a = assignments[0];
//   //       userData.studyId = a.studyId;
//   //       userData.taskName = a.taskName;
//   //       userData.teamId = a.teamId;

//   //       navigate(
//   //         `/whiteboard/${encodeURIComponent(a.studyId)}/${encodeURIComponent(
//   //           a.taskName
//   //         )}/${encodeURIComponent(a.teamId)}`
//   //       );
//   //       return;
//   //     }

//   //     if (assignments.length > 1) {
//   //       const assignedWhiteboards = assignments.map((a) => ({
//   //         className: a.studyId,
//   //         classDisplayName: a.studyId,
//   //         courseID: a.studyId,
//   //         semester: "",
//   //         teacherEmail: "",
//   //         projectName: a.taskName,
//   //         teamName: a.teamId,
//   //       }));

//   //       localStorage.setItem("userEmail", normalizedEmail);
//   //       localStorage.setItem("role", "participant");
//   //       localStorage.setItem(
//   //         "assignedWhiteboards",
//   //         JSON.stringify(assignedWhiteboards)
//   //       );

//   //       addMessage("success", "Welcome! Please choose your assigned board.");
//   //       navigate("/dashboard");
//   //       return;
//   //     }

//   //     if (!userData.studyId || !userData.taskName || !userData.teamId) {
//   //       addMessage(
//   //         "danger",
//   //         "Your account is not properly set up. Please contact the instructor."
//   //       );
//   //       return;
//   //     }

//   //     const anonRes = await signInAnonymously(auth);
//   //     const uid = anonRes.user.uid;

//   //     await updateProfile(anonRes.user, {
//   //       displayName: pid,
//   //     });

//   //     await setDoc(doc(db, "participantSessions", uid), {
//   //       uid,
//   //       email: normalizedEmail,
//   //       participantId: pid,
//   //       role: userData.role || "participant",
//   //       studyId: userData.studyId,
//   //       taskName: userData.taskName,
//   //       teamId: userData.teamId,
//   //       createdAt: serverTimestamp(),
//   //     });

//   //     addMessage("success", "Welcome! Redirecting to the whiteboard...");

//   //     const studyId = userData.studyId;
//   //     const taskName = userData.taskName;
//   //     const teamId = userData.teamId;

//   //     navigate(
//   //       `/whiteboard/${encodeURIComponent(studyId)}/${encodeURIComponent(
//   //         taskName
//   //       )}/${encodeURIComponent(teamId)}`
//   //     );
//   //   } catch (err) {
//   //     console.error("Participant quick login failed:", err);
//   //     addMessage("danger", "Login failed. Please try again.");
//   //   }
//   // };

//   // const participantQuickLogin = async (e) => {
//   //   e.preventDefault();

//   //   const normalizedEmail = participantEmail.trim().toLowerCase();
//   //   const pid = participantId.trim();

//   //   if (!normalizedEmail || !pid) {
//   //     addMessage("danger", "Please enter both email and Participant ID.");
//   //     return;
//   //   }

//   //   try {
//   //     const userRef = collection(db, "users");
//   //     const q = query(userRef, where("email", "==", normalizedEmail));
//   //     const snap = await getDocs(q);

//   //     if (snap.empty) {
//   //       addMessage(
//   //         "danger",
//   //         "Not found. Please check your email and Participant ID."
//   //       );
//   //       return;
//   //     }
//   //     const userDocSnap = snap.docs[0];
//   //     const userData = userDocSnap.data();

//   //     await updateDoc(userDocSnap.ref, {
//   //       name: pid,
//   //       updatedAt: serverTimestamp(),
//   //       lastParticipantId: pid,
//   //     });

//   //     const anonRes = await signInAnonymously(auth);
//   //     const uid = anonRes.user.uid;

//   //     await updateProfile(anonRes.user, { displayName: pid });

//   //     await setDoc(doc(db, "participantSessions", uid), {
//   //       uid,
//   //       email: normalizedEmail,
//   //       participantId: pid,
//   //       role: userData.role || "participant",
//   //       studyId: userData.studyId || "Eval3333",
//   //       taskName: userData.taskName || "ConditionC2",
//   //       teamId: userData.teamId || "TeamE",
//   //       createdAt: serverTimestamp(),
//   //     });

//   //     addMessage("success", "Welcome! Redirecting to the whiteboard...");

//   //     const studyId = userData.studyId || "Eval3333";
//   //     const taskName = userData.taskName || "ConditionC2";
//   //     const teamId = userData.teamId || "TeamE";

//   //     navigate(
//   //       `/whiteboard/${encodeURIComponent(studyId)}/${encodeURIComponent(
//   //         taskName
//   //       )}/${encodeURIComponent(teamId)}`
//   //     );
//   //   } catch (err) {
//   //     console.error("Participant quick login failed:", err);
//   //     addMessage("danger", "Login failed. Please try again.");
//   //   }
//   // };

//   const handleProfileAndRedirect = async (user) => {
//     const userEmail = (user.email || "").trim().toLowerCase();

//     try {
//       const userDocRef = doc(db, "users", userEmail);
//       const userDocSnap = await getDoc(userDocRef);

//       if (!userDocSnap.exists()) {
//         addMessage(
//           "danger",
//           "Your account is not registered in the system. Please contact the instructor."
//         );
//         return;
//       }

//       const userData = userDocSnap.data();
//       const role = userData.role || "";

//       localStorage.setItem("userEmail", userEmail);
//       localStorage.setItem("role", role);
//       localStorage.removeItem("assignedWhiteboards");

//       if (role === "teacher" || role === "admin") {
//         addMessage("success", "Welcome! Redirecting to your dashboard.");
//         navigate("/dashboard");
//         return;
//       }

//       if (role === "student") {
//         const classroomsRef = collection(db, "classrooms");
//         const classroomsSnap = await getDocs(classroomsRef);

//         const assignedWhiteboards = [];

//         for (const classroomDoc of classroomsSnap.docs) {
//           const classId = classroomDoc.id;
//           const classroomData = classroomDoc.data();

//           const projectsRef = collection(db, "classrooms", classId, "Projects");
//           const projectsSnap = await getDocs(projectsRef);

//           for (const projectDoc of projectsSnap.docs) {
//             const projectId = projectDoc.id;
//             const projectData = projectDoc.data();

//             const teamsRef = collection(
//               db,
//               "classrooms",
//               classId,
//               "Projects",
//               projectId,
//               "teams"
//             );
//             const teamsSnap = await getDocs(teamsRef);

//             for (const teamDoc of teamsSnap.docs) {
//               const teamData = teamDoc.data();

//               const memberEmails = Object.keys(teamData)
//                 .filter((key) => key !== "previewUrl")
//                 .map((email) => email.trim().toLowerCase());

//               if (memberEmails.includes(userEmail)) {
//                 assignedWhiteboards.push({
//                   classId,
//                   className: classId,
//                   classDisplayName: classroomData.class_name || classId,
//                   courseID: classroomData.courseID || classId,
//                   semester: classroomData.semester || "",
//                   teacherEmail: classroomData.teacherEmail || "",
//                   projectName: projectData.projectName || projectId,
//                   teamName: teamDoc.id,
//                 });
//               }
//             }
//           }
//         }

//         if (assignedWhiteboards.length === 0) {
//           addMessage("danger", "You are not assigned to any whiteboards.");
//           return;
//         }

//         localStorage.setItem(
//           "assignedWhiteboards",
//           JSON.stringify(assignedWhiteboards)
//         );

//         addMessage("success", "Welcome! Redirecting to your dashboard.");
//         navigate("/dashboard");
//         return;
//       }

//       addMessage("danger", "Your account role is not recognized.");
//     } catch (err) {
//       console.error("Error during login redirect:", err);
//       addMessage("danger", "Could not load your dashboard.");
//     }
//   };

//   const googleLogin = async () => {
//     try {
//       const result = await signInWithPopup(auth, googleProvider);
//       await handleProfileAndRedirect(result.user);
//     } catch (error) {
//       console.error("Google login failed:", error);
//       addMessage("danger", "Google login failed. Please try again.");
//     }
//   };

//   const emailPasswordLogin = async (e) => {
//     e.preventDefault();
//     try {
//       const result = await signInWithEmailAndPassword(auth, email, password);
//       await handleProfileAndRedirect(result.user);
//     } catch (error) {
//       console.error("Email/password login failed:", error);

//       let msg = "Login failed. Please check your email and password.";
//       if (error.code === "auth/user-not-found") {
//         msg = "No account found for this email.";
//       } else if (error.code === "auth/wrong-password") {
//         msg = "Incorrect password. Please try again.";
//       } else if (error.code === "auth/invalid-email") {
//         msg = "Please enter a valid email address.";
//       }

//       addMessage("danger", msg);
//     }
//   };

//   const renderDeveloperAccessLink = () => (
//     <div className="mt-3">
//       <a href={accessMailto} className="btn btn-link p-0 text-decoration-none">
//         Email the developer for access
//       </a>
//     </div>
//   );

//   return (
//     <div
//       className="d-flex justify-content-center align-items-center min-vh-100"
//       style={{
//         backgroundImage: 'url("/body-bg3.png")',
//         backgroundSize: "cover",
//         backgroundPosition: "center",
//       }}
//     >
//       <div className="login-container p-4 bg-white rounded shadow text-center">
//         <h2
//           className="mb-4"
//           style={{ fontWeight: 700, fontSize: "28px", color: "#333" }}
//         >
//           Welcome to PolyFlux
//         </h2>
//         <img
//           src="/logo.png"
//           alt="App logo"
//           style={{ width: "150px", marginBottom: "20px" }}
//         />

//         <p className="mb-4 text-muted">Collaborate. Create. Reflect.</p>

//         {/* Local flash messages (if you still use `message` state here) */}
//         {message && (
//           <div
//             className={`alert ${
//               message.includes("failed") ? "alert-danger" : "alert-info"
//             }`}
//             role="alert"
//           >
//             <strong>{message}</strong>
//           </div>
//         )}

//         {/* Google login */}
//         <div className="mb-3">
//           <div className="d-flex justify-content-center">
//             <button className="googlebutton" onClick={googleLogin}>
//               <svg
//                 xmlns="http://www.w3.org/2000/svg"
//                 preserveAspectRatio="xMidYMid"
//                 viewBox="0 0 256 262"
//               >
//                 <path
//                   fill="#4285F4"
//                   d="M255.878 133.451c0-10.734-.871-18.567-2.756-26.69H130.55v48.448h71.947c-1.45 12.04-9.283 30.172-26.69 42.356l-.244 1.622 38.755 30.023 2.685.268c24.659-22.774 38.875-56.282 38.875-96.027"
//                 ></path>
//                 <path
//                   fill="#34A853"
//                   d="M130.55 261.1c35.248 0 64.839-11.605 86.453-31.622l-41.196-31.913c-11.024 7.688-25.82 13.055-45.257 13.055-34.523 0-63.824-22.773-74.269-54.25l-1.531.13-40.298 31.187-.527 1.465C35.393 231.798 79.49 261.1 130.55 261.1"
//                 ></path>
//                 <path
//                   fill="#FBBC05"
//                   d="M56.281 156.37c-2.756-8.123-4.351-16.827-4.351-25.82 0-8.994 1.595-17.697 4.206-25.82l-.073-1.73L15.26 71.312l-1.335.635C5.077 89.644 0 109.517 0 130.55s5.077 40.905 13.925 58.602l42.356-32.782"
//                 ></path>
//                 <path
//                   fill="#EB4335"
//                   d="M130.55 50.479c24.514 0 41.05 10.589 50.479 19.438l36.844-35.974C195.245 12.91 165.798 0 130.55 0 79.49 0 35.393 29.301 13.925 71.947l42.211 32.783c10.59-31.477 39.891-54.251 74.414-54.251"
//                 ></path>
//               </svg>
//               Login with Google
//             </button>
//           </div>
//         </div>

//         {/* Small link to reveal email/password form */}
//         {!showEmailForm && (
//           <div className="mt-2">
//             <button
//               type="button"
//               // className="btn btn-link mt-2 p-0"
//               className="btn btn-outline-primary w-100"
//               onClick={() => setShowEmailForm(true)}
//             >
//               Sign in with email instead
//             </button>
//           </div>
//         )}

//         {/* Email/password login: only visible after clicking the link */}
//         {showEmailForm && (
//           <>
//             {/* Divider */}
//             <div className="d-flex align-items-center my-3">
//               <hr className="flex-grow-1" />
//               <span className="mx-2 text-muted">OR</span>
//               <hr className="flex-grow-1" />
//             </div>
//             <form onSubmit={emailPasswordLogin}>
//               <div className="mb-2 text-start">
//                 <label className="form-label mb-1">Email</label>
//                 <input
//                   type="email"
//                   className="form-control"
//                   placeholder="email"
//                   value={email}
//                   onChange={(e) => setEmail(e.target.value)}
//                   required
//                 />
//               </div>

//               <div className="mb-3 text-start">
//                 <label className="form-label mb-1">Password</label>
//                 <input
//                   type="password"
//                   className="form-control"
//                   placeholder="password"
//                   value={password}
//                   onChange={(e) => setPassword(e.target.value)}
//                   required
//                 />
//               </div>

//               <button type="submit" className="btn btn-primary w-100">
//                 Login with Email
//               </button>
//             </form>
//             {renderDeveloperAccessLink()}
//           </>
//         )}

//         {/* Small link to reveal participant quick login */}
//         {!showParticipantForm && (
//           <div className="mt-3">
//             <button
//               type="button"
//               // className="btn btn-link mt-2 p-0"
//               className="btn btn-outline-dark w-100"
//               onClick={() => setShowParticipantForm(true)}
//             >
//               Participant quick login
//             </button>
//           </div>
//         )}

//         {showParticipantForm && (
//           <>
//             <div className="d-flex align-items-center my-3">
//               <hr className="flex-grow-1" />
//               <span className="mx-2 text-muted">OR</span>
//               <hr className="flex-grow-1" />
//             </div>

//             <form onSubmit={participantQuickLogin}>
//               <div className="mb-2 text-start">
//                 <label className="form-label mb-1">Email</label>
//                 <input
//                   type="email"
//                   className="form-control"
//                   placeholder="yourname@lsu.edu"
//                   value={participantEmail}
//                   onChange={(e) => setParticipantEmail(e.target.value)}
//                   required
//                 />
//               </div>

//               <div className="mb-3 text-start">
//                 <label className="form-label mb-1">Participant ID</label>
//                 <input
//                   type="text"
//                   className="form-control"
//                   placeholder="e.g., P014"
//                   value={participantId}
//                   onChange={(e) => setParticipantId(e.target.value)}
//                   required
//                 />
//               </div>

//               <button type="submit" className="btn btn-dark w-100">
//                 Go to Whiteboard
//               </button>

//               <button
//                 type="button"
//                 className="btn btn-link mt-2 p-0"
//                 onClick={() => setShowParticipantForm(false)}
//               >
//                 Cancel
//               </button>
//             </form>
//           </>
//         )}
//       </div>
//     </div>
//   );
// };

// export default LoginPage;
