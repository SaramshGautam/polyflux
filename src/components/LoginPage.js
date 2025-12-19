import React, { useState, useEffect } from "react";
import {
  signInWithPopup,
  signInWithEmailAndPassword,
  signInAnonymously,
} from "firebase/auth";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
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
  const [message, setMessage] = useState(null); // optional local messages
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showEmailForm, setShowEmailForm] = useState(false);
  const [showParticipantForm, setShowParticipantForm] = useState(false);
  const [participantEmail, setParticipantEmail] = useState("");
  const [participantId, setParticipantId] = useState("");

  const navigate = useNavigate();
  const addMessage = useFlashMessage();

  useEffect(() => {
    document.body.classList.add("login-page");
    return () => {
      document.body.classList.remove("login-page");
    };
  }, []);

  const participantQuickLogin = async (e) => {
    e.preventDefault();

    const normalizedEmail = participantEmail.trim().toLowerCase();
    const pid = participantId.trim();

    if (!normalizedEmail || !pid) {
      addMessage("danger", "Please enter both email and Participant ID.");
      return;
    }

    try {
      // 1) Verify participant exists in Firestore
      const userRef = collection(db, "users");
      const q = query(userRef, where("email", "==", normalizedEmail));

      const snap = await getDocs(q);

      if (snap.empty) {
        addMessage(
          "danger",
          "Not found. Please check your email and Participant ID."
        );
        return;
      }

      const userData = snap.docs[0].data();

      // 2) Sign in via Firebase Auth (fastest: anonymous)
      const anonRes = await signInAnonymously(auth);
      const uid = anonRes.user.uid;

      await setDoc(doc(db, "participantSessions", uid), {
        uid,
        email: normalizedEmail,
        participantId: pid,
        role: userData.role || "participant",
        studyId: userData.studyId || "evaluation",
        taskName: userData.taskName || "Plan a vacation in United States",
        teamId: userData.teamId || "TeamA",
        createdAt: serverTimestamp(),
      });

      addMessage("success", "Welcome! Redirecting to the whiteboard...");

      const studyId = userData.studyId || "evaluation";
      const taskName = userData.taskName || "Plan a vacation in United States";
      const teamId = userData.teamId || "TeamA";

      navigate(
        `/whiteboard/${encodeURIComponent(studyId)}/${encodeURIComponent(
          taskName
        )}/${encodeURIComponent(teamId)}`
      );
    } catch (err) {
      console.error("Participant quick login failed:", err);
      addMessage("danger", "Login failed. Please try again.");
    }
  };

  const handleProfileAndRedirect = async (user) => {
    const userEmail = user.email;
    const userName = user.displayName || userEmail;
    const photoURL = user.photoURL || "";

    // OPTIONAL: enforce LSU domain at auth level
    // if (!userEmail.toLowerCase().endsWith("@lsu.edu")) {
    //   addMessage(
    //     "danger",
    //     "Only LSU email accounts are allowed. Please use your LSU email."
    //   );
    //   await auth.signOut();
    //   return;
    // }

    // Fetch profile from Firestore
    const userDocRef = doc(db, "users", userEmail);
    const userDoc = await getDoc(userDocRef);

    if (!userDoc.exists()) {
      addMessage(
        "danger",
        "Your account is not registered in the system. Please contact the instructor."
      );
      await auth.signOut();
      return;
    }

    const userData = userDoc.data();
    const role = userData.role;
    const LSUID = userData.lsuID || null;

    // Store profile locally
    localStorage.setItem("role", role);
    localStorage.setItem("userEmail", userEmail);
    if (photoURL) localStorage.setItem("photoURL", photoURL);
    if (LSUID) localStorage.setItem("LSUID", LSUID);

    console.log("Signed in with Firestore profile:", {
      userEmail,
      role,
      LSUID,
    });

    addMessage("success", `Welcome, ${userName}!`);
    navigate(role === "teacher" ? "/teachers-home" : "/students-home");
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
        {/* {!showEmailForm && (
          <button
            type="button"
            className="btn btn-link mt-2 p-0"
            onClick={() => setShowEmailForm(true)}
          >
            Sign in with email instead
          </button>
        )} */}

        {/* Email/password login: only visible after clicking the link */}
        {showEmailForm && (
          <>
            {/* Divider */}
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
                  placeholder="yourname@lsu.edu"
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
                  placeholder="Enter your password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-primary w-100">
                Login with Email
              </button>
            </form>
          </>
        )}

        {/* Small link to reveal participant quick login */}
        {!showParticipantForm && (
          <button
            type="button"
            className="btn btn-link mt-2 p-0"
            onClick={() => setShowParticipantForm(true)}
          >
            Participant quick login
          </button>
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
                  onChange={(e) => setParticipantEmail(e.target.value)}
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
                  onChange={(e) => setParticipantId(e.target.value)}
                  required
                />
              </div>

              <button type="submit" className="btn btn-dark w-100">
                Go to Whiteboard
              </button>

              <button
                type="button"
                className="btn btn-link mt-2 p-0"
                onClick={() => setShowParticipantForm(false)}
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
