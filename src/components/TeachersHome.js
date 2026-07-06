import React, { useState, useEffect } from "react";
// import "../styles/TeacherDashboard.css";
import "./TeacherDashboard.css"; // Adjust the path as necessary
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";

const TeacherHome = () => {
  const [classrooms, setClassrooms] = useState({
    groupedClassrooms: {},
    sortedSemesters: [],
  });
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState(null);
  const [userRole, setUserRole] = useState("");
  const [teacherNames, setTeacherNames] = useState({});
  const [flashMessage, setFlashMessage] = useState("");
  const [flashMessageType, setFlashMessageType] = useState("");
  const [showAlert, setShowAlert] = useState(false);
  const navigate = useNavigate();
  const auth = getAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserEmail(user.email);

        const fetchUserRole = async () => {
          try {
            const userDoc = await getDoc(
              doc(getFirestore(), "users", user.email)
            );
            if (userDoc.exists()) {
              setUserRole(userDoc.data().role);
              console.log("🟢 User Role from Firestore:", userDoc.data().role);
            }
          } catch (error) {
            console.error("Error fetching user role:", error);
          }
        };
        fetchUserRole();
      } else {
        setUserEmail(null);
        setUserRole("teacher");
        setClassrooms({ groupedClassrooms: {}, sortedSemesters: [] });
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth]);

  const sortSemesters = (semesters) => {
    const semesterOrder = {
      Fall: 1,
      Summer: 2,
      Spring: 3,
    };

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
      if (!userEmail) return;

      try {
        setLoading(true);
        const db = getFirestore();
        const classroomsRef = collection(db, "classrooms");
        const querySnapshot = await getDocs(classroomsRef);

        const teacherClassrooms = querySnapshot.docs
          .filter((doc) => doc.data().teacherEmail === userEmail)
          .map((doc) => ({
            id: doc.id,
            ...doc.data(),
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
          ...new Set(teacherClassrooms.map((c) => c.teacherEmail)),
        ];
        console.log("Fetching teacher names for emails:", teacherEmails);

        const teacherNamesObj = {};

        const teacherPromises = teacherEmails.map(async (email) => {
          try {
            const teacherDocRef = doc(db, "users", email);
            const teacherDoc = await getDoc(teacherDocRef);

            if (teacherDoc.exists()) {
              teacherNamesObj[email] = teacherDoc.data().name;
            } else {
              console.warn(`No document found for teacher email: ${email}`);
              teacherNamesObj[email] = "Unknown";
            }
          } catch (error) {
            console.error(`Error fetching teacher ${email}:`, error);
            teacherNamesObj[email] = "Error fetching name";
          }
        });

        await Promise.all(teacherPromises);

        console.log("Fetched Teacher Names:", teacherNamesObj);

        setTeacherNames(teacherNamesObj);
        console.log(
          "Teachers name in the teacherNames state variable:",
          teacherNames
        );

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

  return (
    <div className="teacher-dashboard mt-4">
      {loading ? (
        <p>Loading...</p>
      ) : userEmail ? (
        <>
          <h1 className="dashboard-title center-title mb-4">
            <i className="bi bi-person-workspace"></i> Teacher's Dashboard
          </h1>

          {showAlert && (
            <div
              className={`alert-wrapper ${
                flashMessage ? "fade-in" : "fade-out"
              }`}
            >
              <div
                className={`alert ${
                  flashMessageType === "error" ? "error" : ""
                }`}
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
                        onClick={() =>
                          navigate(`/classroom/${classroom.classID}`)
                        }
                      >
                        <div className="card-title">
                          <h4>
                            {classroom.courseID} - {classroom.class_name}
                          </h4>
                        </div>
                        <div className="card-text">
                          Instructor:{" "}
                          {teacherNames[classroom.teacherEmail]
                            ? teacherNames[classroom.teacherEmail]
                            : classroom.teacherEmail || "Fetching..."}
                        </div>
                      </div>
                    ))}
                    {/* Add Classroom Card at the end of the first semester */}
                    {semesterIndex === 0 && (
                      <div className="card-wrapper">
                        <div
                          className="classroom-card add-classroom-card"
                          onClick={() => navigate("/add-classroom")}
                        >
                          <h4>⊕ Add classes</h4>
                        </div>

                        {/* {(userRole === "admin" || userRole === "teacher") && ( */}
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
                        {/* )} */}
                      </div>
                    )}
                  </div>
                </div>
              ))
            ) : (
              // When no classrooms exist, show only the Add Classroom card
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
        </>
      ) : (
        <p>No user logged in. Please sign in to continue.</p>
      )}
    </div>
  );
};

export default TeacherHome;

// import React, { useState, useEffect } from "react";
// // import "../styles/TeacherDashboard.css";
// import "./TeacherDashboard.css"; // Adjust the path as necessary
// import {
//   getFirestore,
//   collection,
//   getDocs,
//   getDoc,
//   doc,
// } from "firebase/firestore";
// import { useNavigate } from "react-router-dom";
// import { getAuth, onAuthStateChanged } from "firebase/auth";

