import React from "react";
import { Routes, Route, useNavigate, useLocation } from "react-router-dom";

// Importing pages
import LoginPage from "./components/LoginPage";
import TeachersHome from "./components/TeachersHome";
import StudentsHome from "./components/StudentsHome";
import Classroom from "./components/Classroom";
import AddProject from "./components/AddProject";
import AddStudent from "./components/AddStudent";
import AddClassroom from "./components/AddClassroom";
import ManageTeams from "./components/ManageTeam";
import Project from "./components/Project";
import EditProject from "./components/EditProject";
import EditStudent from "./components/EditStudent";
import ManageStudent from "./components/ManageStudent";
import EditClassroom from "./components/EditClassroom";
import Team from "./components/Team";
import InactivityMonitor from "./components/InactivityMonitor";
import CollaborativeWhiteboard from "./components/CollaborativeWhiteboard";
import ExportMovesPanel from "./components/ExportMovesPanel";

import FinishSignIn from "./components/FinishSignIn";
import AddUser from "./utils/AddUser";
import "./style.css";

import { signInWithPopup } from "firebase/auth";
import { app, db, auth, googleProvider, storage } from "./firebaseConfig";
import "./App.css";
import Navbar from "./components/navbar/Navbar";

const App = () => {
  const navigate = useNavigate();
  const location = useLocation();

  const googleLogin = async () => {
    try {
      const result = await signInWithPopup(auth, googleProvider);
      const user = result.user;
      const idToken = await user.getIdToken(); // Get ID token

      // Send the ID token to the backend for validation
      // const response = await fetch("http://localhost:5000/api/login", {
      const response = await fetch(
        "https://flask-app-jqwkqdscaq-uc.a.run.app/api/login",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ idToken: idToken }),
        }
      );

      const data = await response.json();
      console.log("Login response:", data);

      if (data.success) {
        // Handle successful login based on the role
        if (data.role === "teacher" || data.role === "admin") {
          navigate("/teachers-home");
        } else if (data.role === "student") {
          navigate("/students-home");
        }
      } else {
        console.error(data.message);
      }
    } catch (error) {
      console.error("Google login failed:", error);
    }
  };

  return (
    <Routes>
      {/* Login Page */}
      <Route path="/" element={<LoginPage onLogin={googleLogin} />} />

      <Route path="/finishSignIn" element={<FinishSignIn />} />

      {/* Teacher's Home */}
      <Route
        path="/teachers-home"
        element={
          <>
            <Navbar />
            <TeachersHome />
          </>
        }
      />

      {/* Student's Home */}
      <Route
        path="/students-home"
        element={
          <>
            <Navbar />
            <StudentsHome />
          </>
        }
      />

      {/* Add User */}
      <Route
        path="/add-user"
        element={
          <>
            <Navbar />
            <AddUser />
          </>
        }
      />

      {/* Classroom Management */}
      <Route
        path="/classroom/:className"
        element={
          <>
            <Navbar />
            <Classroom />
          </>
        }
      />
      <Route
        path="/classroom/:className/add-project"
        element={
          <>
            <Navbar />
            <AddProject />
          </>
        }
      />
      <Route
        path="/classroom/:className/add-student"
        element={
          <>
            <Navbar />
            <AddStudent />
          </>
        }
      />
      <Route
        path="/classroom/:className/project/:projectName"
        element={
          <>
            <Navbar />
            <Project />
          </>
        }
      />
      <Route
        path="/classroom/:className/project/:projectName/edit"
        element={
          <>
            <Navbar />
            <EditProject />
          </>
        }
      />
      <Route
        path="/classroom/:className/project/:projectName/team/:teamName"
        element={
          <>
            <Navbar />
            <Team />
          </>
        }
      />
      <Route
        path="/classroom/:className/edit"
        element={
          <>
            <Navbar />
            <EditClassroom />
          </>
        }
      />

      {/* Manage Students */}
      <Route
        path="/classroom/:className/manage-students"
        element={
          <>
            <Navbar />
            <ManageStudent />
          </>
        }
      />
      <Route
        path="/classroom/:className/manage-students/:studentId/edit"
        element={
          <>
            <Navbar />
            <EditStudent />
          </>
        }
      />
      <Route
        path="/classroom/:className/manage-students/add-student"
        element={
          <>
            <Navbar />
            <AddStudent />
          </>
        }
      />
      <Route
        path="/classroom/:className/project/:projectName/manage-teams"
        element={
          <>
            <Navbar />
            <ManageTeams />
          </>
        }
      />

      {/* Add Classroom */}
      <Route
        path="/add-classroom"
        element={
          <>
            <Navbar />
            <AddClassroom />
          </>
        }
      />

      {/* Collaborative Whiteboard */}
      <Route
        path="/whiteboard/:className/:projectName/:teamName"
        // element={<CollaborativeWhiteboard />}
        element={
          <>
            <CollaborativeWhiteboard />
            {/* <ChatBot toggleSidebar={toggleSidebar} /> */}
            {/* {userRole === "teacher" && ( */}
            <InactivityMonitor
              // className={className}
              // projectName={projectName}
              // teamName={teamName}
              // className={useParams().className}
              // projectName={useParams().projectName}
              // teamName={useParams().teamName}
              className="CSC7999"
              projectName="Mark1"
              teamName="Team 1"
            />
            {/* )} */}
          </>
        }
      />

      <Route
        path="/export/:className/:projectName/:teamName"
        element={
          <>
            <Navbar />
            <ExportMovesPanel />
          </>
        }
      />
    </Routes>
  );
};

export default App;
