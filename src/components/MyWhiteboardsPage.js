// import React, { useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import "bootstrap/dist/css/bootstrap.min.css";

// const MyWhiteboardsPage = () => {
//   const navigate = useNavigate();

//   const whiteboards = useMemo(() => {
//     try {
//       return JSON.parse(localStorage.getItem("assignedWhiteboards")) || [];
//     } catch {
//       return [];
//     }
//   }, []);

//   const handleOpenWhiteboard = (classId) => {
//     navigate(`/whiteboard/${encodeURIComponent(classId)}`);
//   };

//   return (
//     <div className="container py-5">
//       <div className="mb-4">
//         <h2 className="fw-bold">My PolyFlux Whiteboards</h2>
//         <p className="text-muted mb-0">Select a whiteboard.</p>
//       </div>

//       {whiteboards.length === 0 ? (
//         <div className="alert alert-warning">
//           No whiteboards found for your account.
//         </div>
//       ) : (
//         <div className="row g-3">
//           {whiteboards.map((board) => (
//             <div className="col-md-6 col-lg-4" key={board.classId}>
//               <div className="card h-100 shadow-sm border-0 rounded-4">
//                 <div className="card-body d-flex flex-column">
//                   <h5 className="card-title fw-bold">{board.courseID}</h5>
//                   <p className="card-text mb-1">
//                     <strong>Class:</strong> {board.className}
//                   </p>
//                   <p className="card-text mb-1">
//                     <strong>Semester:</strong> {board.semester}
//                   </p>
//                   <p className="card-text text-muted small mb-4">
//                     Teacher: {board.teacherEmail}
//                   </p>

//                   {/* <button
//                     className="btn btn-dark mt-auto"
//                     onClick={() => handleOpenWhiteboard(board.classId)}
//                   >
//                     Open Whiteboard
//                   </button> */}

//                   <button
//                     className="btn btn-primary mt-auto"
//                     onClick={() =>
//                       navigate(
//                         `/whiteboard/${encodeURIComponent(
//                           board.className
//                         )}/${encodeURIComponent(
//                           board.projectName
//                         )}/${encodeURIComponent(board.teamName)}`
//                       )
//                     }
//                   >
//                     Open Whiteboard
//                   </button>
//                 </div>
//               </div>
//             </div>
//           ))}
//         </div>
//       )}
//     </div>
//   );
// };

// export default MyWhiteboardsPage;

import React, { useMemo, useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, getDoc, doc } from "firebase/firestore";

const MyWhiteboardsPage = () => {
  const navigate = useNavigate();

  const [userRole, setUserRole] = useState("");
  const [userEmail, setUserEmail] = useState("");
  const [loading, setLoading] = useState(true);

  const whiteboards = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("assignedWhiteboards")) || [];
    } catch {
      return [];
    }
  }, []);

  useEffect(() => {
    const auth = getAuth();
    const db = getFirestore();

    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUserEmail("");
        setUserRole("");
        setLoading(false);
        return;
      }

      setUserEmail(user.email);

      try {
        const userRef = doc(db, "users", user.email);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const role = userSnap.data().role || "";
          setUserRole(role);
          console.log("User role:", role);
        } else {
          setUserRole("");
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        setUserRole("");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  const handleOpenWhiteboard = (board) => {
    navigate(
      `/whiteboard/${encodeURIComponent(board.className)}/${encodeURIComponent(
        board.projectName
      )}/${encodeURIComponent(board.teamName)}`
    );
  };

  if (loading) {
    return (
      <div className="container py-5">
        <p>Loading...</p>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="container py-5">
        <div className="alert alert-warning">
          No user logged in. Please sign in to continue.
        </div>
      </div>
    );
  }

  const isTeacher = userRole === "teacher" || userRole === "admin";

  return (
    <div className="container py-5">
      <div className="mb-4 text-center">
        <h2 className="fw-bold">
          {isTeacher ? "Teacher Dashboard" : "My Whiteboards"}
        </h2>
        <p className="text-muted mb-0">
          {isTeacher
            ? "Manage your classrooms and open whiteboards."
            : "Select a whiteboard you are assigned to."}
        </p>
      </div>

      {isTeacher && (
        <div className="d-flex justify-content-center mb-4">
          <button
            className="btn btn-success rounded-pill px-4"
            onClick={() => navigate("/add-classroom")}
          >
            + Add Classroom
          </button>
        </div>
      )}

      {whiteboards.length === 0 ? (
        <div className="alert alert-warning text-center">
          {isTeacher
            ? "No classrooms or whiteboards found for your account."
            : "No whiteboards found for your account."}
        </div>
      ) : (
        <div className="row g-4">
          {whiteboards.map((board) => (
            <div className="col-md-6 col-lg-4" key={board.classId}>
              <div className="card h-100 shadow-sm border-0 rounded-4">
                <div className="card-body d-flex flex-column">
                  <h5 className="card-title fw-bold">{board.courseID}</h5>

                  <p className="card-text mb-1">
                    <strong>Class:</strong> {board.className}
                  </p>

                  <p className="card-text mb-1">
                    <strong>Semester:</strong> {board.semester}
                  </p>

                  <p className="card-text text-muted small mb-4">
                    Teacher: {board.teacherEmail}
                  </p>

                  <button
                    className="btn btn-primary mt-auto"
                    onClick={() => handleOpenWhiteboard(board)}
                  >
                    Open Whiteboard
                  </button>
                </div>
              </div>
            </div>
          ))}

          {isTeacher && (
            <div className="col-md-6 col-lg-4">
              <div
                className="card h-100 shadow-sm border-0 rounded-4 d-flex align-items-center justify-content-center"
                style={{ cursor: "pointer", minHeight: "250px" }}
                onClick={() => navigate("/add-classroom")}
              >
                <div className="text-center">
                  <h4 className="fw-normal mb-0">⊕ Add Classroom</h4>
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MyWhiteboardsPage;
