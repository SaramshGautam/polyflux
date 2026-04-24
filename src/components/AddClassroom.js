import React, { useState } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { useFlashMessage } from "../FlashMessageContext"; // Import flash message hook

const AddClassroom = () => {
  const navigate = useNavigate();
  const addMessage = useFlashMessage(); // Get the addMessage function from context

  const [className, setClassName] = useState("");
  const [courseId, setCourseId] = useState("");
  const [semester, setSemester] = useState("");
  const [studentFile, setStudentFile] = useState(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [role] = useState(localStorage.getItem("role"));
  const [userEmail] = useState(localStorage.getItem("userEmail"));

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      const fileExtension = file.name
        .slice(file.name.lastIndexOf("."))
        .toLowerCase();
      if (![".csv", ".xls", ".xlsx"].includes(fileExtension)) {
        setError("Invalid file format. Please upload a CSV or Excel file.");
        setStudentFile(null);
      } else {
        setError("");
        setStudentFile(file);
      }
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!className || !courseId || !semester) {
      setError("Please provide all required details.");
      return;
    }

    const formData = new FormData();
    formData.append("class_name", className);
    formData.append("course_id", courseId);
    formData.append("semester", semester);
    if (studentFile) {
      formData.append("student_file", studentFile);
    }
    formData.append("role", role);
    formData.append("userEmail", userEmail);

    try {
      setIsSubmitting(true);
      // const response = await axios.post(
      //   "http://localhost:5000/addclassroom",
      //   formData,
      //   {
      const response = await axios.post(
        "https://flask-app-jqwkqdscaq-uc.a.run.app/addclassroom",
        formData,
        {
          withCredentials: true,
          headers: {
            "Content-Type": "multipart/form-data",
            Accept: "application/json",
            // "Access-Control-Allow-Origin": "https://colla-board.vercel.app",
          },
        }
      );
      setIsSubmitting(false);

      // For success, use the global flash message (for teacher home)
      addMessage("success", response.data.message);
      navigate("/teachers-home");
    } catch (err) {
      setIsSubmitting(false);
      const errorMessage =
        (err.response && err.response.data && err.response.data.error) ||
        "Failed to upload classroom. Please try again.";
      // Show error inline on the form
      setError(errorMessage);
      // Remove or comment out the global flash message call for errors:
      // addMessage("danger", errorMessage);
    }
  };

  return (
    <div
      className="container mt-8 d-flex justify-content-center"
      style={{ marginTop: "5rem" }}
    >
      <div className="form-container">
        <h1 className="form-title">Add New Classroom</h1>

        {/* Inline error alert for the form */}
        {error && <div className="alert alert-danger">{error}</div>}

        <form onSubmit={handleSubmit} encType="multipart/form-data">
          <div className="row">
            <div className="col-md-6 form-group">
              <label htmlFor="class_name" className="form-label">
                Class Name
              </label>
              <input
                type="text"
                id="class_name"
                className="form-control"
                value={className}
                onChange={(e) => setClassName(e.target.value)}
                required
              />
            </div>

            <div className="col-md-6 form-group">
              <label htmlFor="course_id" className="form-label">
                Course ID
              </label>
              <input
                type="text"
                id="course_id"
                className="form-control"
                value={courseId}
                onChange={(e) => setCourseId(e.target.value)}
                required
              />
            </div>
          </div>

          <div className="row">
            <div className="col-md-6 form-group">
              <label htmlFor="semester" className="form-label">
                Semester
              </label>
              <select
                id="semester"
                className="form-control"
                value={semester}
                onChange={(e) => setSemester(e.target.value)}
                required
              >
                <option value="">Select Semester</option>
                <option value="Spring 2025">Spring 2025</option>
                <option value="Summer 2025">Summer 2025</option>
                <option value="Fall 2025">Fall 2025</option>
                <option value="Spring 2026">Spring 2026</option>
                <option value="Summer 2026">Summer 2026</option>
              </select>
            </div>

            <div className="col-md-6 form-group">
              <label htmlFor="student_file" className="form-label">
                Student File (CSV or Excel)
              </label>
              <input
                type="file"
                id="student_file"
                className="form-control"
                accept=".csv, .xls, .xlsx"
                onChange={handleFileChange}
              />
            </div>
          </div>

          <div className="d-flex justify-content-start gap-3 mt-4">
            <button
              type="submit"
              className="btn action-btn"
              disabled={isSubmitting}
            >
              {isSubmitting ? (
                <>
                  <span className="spinner-border spinner-border-sm"></span>{" "}
                  Uploading...
                </>
              ) : (
                <>
                  <i className="bi bi-upload"></i> Upload
                </>
              )}
            </button>
            <button
              type="button"
              className="btn back-btn"
              onClick={() => navigate("/teachers-home")}
            >
              <i className="bi bi-arrow-left"></i> Back to Home
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default AddClassroom;
