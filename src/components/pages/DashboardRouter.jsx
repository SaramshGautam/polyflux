import React, { useEffect, useState } from "react";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import { getFirestore, doc, getDoc } from "firebase/firestore";
import TeacherDashboard from "./TeacherDashboard";
import StudentWhiteboards from "./StudentWhiteboards";

const DashboardRouter = () => {
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState("");
  const [userEmail, setUserEmail] = useState("");

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

      try {
        if (user.email) {
          // Regular teacher/student sign-in (Google or email/password).
          const email = user.email.toLowerCase();
          setUserEmail(email);

          const userRef = doc(db, "users", email);
          const userSnap = await getDoc(userRef);

          setUserRole(userSnap.exists() ? userSnap.data().role || "" : "");
        } else {
          // Anonymous auth = the participant quick-login flow. Look up
          // the session we wrote at login time; if for some reason it's
          // missing, fall back to what LoginPage stored in localStorage.
          const sessionSnap = await getDoc(
            doc(db, "participantSessions", user.uid)
          );

          if (sessionSnap.exists()) {
            const sessionData = sessionSnap.data();
            setUserEmail(sessionData.email || "");
            setUserRole(sessionData.role || "participant");
          } else {
            setUserEmail(localStorage.getItem("userEmail") || "");
            setUserRole(localStorage.getItem("role") || "");
          }
        }
      } catch (error) {
        console.error("Error fetching user role:", error);
        setUserRole("");
        setUserEmail("");
      } finally {
        setLoading(false);
      }
    });

    return () => unsubscribe();
  }, []);

  if (loading) {
    return (
      <div className="container py-5">
        <p>Loading...</p>
      </div>
    );
  }

  if (!userRole) {
    return (
      <div className="container py-5">
        <div className="alert alert-warning">
          No user logged in. Please sign in to continue.
        </div>
      </div>
    );
  }

  if (userRole === "teacher" || userRole === "admin") {
    return <TeacherDashboard userEmail={userEmail} userRole={userRole} />;
  }

  return <StudentWhiteboards userEmail={userEmail} />;
};

export default DashboardRouter;

// // import React, { useEffect, useState } from "react";
// // import { getAuth, onAuthStateChanged } from "firebase/auth";
// // import { getFirestore, doc, getDoc } from "firebase/firestore";
// // import TeacherDashboard from "./TeacherDashboard";
// // import StudentWhiteboards from "./StudentWhiteboards";

// // const DashboardRouter = () => {
// //   const [loading, setLoading] = useState(true);
// //   const [userRole, setUserRole] = useState("");
// //   const [userEmail, setUserEmail] = useState("");

// //   useEffect(() => {
// //     const auth = getAuth();
// //     const db = getFirestore();

// //     const unsubscribe = onAuthStateChanged(auth, async (user) => {
// //       if (!user) {
// //         setUserEmail("");
// //         setUserRole("");
// //         setLoading(false);
// //         return;
// //       }

// //       setUserEmail(user.email || "");

// //       try {
// //         const userRef = doc(db, "users", user.email);
// //         const userSnap = await getDoc(userRef);

// //         if (userSnap.exists()) {
// //           const role = userSnap.data().role || "";
// //           setUserRole(role);
// //           console.log("User role:", role);
// //         } else {
// //           console.warn("No user document found in Firestore");
// //           setUserRole("");
// //         }
// //       } catch (error) {
// //         console.error("Error fetching user role:", error);
// //         setUserRole("");
// //       } finally {
// //         setLoading(false);
// //       }
// //     });

// //     return () => unsubscribe();
// //   }, []);

// //   if (loading) {
// //     return (
// //       <div className="container py-5">
// //         <p>Loading...</p>
// //       </div>
// //     );
// //   }

// //   if (!userEmail) {
// //     return (
// //       <div className="container py-5">
// //         <div className="alert alert-warning">
// //           No user logged in. Please sign in to continue.
// //         </div>
// //       </div>
// //     );
// //   }

// //   if (userRole === "teacher" || userRole === "admin") {
// //     return <TeacherDashboard userEmail={userEmail} userRole={userRole} />;
// //   }

// //   return <StudentWhiteboards userEmail={userEmail} />;
// // };

// // export default DashboardRouter;

// import React, { useEffect, useState } from "react";
// import { getAuth, onAuthStateChanged } from "firebase/auth";
// import { getFirestore, doc, getDoc } from "firebase/firestore";
// import TeacherDashboard from "./TeacherDashboard";
// import StudentWhiteboards from "./StudentWhiteboards";

// const DashboardRouter = () => {
//   const [loading, setLoading] = useState(true);
//   const [userRole, setUserRole] = useState("");
//   const [userEmail, setUserEmail] = useState("");

//   useEffect(() => {
//     const auth = getAuth();
//     const db = getFirestore();

//     const unsubscribe = onAuthStateChanged(auth, async (user) => {
//       if (!user) {
//         setUserEmail("");
//         setUserRole("");
//         setLoading(false);
//         return;
//       }

//       try {
//         if (user.email) {
//           const email = user.email.toLowerCase();
//           setUserEmail(email);

//           const userRef = doc(db, "users", email);
//           const userSnap = await getDoc(userRef);

//           if (userSnap.exists()) {
//             const role = userSnap.data().role || "";
//             setUserRole(role);
//           } else {
//             setUserRole("");
//           }
//         } else {
//           // anonymous participant flow
//           const sessionSnap = await getDoc(
//             doc(db, "participantSessions", user.uid)
//           );

//           if (sessionSnap.exists()) {
//             const sessionData = sessionSnap.data();
//             setUserEmail(sessionData.email || "");
//             setUserRole(sessionData.role || "participant");
//           } else {
//             // fallback to localStorage if needed
//             setUserEmail(localStorage.getItem("userEmail") || "");
//             setUserRole(localStorage.getItem("role") || "");
//           }
//         }
//       } catch (error) {
//         console.error("Error fetching user role:", error);
//         setUserRole("");
//         setUserEmail("");
//       } finally {
//         setLoading(false);
//       }
//     });

//     return () => unsubscribe();
//   }, []);

//   if (loading) {
//     return (
//       <div className="container py-5">
//         <p>Loading...</p>
//       </div>
//     );
//   }

//   if (!userRole) {
//     return (
//       <div className="container py-5">
//         <div className="alert alert-warning">
//           No user logged in. Please sign in to continue.
//         </div>
//       </div>
//     );
//   }

//   if (userRole === "teacher" || userRole === "admin") {
//     return <TeacherDashboard userEmail={userEmail} userRole={userRole} />;
//   }

//   return <StudentWhiteboards userEmail={userEmail} />;
// };

// export default DashboardRouter;
