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

      setUserEmail(user.email || "");

      try {
        const userRef = doc(db, "users", user.email);
        const userSnap = await getDoc(userRef);

        if (userSnap.exists()) {
          const role = userSnap.data().role || "";
          setUserRole(role);
          console.log("User role:", role);
        } else {
          console.warn("No user document found in Firestore");
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

  if (userRole === "teacher" || userRole === "admin") {
    return <TeacherDashboard userEmail={userEmail} userRole={userRole} />;
  }

  return <StudentWhiteboards userEmail={userEmail} />;
};

export default DashboardRouter;