// const TeacherHome = () => {
//   const [classrooms, setClassrooms] = useState({
//     groupedClassrooms: {},
//     sortedSemesters: [],
//   });
//   const [loading, setLoading] = useState(true);
//   const [userEmail, setUserEmail] = useState(null);
//   const [userRole, setUserRole] = useState("");
//   const [teacherNames, setTeacherNames] = useState({});
//   const [flashMessage, setFlashMessage] = useState("");
//   const [flashMessageType, setFlashMessageType] = useState("");
//   const [showAlert, setShowAlert] = useState(false);
//   const navigate = useNavigate();
//   const auth = getAuth();

//   useEffect(() => {
//     const unsubscribe = onAuthStateChanged(auth, (user) => {
//       if (user) {
//         setUserEmail(user.email);

//         const fetchUserRole = async () => {
//           try {
//             const userDoc = await getDoc(
//               doc(getFirestore(), "users", user.email)
//             );
//             if (userDoc.exists()) {
//               setUserRole(userDoc.data().role);
//               console.log("🟢 User Role from Firestore:", userDoc.data().role);
//             }
//           } catch (error) {
//             console.error("Error fetching user role:", error);
//           }
//         };
//         fetchUserRole();
//       } else {
//         setUserEmail(null);
//         setUserRole("teacher");
//         setClassrooms({ groupedClassrooms: {}, sortedSemesters: [] });
//       }
//       setLoading(false);
//     });

//     return () => unsubscribe();
//   }, [auth]);

//   const sortSemesters = (semesters) => {
//     const semesterOrder = {
//       Fall: 1,
//       Summer: 2,
//       Spring: 3,
//     };

//     return semesters.sort((a, b) => {
//       const yearA = parseInt(a.split(" ")[1]);
//       const yearB = parseInt(b.split(" ")[1]);
//       const semesterA = a.split(" ")[0];
//       const semesterB = b.split(" ")[0];

//       if (yearA !== yearB) {
//         return yearB - yearA;
//       }
//       return semesterOrder[semesterA] - semesterOrder[semesterB];
//     });
//   };

//   useEffect(() => {
//     const fetchClassrooms = async () => {
//       if (!userEmail) return;

//       try {
//         setLoading(true);
//         const db = getFirestore();
//         const classroomsRef = collection(db, "classrooms");
//         const querySnapshot = await getDocs(classroomsRef);

//         const teacherClassrooms = querySnapshot.docs
//           .filter((doc) => doc.data().teacherEmail === userEmail)
//           .map((doc) => ({
//             id: doc.id,
//             ...doc.data(),
//           }));

//         const groupedClassrooms = teacherClassrooms.reduce((acc, classroom) => {
//           const { semester } = classroom;
//           if (!acc[semester]) {
//             acc[semester] = [];
//           }
//           acc[semester].push(classroom);
//           return acc;
//         }, {});

//         const sortedSemesters = sortSemesters(Object.keys(groupedClassrooms));

//         const teacherEmails = [
//           ...new Set(teacherClassrooms.map((c) => c.teacherEmail)),
//         ];
//         console.log("Fetching teacher names for emails:", teacherEmails);

//         const teacherNamesObj = {};

//         const teacherPromises = teacherEmails.map(async (email) => {
//           try {
//             const teacherDocRef = doc(db, "users", email);
//             const teacherDoc = await getDoc(teacherDocRef);

//             if (teacherDoc.exists()) {
//               teacherNamesObj[email] = teacherDoc.data().name;
//             } else {
//               console.warn(`No document found for teacher email: ${email}`);
//               teacherNamesObj[email] = "Unknown";
//             }
//           } catch (error) {
//             console.error(`Error fetching teacher ${email}:`, error);
//             teacherNamesObj[email] = "Error fetching name";
//           }
//         });

//         await Promise.all(teacherPromises);

//         console.log("Fetched Teacher Names:", teacherNamesObj);

//         setTeacherNames(teacherNamesObj);
//         console.log(
//           "Teachers name in the teacherNames state variable:",
//           teacherNames
//         );

//         setClassrooms({ groupedClassrooms, sortedSemesters });
//       } catch (error) {
//         console.error("Error fetching classrooms:", error);
//       } finally {
//         setLoading(false);
//       }
//     };

//     fetchClassrooms();
//   }, [userEmail]);

//   useEffect(() => {
//     const message = localStorage.getItem("flashMessage");
//     const messageType = localStorage.getItem("flashMessageType");
//     if (message) {
//       setFlashMessage(message);
//       setFlashMessageType(messageType);
//       setShowAlert(true);
//       localStorage.removeItem("flashMessage");
//       localStorage.removeItem("flashMessageType");
//       setTimeout(() => setShowAlert(false), 4000);
//     }
//   }, []);

