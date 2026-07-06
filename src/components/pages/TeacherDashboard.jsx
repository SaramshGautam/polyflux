import React, { useState, useEffect } from "react";
import "bootstrap/dist/css/bootstrap.min.css";
import "./TeacherDashboard.css";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";

// Note: this component is rendered by DashboardRouter as:
//   <TeacherDashboard userEmail={userEmail} userRole={userRole} />
// DashboardRouter has already resolved auth state + Firestore role for us,
// so this component trusts those props instead of re-running its own
// onAuthStateChanged/getDoc role lookup. That avoids two separate auth
// listeners racing to decide what the user's role is.
const TeacherDashboard = ({ userEmail, userRole }) => {
  const [classrooms, setClassrooms] = useState({
    groupedClassrooms: {},
    sortedSemesters: [],
  });
  const [loading, setLoading] = useState(true);
  const [teacherNames, setTeacherNames] = useState({});
  const [flashMessage, setFlashMessage] = useState("");
  const [flashMessageType, setFlashMessageType] = useState("");
  const [showAlert, setShowAlert] = useState(false);
  const navigate = useNavigate();

  const sortSemesters = (semesters) => {
    const semesterOrder = { Fall: 1, Summer: 2, Spring: 3 };

    return semesters.sort((a, b) => {
      const yearA = parseInt(a.split(" ")[1]);
      const yearB = parseInt(b.split(" ")[1]);
      const semesterA = a.split(" ")[0];
      const semesterB = b.split(" ")[0];

      if (yearA !== yearB) {
        return yearB - yearA;
      }
      return semesterOrder[semesterA] - semesterOrder[semesterB];
    });
  };

  useEffect(() => {
    const fetchClassrooms = async () => {
      if (!userEmail) {
        setLoading(false);
        return;
      }

      const normalizedUserEmail = userEmail.trim().toLowerCase();

      try {
        setLoading(true);
        const db = getFirestore();
        const classroomsRef = collection(db, "classrooms");
        const querySnapshot = await getDocs(classroomsRef);

        const teacherClassrooms = querySnapshot.docs
          .filter(
            (docSnap) =>
              (docSnap.data().teacherEmail || "").trim().toLowerCase() ===
              normalizedUserEmail
          )
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));

        const groupedClassrooms = teacherClassrooms.reduce((acc, classroom) => {
          const { semester } = classroom;
          if (!acc[semester]) {
            acc[semester] = [];
          }
          acc[semester].push(classroom);
          return acc;
        }, {});

        const sortedSemesters = sortSemesters(Object.keys(groupedClassrooms));

        const teacherEmails = [
          ...new Set(
            teacherClassrooms.map((c) => c.teacherEmail).filter(Boolean)
          ),
        ];

        const teacherNamesObj = {};

        await Promise.all(
          teacherEmails.map(async (email) => {
            try {
              const teacherDoc = await getDoc(doc(db, "users", email));
              teacherNamesObj[email] = teacherDoc.exists()
                ? teacherDoc.data().name || email
                : "Unknown";
            } catch (error) {
              console.error(`Error fetching teacher ${email}:`, error);
              teacherNamesObj[email] = "Error fetching name";
            }
          })
        );

        setTeacherNames(teacherNamesObj);
        setClassrooms({ groupedClassrooms, sortedSemesters });
      } catch (error) {
        console.error("Error fetching classrooms:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchClassrooms();
  }, [userEmail]);

  useEffect(() => {
    const message = localStorage.getItem("flashMessage");
    const messageType = localStorage.getItem("flashMessageType");
    if (message) {
      setFlashMessage(message);
      setFlashMessageType(messageType);
      setShowAlert(true);
      localStorage.removeItem("flashMessage");
      localStorage.removeItem("flashMessageType");
      setTimeout(() => setShowAlert(false), 4000);
    }
  }, []);

  if (loading) {
    return (
      <div className="teacher-dashboard mt-4">
        <p>Loading...</p>
      </div>
    );
  }

  if (!userEmail) {
    return (
      <div className="teacher-dashboard mt-4">
        <p>No user logged in. Please sign in to continue.</p>
      </div>
    );
  }

  return (
    <div className="teacher-dashboard mt-4">
      <h1 className="dashboard-title center-title mb-4">
        <i className="bi bi-person-workspace"></i> Teacher's Dashboard
      </h1>

      {showAlert && (
        <div
          className={`alert-wrapper ${flashMessage ? "fade-in" : "fade-out"}`}
        >
          <div
            className={`alert ${flashMessageType === "error" ? "error" : ""}`}
          >
            {flashMessage}
            <button
              type="button"
              className="btn-close"
              onClick={() => setShowAlert(false)}
            >
              &times;
            </button>
          </div>
        </div>
      )}

      {(userRole === "admin" || userRole === "teacher") && (
        <div
          className="admin-button-container"
          style={{ textAlign: "center", marginBottom: "1rem" }}
        >
          <button
            className="admin-add-user-button"
            onClick={() => navigate("/admin/upload")}
          >
            ➕ Add Participants
          </button>
        </div>
      )}

      <div className="classrooms-list">
        {classrooms.sortedSemesters.length > 0 ? (
          classrooms.sortedSemesters.map((semester, semesterIndex) => (
            <div key={semester} className="semester-section">
              <h4 className={semester === "Fall 2025" ? "fall-2025" : ""}>
                {semester}
              </h4>

              <div className="classrooms-grid">
                {classrooms.groupedClassrooms[semester].map((classroom) => (
                  <div
                    key={classroom.id}
                    className="classroom-card"
                    onClick={() => navigate(`/classroom/${classroom.classID}`)}
                  >
                    <div className="card-title">
                      <h4>
                        {classroom.courseID} - {classroom.class_name}
                      </h4>
                    </div>
                    <div className="card-text">
                      Instructor:{" "}
                      {teacherNames[classroom.teacherEmail] ||
                        classroom.teacherEmail ||
                        "Fetching..."}
                    </div>
                  </div>
                ))}
                {semesterIndex === 0 && (
                  <div className="card-wrapper">
                    <div
                      className="classroom-card add-classroom-card"
                      onClick={() => navigate("/add-classroom")}
                    >
                      <h4>⊕ Add Classroom</h4>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="row">
            <div className="col-md-4 mb-2">
              <div
                className="classroom-card"
                onClick={() => navigate("/add-classroom")}
              >
                <div className="card-body d-flex align-items-center justify-content-center">
                  <h5
                    className="card-title text-center"
                    style={{ fontWeight: "normal" }}
                  >
                    <i className="bi bi-plus-circle"></i> Add Classroom
                  </h5>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default TeacherDashboard;

// import React, { useEffect, useState } from "react";
// import { useNavigate } from "react-router-dom";
// import "bootstrap/dist/css/bootstrap.min.css";
// import {
//   getFirestore,
//   collection,
//   getDocs,
//   getDoc,
//   doc,
// } from "firebase/firestore";

// const TeacherDashboard = ({ userEmail, userRole }) => {
//   const navigate = useNavigate();

//   const [classrooms, setClassrooms] = useState([]);
//   const [teacherNames, setTeacherNames] = useState({});
//   const [loading, setLoading] = useState(true);

//   useEffect(() => {
//     const fetchClassrooms = async () => {
//       if (!userEmail) return;

//       try {
//         setLoading(true);
//         const db = getFirestore();
//         const classroomsRef = collection(db, "classrooms");
//         const querySnapshot = await getDocs(classroomsRef);

//         const teacherClassrooms = querySnapshot.docs
//           .filter((docSnap) => docSnap.data().teacherEmail === userEmail)
//           .map((docSnap) => ({
//             id: docSnap.id,
//             ...docSnap.data(),
//           }));

//         setClassrooms(teacherClassrooms);

//         const teacherEmails = [
//           ...new Set(
//             teacherClassrooms.map((c) => c.teacherEmail).filter(Boolean)
//           ),
//         ];

//         const teacherNamesObj = {};

//         await Promise.all(
//           teacherEmails.map(async (email) => {
//             try {
//               const teacherDoc = await getDoc(doc(db, "users", email));
//               if (teacherDoc.exists()) {
//                 teacherNamesObj[email] =
//                   teacherDoc.data().name || teacherDoc.data().email || email;
//               } else {
//                 teacherNamesObj[email] = email;
//               }
//             } catch (error) {
//               console.error(`Error fetching teacher ${email}:`, error);
//               teacherNamesObj[email] = email;
//             }
//           })
//         );

//         setTeacherNames(teacherNamesObj);
//       } catch (error) {
//         console.error("Error fetching classrooms:", error);
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchClassrooms();
//   }, [userEmail]);

//   const handleOpenClassroom = (classroom) => {
//     navigate(`/classroom/${encodeURIComponent(classroom.classID)}`);
//   };

//   if (loading) {
//     return (
//       <div className="container py-5">
//         <p>Loading...</p>
//       </div>
//     );
//   }

//   return (
//     <div className="container py-5">
//       <div className="mb-4 text-center">
//         <h2 className="fw-bold">Teacher Dashboard</h2>
//         <p className="text-muted mb-0">
//           Manage your classrooms and open class workspaces.
//         </p>
//       </div>

//       <div className="d-flex justify-content-center mb-4 gap-2">
//         <button
//           className="btn btn-success rounded-pill px-4"
//           onClick={() => navigate("/add-classroom")}
//         >
//           + Add Classroom
//         </button>

//         {userRole === "admin" && (
//           <button
//             className="btn btn-dark rounded-pill px-4"
//             onClick={() => navigate("/add-user")}
//           >
//             + Add User
//           </button>
//         )}
//       </div>

//       {classrooms.length === 0 ? (
//         <div className="row g-4">
//           <div className="col-md-6 col-lg-4">
//             <div
//               className="card h-100 shadow-sm border-0 rounded-4 d-flex align-items-center justify-content-center"
//               style={{ cursor: "pointer", minHeight: "220px" }}
//               onClick={() => navigate("/add-classroom")}
//             >
//               <div className="text-center">
//                 <h4 className="fw-normal mb-0">⊕ Add Classroom</h4>
//               </div>
//             </div>
//           </div>
//         </div>
//       ) : (
//         <div className="row g-4">
//           {classrooms.map((classroom) => (
//             <div className="col-md-6 col-lg-4" key={classroom.id}>
//               <div
//                 className="card h-100 shadow-sm border-0 rounded-4"
//                 style={{ cursor: "pointer" }}
//                 onClick={() => handleOpenClassroom(classroom)}
//               >
//                 <div className="card-body d-flex flex-column">
//                   <h5 className="card-title fw-bold">
//                     {classroom.courseID} -{" "}
//                     {classroom.class_name || classroom.className}
//                   </h5>

//                   <p className="card-text mb-1">
//                     <strong>Semester:</strong> {classroom.semester || "N/A"}
//                   </p>

//                   <p className="card-text text-muted small mb-4">
//                     Instructor:{" "}
//                     {teacherNames[classroom.teacherEmail] ||
//                       classroom.teacherEmail ||
//                       "Unknown"}
//                   </p>

//                   <button
//                     className="btn btn-primary mt-auto"
//                     onClick={(e) => {
//                       e.stopPropagation();
//                       handleOpenClassroom(classroom);
//                     }}
//                   >
//                     Open Classroom
//                   </button>
//                 </div>
//               </div>
//             </div>
//           ))}

//           <div className="col-md-6 col-lg-4">
//             <div
//               className="card h-100 shadow-sm border-0 rounded-4 d-flex align-items-center justify-content-center"
//               style={{ cursor: "pointer", minHeight: "220px" }}
//               onClick={() => navigate("/add-classroom")}
//             >
//               <div className="text-center">
//                 <h4 className="fw-normal mb-0">⊕ Add Classroom</h4>
//               </div>
//             </div>
//           </div>
//         </div>
//       )}
//     </div>
//   );
// };

// export default TeacherDashboard;
