import React, { useState, useEffect } from "react";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";
import { useNavigate } from "react-router-dom";
import { getAuth, onAuthStateChanged } from "firebase/auth";
import "./StudentHome.css";

const StudentHome = () => {
  const [classrooms, setClassrooms] = useState({
    groupedClassrooms: {},
    sortedSemesters: [],
  });
  const [loading, setLoading] = useState(true);
  const [userEmail, setUserEmail] = useState(null);
  const navigate = useNavigate();
  const auth = getAuth();

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      if (user) {
        setUserEmail(user.email);
      } else {
        setUserEmail(null);
        setClassrooms({ groupedClassrooms: {}, sortedSemesters: [] });
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth]);

  // Updated sorting logic:
  // - Valid semesters (e.g., "Fall 2025") are sorted by year (descending) first.
  // - For the same year, order is: Fall (1), Summer (2), Spring (3).
  // - Any missing/invalid semester (e.g., undefined) is pushed to the end.
  const sortSemesters = (semesters) => {
    const semesterOrder = {
      Fall: 1,
      Summer: 2,
      Spring: 3,
    };

    return semesters.sort((a, b) => {
      // If a or b is missing or "undefined", push it to the end.
      if (!a || a === "undefined") return 1;
      if (!b || b === "undefined") return -1;

      const partsA = a.split(" ");
      const partsB = b.split(" ");

      // If either semester string does not have two parts, treat it as invalid.
      if (partsA.length < 2) return 1;
      if (partsB.length < 2) return -1;

      const [seasonA, yearA] = partsA;
      const [seasonB, yearB] = partsB;
      const numYearA = parseInt(yearA, 10);
      const numYearB = parseInt(yearB, 10);

      // If year parsing fails, push the invalid one to the end.
      if (isNaN(numYearA)) return 1;
      if (isNaN(numYearB)) return -1;

      // First, sort by year (descending)
      if (numYearA !== numYearB) {
        return numYearB - numYearA;
      }

      // For the same year, sort by semester order
      return semesterOrder[seasonA] - semesterOrder[seasonB];
    });
  };

  // Fetch classrooms when userEmail changes
  useEffect(() => {
    const fetchClassrooms = async () => {
      if (!userEmail) return;

      try {
        setLoading(true);
        const db = getFirestore();
        const classroomsRef = collection(db, "classrooms");
        const querySnapshot = await getDocs(classroomsRef);

        const studentClassrooms = [];
        for (const docSnapshot of querySnapshot.docs) {
          const classroom = docSnapshot.data();
          const studentsRef = collection(
            db,
            `classrooms/${docSnapshot.id}/students`
          );
          const studentsSnapshot = await getDocs(studentsRef);

          // Check if the student exists in the classroom's students subcollection
          const isStudentInClassroom = studentsSnapshot.docs.some(
            (studentDoc) => studentDoc.data().email === userEmail
          );

          if (isStudentInClassroom) {
            // Fetch teacher's name using the teacher's email
            const teacherDoc = await getDoc(
              doc(db, "users", classroom.teacherEmail)
            );
            const teacherName = teacherDoc.exists()
              ? teacherDoc.data().name
              : "Unknown";

            studentClassrooms.push({
              id: docSnapshot.id,
              teacherName, // Add teacher's name here
              ...classroom,
            });
          }
        }

        // Group classrooms by semester
        const groupedClassrooms = studentClassrooms.reduce((acc, classroom) => {
          const { semester } = classroom;
          // Use the provided semester value; if missing, it will be undefined (or "undefined")
          if (!acc[semester]) {
            acc[semester] = [];
          }
          acc[semester].push(classroom);
          return acc;
        }, {});

        // Sort semesters in reverse order (latest semester first), with invalid ones at the end
        const sortedSemesters = sortSemesters(Object.keys(groupedClassrooms));

        setClassrooms({ groupedClassrooms, sortedSemesters });
      } catch (error) {
        console.error("Error fetching classrooms:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchClassrooms();
  }, [userEmail]);

  return (
    <div className="container student-dashboard-container mt-4">
      {loading ? (
        <p>Loading...</p>
      ) : userEmail ? (
        <>
          {/* Centered Title */}
          <div className="text-center">
            <h1 className="dashboard-title mb-4">
              <i className="bi bi-person-badge"></i> Student's Dashboard
            </h1>
          </div>

          {/* Classrooms organized by semester */}
          <div className="assigned-classrooms">
            {classrooms.sortedSemesters.length > 0 ? (
              classrooms.sortedSemesters.map((semester) => (
                <div key={semester} className="semester-section">
                  <h4>{semester}</h4>
                  <div className="row">
                    {classrooms.groupedClassrooms[semester].map((classroom) => (
                      <div key={classroom.id} className="col-md-4 mb-4">
                        <div
                          className="classroom-card"
                          onClick={() => navigate(`/classroom/${classroom.id}`)}
                        >
                          <div className="card-body">
                            <h5 className="card-title">
                              {classroom.courseID} - {classroom.class_name}
                            </h5>
                            <p className="card-text">
                              Instructor: {classroom.teacherName}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            ) : (
              <p className="text-muted">No classrooms assigned.</p>
            )}
          </div>
        </>
      ) : (
        <p>No user logged in. Please sign in to continue.</p>
      )}
    </div>
  );
};

export default StudentHome;
