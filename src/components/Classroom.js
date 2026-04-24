import React, { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getFirestore, collection, getDocs } from "firebase/firestore";
import "./Classroom.css";
const Classroom = () => {
  const { className } = useParams();
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [role] = useState(localStorage.getItem("role"));
  const [userEmail] = useState(localStorage.getItem("userEmail"));
  const db = getFirestore();
  const [loading, setLoading] = useState(true);
  const [courseDetails, setCourseDetails] = useState({}); // Store course details (course name, course ID)

  useEffect(() => {
    const fetchClassroomData = async () => {
      try {
        // Fetch course details like course ID and course name
        const courseRef = collection(db, "classrooms");
        const courseSnapshot = await getDocs(courseRef);
        const courseData = courseSnapshot.docs
          .find((doc) => doc.id === className)
          ?.data();

        // Set course details
        if (courseData) {
          setCourseDetails({
            courseId: courseData.courseID,
            courseName: courseData.class_name,
          });
        }

        // Fetch projects for the classroom
        const projectsRef = collection(db, "classrooms", className, "Projects");
        const querySnapshot = await getDocs(projectsRef);
        // const projectsData = querySnapshot.docs.map((doc) => ({

        //   projectName: doc.data().projectName,
        //   description: doc.data().description,
        //   dueDate: doc.data().dueDate,
        // }));

        const projectsData = querySnapshot.docs.map((docSnap) => {
          const data = docSnap.data();

          return {
            projectName: data.projectName || docSnap.id,
            description: data.description || "",
            dueDate: data.dueDate || null,
          };
        });

        setProjects(projectsData);
        setLoading(false);
      } catch (error) {
        console.error("Error fetching classroom data:", error);
      }
    };

    fetchClassroomData();
  }, [className, db]);

  return (
    <div className="classroom-page">
      <h1 className="classroom-title">
        {courseDetails.courseName} ({courseDetails.courseId})
      </h1>

      {role === "teacher" && (
        <div className="button-group">
          <button
            className="btn action-btn"
            onClick={() => navigate(`/classroom/${className}/add-project`)}
          >
            <i className="bi bi-folder-plus me-2"></i> Add Project
          </button>
          <button
            className="btn action-btn"
            onClick={() => navigate(`/classroom/${className}/manage-students`)}
          >
            <i className="bi bi-people me-2"></i> Manage Students
          </button>
          <button
            className="btn action-btn"
            onClick={() => navigate(`/classroom/${className}/edit`)}
          >
            <i className="bi bi-pencil-square me-2"></i> Edit Classroom
          </button>
        </div>
      )}

      <h2 className="section-title">Projects</h2>

      {loading ? (
        <p>Loading projects...</p>
      ) : (
        <div className="projects-grid">
          {projects.length > 0 ? (
            projects.map((project, index) => (
              <div
                key={index}
                className="project-card"
                onClick={() =>
                  navigate(
                    `/classroom/${className}/project/${project.projectName}`
                  )
                }
              >
                <h5>{project.projectName || "Untitled Project"}</h5>

                <p className="project-description">
                  <strong>Description:</strong>{" "}
                  {project.description
                    ? project.description.length > 100
                      ? `${project.description.substring(0, 100)}...`
                      : project.description
                    : "No description provided."}
                </p>

                <p className="project-due-date">
                  <strong>Due Date:</strong>{" "}
                  {project.dueDate
                    ? project.dueDate.toDate
                      ? project.dueDate.toDate().toLocaleDateString()
                      : new Date(project.dueDate).toLocaleDateString()
                    : "No due date"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-muted">No projects available.</p>
          )}
        </div>
      )}

      {/* <button
        className="btn back-btn mt-3"
        onClick={() =>
          navigate(role === "teacher" ? "/teachers-home" : "/students-home")
        }
      >
        <i className="bi bi-arrow-left"></i> Back to Dashboard
      </button> */}

      <button
        className="btn back-btn mt-3"
        onClick={() => navigate("/dashboard")}
      >
        <i className="bi bi-arrow-left"></i> Back to Dashboard
      </button>
    </div>
  );
};

export default Classroom;
