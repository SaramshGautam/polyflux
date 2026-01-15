import React, { useState, useEffect, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
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

const Navbar = () => {
  const navigate = useNavigate();
  const location = useLocation();
  const isInWhiteboard = location.pathname.startsWith("/whiteboard");
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  const [displayName, setDisplayName] = useState("");
  const [role, setRole] = useState("");

  const homeRoute = useMemo(() => {
    if (role === "teacher") return "/teachers-home";
    if (role === "student" || role === "participant") return "/students-home";
    return "/";
  }, [role]);

  // const role = localStorage.getItem("role");
  // const photoURL = localStorage.getItem("photoURL");
  // const homeRoute =
  //   role === "teacher"
  //     ? "/teachers-home"
  //     : role === "student" || role === "participant"
  //     ? "/students-home"
  //     : "/";

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

  // const handleLogout = () => {
  //   localStorage.removeItem("role");
  //   localStorage.removeItem("photoURL");
  //   navigate("/"); // Redirect to login page
  // };

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

        // ✅ If user has email (Google / email-password)
        const email = (user.email || "").toLowerCase();

        if (email) {
          // 1) Fast path: doc id is email
          const ref = doc(db, "users", email);
          const snap = await getDoc(ref);

          if (snap.exists()) {
            const data = snap.data();
            setDisplayName((data?.name || "User").trim());
            setRole((data?.role || "").trim());
            return; // ✅ stop here, don’t run the query too
          }

          // 2) Fallback: query by email field
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

        // ✅ Anonymous user (participant quick login)
        // If you want participants to show P# in Navbar, you must read participantSessions/{uid}
        // Example:
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
        {/* Logo and links */}
        <img
          src="/logo.png"
          alt="App logo"
          style={{ width: "20px", marginRight: "7px" }}
        />
        <div className="navbar-title" onClick={() => navigate(homeRoute)}>
          PolyFlux
        </div>
        {/* <div className="navbar-links">
          <a href="#about">About</a>
          <a href="#contact">Contact</a>
        </div> */}
      </div>
      <div className="navbar-right">
        <ul className="nav-item dropdown">
          <li className="nav-link dropdown-toggle" onClick={handleProfileClick}>
            {/* {photoURL ? (
              <img
                src={photoURL}
                alt="Profile"
                className="profile-picture"
                style={{
                  width: "35px",
                  height: "35px",
                  borderRadius: "50%",
                  objectFit: "cover",
                  cursor: "pointer",
                  border: "2px solid white",
                }}
              />
            ) : (
              <i
                className="bi bi-person"
                style={{ fontSize: "24px", color: "white" }}
              ></i>
            )} */}
            <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
              {/* Initials avatar */}
              <div
                style={{
                  width: "34px",
                  height: "34px",
                  borderRadius: "50%",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontWeight: 700,
                  fontSize: "14px",
                  background: "rgba(255,255,255,0.18)",
                  border: "2px solid white",
                  color: "white",
                  userSelect: "none",
                }}
                title={displayName || "User"}
              >
                {displayName || ""}
              </div>
            </div>
          </li>
          {/* Dropdown Menu */}
          <ul className={`dropdown-menu ${isProfileOpen ? "show" : ""}`}>
            {isInWhiteboard && (
              <li>
                <a
                  className="dropdown-item btn btn-dark btn-sm"
                  // href="https://lsu.qualtrics.com/jfe/form/SV_ea1qXwTavlQNfv0"
                  href="https://lsu.qualtrics.com/jfe/form/SV_09zhlg18ScvPSmi"
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
