import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import {
  getFirestore,
  collection,
  getDocs,
  getDoc,
  doc,
} from "firebase/firestore";

const TeacherDashboard = ({ userEmail, userRole }) => {
  const navigate = useNavigate();

  const [classrooms, setClassrooms] = useState([]);
  const [teacherNames, setTeacherNames] = useState({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchClassrooms = async () => {
      if (!userEmail) return;

      try {
        setLoading(true);
        const db = getFirestore();
        const classroomsRef = collection(db, "classrooms");
        const querySnapshot = await getDocs(classroomsRef);

        const teacherClassrooms = querySnapshot.docs
          .filter((docSnap) => docSnap.data().teacherEmail === userEmail)
          .map((docSnap) => ({
            id: docSnap.id,
            ...docSnap.data(),
          }));

        setClassrooms(teacherClassrooms);

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
              if (teacherDoc.exists()) {
                teacherNamesObj[email] =
                  teacherDoc.data().name || teacherDoc.data().email || email;
              } else {
                teacherNamesObj[email] = email;
              }
            } catch (error) {
              console.error(`Error fetching teacher ${email}:`, error);
              teacherNamesObj[email] = email;
            }
          })
        );

        setTeacherNames(teacherNamesObj);
      } catch (error) {
        console.error("Error fetching classrooms:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchClassrooms();
  }, [userEmail]);

  const handleOpenClassroom = (classroom) => {
    navigate(`/classroom/${encodeURIComponent(classroom.classID)}`);
  };

  if (loading) {
    return (
      <div className="container py-5">
        <p>Loading...</p>
      </div>
    );
  }

  return (
    <div className="container py-5">
      <div className="mb-4 text-center">
        <h2 className="fw-bold">Teacher Dashboard</h2>
        <p className="text-muted mb-0">
          Manage your classrooms and open class workspaces.
        </p>
      </div>

      <div className="d-flex justify-content-center mb-4 gap-2">
        <button
          className="btn btn-success rounded-pill px-4"
          onClick={() => navigate("/add-classroom")}
        >
          + Add Classroom
        </button>

        {userRole === "admin" && (
          <button
            className="btn btn-dark rounded-pill px-4"
            onClick={() => navigate("/add-user")}
          >
            + Add User
          </button>
        )}
      </div>

      {classrooms.length === 0 ? (
        <div className="row g-4">
          <div className="col-md-6 col-lg-4">
            <div
              className="card h-100 shadow-sm border-0 rounded-4 d-flex align-items-center justify-content-center"
              style={{ cursor: "pointer", minHeight: "220px" }}
              onClick={() => navigate("/add-classroom")}
            >
              <div className="text-center">
                <h4 className="fw-normal mb-0">⊕ Add Classroom</h4>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="row g-4">
          {classrooms.map((classroom) => (
            <div className="col-md-6 col-lg-4" key={classroom.id}>
              <div
                className="card h-100 shadow-sm border-0 rounded-4"
                style={{ cursor: "pointer" }}
                onClick={() => handleOpenClassroom(classroom)}
              >
                <div className="card-body d-flex flex-column">
                  <h5 className="card-title fw-bold">
                    {classroom.courseID} -{" "}
                    {classroom.class_name || classroom.className}
                  </h5>

                  <p className="card-text mb-1">
                    <strong>Semester:</strong> {classroom.semester || "N/A"}
                  </p>

                  <p className="card-text text-muted small mb-4">
                    Instructor:{" "}
                    {teacherNames[classroom.teacherEmail] ||
                      classroom.teacherEmail ||
                      "Unknown"}
                  </p>

                  <button
                    className="btn btn-primary mt-auto"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleOpenClassroom(classroom);
                    }}
                  >
                    Open Classroom
                  </button>
                </div>
              </div>
            </div>
          ))}

          <div className="col-md-6 col-lg-4">
            <div
              className="card h-100 shadow-sm border-0 rounded-4 d-flex align-items-center justify-content-center"
              style={{ cursor: "pointer", minHeight: "220px" }}
              onClick={() => navigate("/add-classroom")}
            >
              <div className="text-center">
                <h4 className="fw-normal mb-0">⊕ Add Classroom</h4>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default TeacherDashboard;
