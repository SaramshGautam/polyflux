import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation, useParams } from "react-router-dom";
import "./Navbar.css";

import { db, auth } from "../../firebaseConfig";
import {
  doc,
  getDoc,
  collection,
  query,
  where,
  getDocs,
} from "firebase/firestore";
import { onAuthStateChanged, signOut } from "firebase/auth";

import SessionSpeechCapture from "../whiteboard/SessionSpeechCapture";

const Navbar = ({ isPublicCanvas = true }) => {
  const navigate = useNavigate();
  const location = useLocation();
  const { className, projectName, teamName } = useParams();
  const isInWhiteboard = location.pathname.startsWith("/whiteboard");
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");

  // Only show the mic in the navbar when we're actually on a whiteboard
  // route with a resolved class/project/team AND the user is looking at
  // the public (synced) canvas, not their private one.
  const canCaptureSpeech =
    isInWhiteboard &&
    isPublicCanvas &&
    !!className &&
    !!projectName &&
    !!teamName;

  const homeRoute = useMemo(() => {
    if (role === "teacher" || role === "student") return "/dashboard";
    if (role === "participant") return "/";
    return "/";
  }, [role]);

  const handleProfileClick = () => {
    setIsProfileOpen((prev) => !prev);
  };

  const handleLogout = async () => {
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Error signing out:", error);
    } finally {
      navigate("/");
    }
  };

  // Close profile dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (e.target.closest(".navbar") === null) {
        setIsProfileOpen(false);
      }
    };
    document.addEventListener("click", handleClickOutside);
    return () => document.removeEventListener("click", handleClickOutside);
  }, []);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      try {
        if (!user) {
          setDisplayName("");
          setRole("");
          return;
        }

        const email = (user.email || "").toLowerCase();

        if (email) {
          const ref = doc(db, "users", email);
          const snap = await getDoc(ref);

          if (snap.exists()) {
            const data = snap.data();
            setDisplayName((data?.name || "User").trim());
            setRole((data?.role || "").trim());
            return;
          }

          const q = query(collection(db, "users"), where("email", "==", email));
          const qsnap = await getDocs(q);

          if (!qsnap.empty) {
            const data = qsnap.docs[0].data();
            setDisplayName((data?.name || "User").trim());
            setRole((data?.role || "").trim());
            return;
          }

          setDisplayName("");
          setRole("");
          return;
        }

        const uid = user.uid;
        const sessionSnap = await getDoc(doc(db, "participantSessions", uid));

        if (sessionSnap.exists()) {
          const session = sessionSnap.data();
          setDisplayName((session?.participantId || "User").trim());
          setRole((session?.role || "participant").trim());
          return;
        }

        setDisplayName("");
        setRole("");
      } catch (err) {
        console.error("Error fetching user data:", err);
        setDisplayName("");
        setRole("");
      }
    });

    return () => unsub();
  }, []);

  return (
    <div className="navbar">
      <div className="navbar-left">
        <img
          src="/logo.png"
          alt="App logo"
          style={{ width: "20px", marginRight: "7px" }}
        />
        <div className="navbar-title" onClick={() => navigate(homeRoute)}>
          PolyFlux
        </div>

        {isInWhiteboard && (
          <div
            title={
              isPublicCanvas
                ? "You're on the shared canvas everyone can see"
                : "You're on your private canvas"
            }
            style={{
              marginLeft: 14,
              padding: "4px 10px",
              borderRadius: 999,
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: "0.02em",
              whiteSpace: "nowrap",
              color: isPublicCanvas ? "#c2680f" : "#0d7d7d",
              background: isPublicCanvas
                ? "rgba(240,140,20,0.12)"
                : "rgba(20,150,150,0.12)",
              border: `1px solid ${
                isPublicCanvas
                  ? "rgba(240,140,20,0.35)"
                  : "rgba(20,150,150,0.35)"
              }`,
            }}
          >
            Canvas: {isPublicCanvas ? "Public" : "Private -- Only you see this"}
          </div>
        )}
      </div>

      <div className="navbar-right">
        {canCaptureSpeech && (
          <SessionSpeechCapture
            className={className}
            projectName={projectName}
            teamName={teamName}
          />
        )}

        <ul
          className="nav-item dropdown"
          style={{
            position: "relative",
            display: "flex",
            alignItems: "center",
          }}
        >
          <li className="nav-link dropdown-toggle" onClick={handleProfileClick}>
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              <div className="navbar-avatar" title={displayName || "User"}>
                {displayName || ""}
              </div>
            </div>
          </li>
          <ul className={`dropdown-menu ${isProfileOpen ? "show" : ""}`}>
            {isInWhiteboard && (
              <li>
                <a
                  className="dropdown-item btn btn-dark btn-sm"
                  href="https://lsu.qualtrics.com/jfe/form/SV_0j3AMzJDxJpwZ4a"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <i className="bi bi-send me-2"></i>
                  Submit Feedback
                </a>
              </li>
            )}

            <li>
              <button
                className="dropdown-item btn btn-dark btn-sm"
                onClick={handleLogout}
              >
                <i className="bi bi-box-arrow-right me-2"></i> Logout
              </button>
            </li>
          </ul>
        </ul>
      </div>
    </div>
  );
};

export default Navbar;