//   return (
//     <div className="teacher-dashboard mt-4">
//       {loading ? (
//         <p>Loading...</p>
//       ) : userEmail ? (
//         <>
//           <h1 className="dashboard-title center-title mb-4">
//             <i className="bi bi-person-workspace"></i> Teacher's Dashboard
//           </h1>

//           {showAlert && (
//             <div
//               className={`alert-wrapper ${
//                 flashMessage ? "fade-in" : "fade-out"
//               }`}
//             >
//               <div
//                 className={`alert ${
//                   flashMessageType === "error" ? "error" : ""
//                 }`}
//               >
//                 {flashMessage}
//                 <button
//                   type="button"
//                   className="btn-close"
//                   onClick={() => setShowAlert(false)}
//                 >
//                   &times;
//                 </button>
//               </div>
//             </div>
//           )}

//           {/* {userRole === "admin" && ( */}
//           <div
//             className="admin-button-container"
//             style={{ textAlign: "center", marginBottom: "1rem" }}
//           >
//             <button
//               className="admin-add-user-button"
//               onClick={() => navigate("/add-user")}
//             >
//               ➕ Add User
//             </button>
//           </div>
//           {/* )} */}

//           <div className="classrooms-list">
//             {classrooms.sortedSemesters.length > 0 ? (
//               classrooms.sortedSemesters.map((semester, semesterIndex) => (
//                 <div key={semester} className="semester-section">
//                   <h4 className={semester === "Fall 2025" ? "fall-2025" : ""}>
//                     {semester}
//                   </h4>

//                   {/* <div className="row"> */}
//                   <div className="classrooms-grid">
//                     {classrooms.groupedClassrooms[semester].map((classroom) => (
//                       // <div key={classroom.id} className="card-wrapper">
//                       // <div key={classroom.id} className="col-md-4 mb-2">
//                       <div
//                         key={classroom.id}
//                         className="classroom-card"
//                         onClick={() =>
//                           navigate(`/classroom/${classroom.classID}`)
//                         }
//                       >
//                         <div className="card-title">
//                           <h4>
//                             {classroom.courseID} - {classroom.class_name}
//                           </h4>
//                         </div>
//                         <div className="card-text">
//                           Instructor:{" "}
//                           {teacherNames[classroom.teacherEmail]
//                             ? teacherNames[classroom.teacherEmail]
//                             : classroom.teacherEmail || "Fetching..."}
//                         </div>
//                         {/* <div
//                           className="classroom-card"
//                           onClick={() =>
//                             navigate(`/classroom/${classroom.classID}`)
//                           }
//                         > */}
//                         {/* <div className="card-body">
//                             <h5 className="card-title">
//                               {classroom.courseID} - {classroom.class_name}
//                             </h5>

//                             <p className="card-text">
//                               Instructor:{" "}
//                               {teacherNames[classroom.teacherEmail]
//                                 ? teacherNames[classroom.teacherEmail]
//                                 : classroom.teacherEmail || "Fetching..."}
//                             </p>
//                           </div> */}
//                         {/* </div> */}
//                       </div>
//                     ))}
//                     {/* Add Classroom Card at the end of the first semester */}
//                     {semesterIndex === 0 && (
//                       <div className="card-wrapper">
//                         <div
//                           className="classroom-card add-classroom-card"
//                           onClick={() => navigate("/add-classroom")}
//                         >
//                           <h4>⊕ Add Classroom</h4>
//                         </div>
//                         {/* <div
//                           className="classroom-card"
//                           onClick={() => navigate("/add-classroom")}
//                         >
//                           <div className="card-body d-flex align-items-center justify-content-center">
//                             <h5
//                               className="card-title text-center"
//                               style={{ fontWeight: "normal" }}
//                             >
//                               <i className="bi bi-plus-circle"></i> Add
//                               Classroom
//                             </h5>
//                           </div>
//                         </div> */}
//                       </div>
//                     )}
//                   </div>
//                 </div>
//               ))
//             ) : (
//               // When no classrooms exist, show only the Add Classroom card
//               <div className="row">
//                 <div className="col-md-4 mb-2">
//                   <div
//                     className="classroom-card"
//                     onClick={() => navigate("/add-classroom")}
//                   >
//                     <div className="card-body d-flex align-items-center justify-content-center">
//                       <h5
//                         className="card-title text-center"
//                         style={{ fontWeight: "normal" }}
//                       >
//                         <i className="bi bi-plus-circle"></i> Add Classroom
//                       </h5>
//                     </div>
//                   </div>
//                 </div>
//               </div>
//             )}
//           </div>
//         </>
//       ) : (
//         <p>No user logged in. Please sign in to continue.</p>
//       )}
//     </div>
//   );
// };

// export default TeacherHome;
