import React, { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import "bootstrap/dist/css/bootstrap.min.css";
import "./StudentWhiteboards.css";

const StudentWhiteboards = () => {
  const navigate = useNavigate();

  const whiteboards = useMemo(() => {
    try {
      return JSON.parse(localStorage.getItem("assignedWhiteboards")) || [];
    } catch {
      return [];
    }
  }, []);

  const handleOpenWhiteboard = (board) => {
    navigate(
      `/whiteboard/${encodeURIComponent(board.className)}/${encodeURIComponent(
        board.projectName
      )}/${encodeURIComponent(board.teamName)}`
    );
  };

  return (
    <div className="container py-5 student-whiteboards-page">
      <div className="mb-4">
        <h2 className="fw-bold">My Whiteboards</h2>
        <p className="text-muted mb-0">
          Select a whiteboard you are assigned to.
        </p>
      </div>

      {whiteboards.length === 0 ? (
        <div className="alert alert-warning">
          No whiteboards found for your account.
        </div>
      ) : (
        <div className="row g-4">
          {whiteboards.map((board) => (
            <div
              className="col-md-6 col-lg-4"
              key={`${board.className}-${board.projectName}-${board.teamName}`}
            >
              <div className="card h-100 shadow-sm border-0 rounded-4">
                <div className="card-body d-flex flex-column">
                  <h5 className="card-title fw-bold">
                    Project: {board.projectName}
                  </h5>

                  <p className="text-primary fw-semibold mb-2">
                    Class:{" "}
                    {board.courseID ||
                      board.className ||
                      board.classDisplayName}
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
        </div>
      )}
    </div>
  );
};

export default StudentWhiteboards;

// import React, { useMemo } from "react";
// import { useNavigate } from "react-router-dom";
// import "bootstrap/dist/css/bootstrap.min.css";
// import Navbar from "../navbar/Navbar";

// const StudentWhiteboards = () => {
//   const navigate = useNavigate();

//   const whiteboards = useMemo(() => {
//     try {
//       return JSON.parse(localStorage.getItem("assignedWhiteboards")) || [];
//     } catch {
//       return [];
//     }
//   }, []);

//   const handleOpenWhiteboard = (board) => {
//     navigate(
//       `/whiteboard/${encodeURIComponent(board.className)}/${encodeURIComponent(
//         board.projectName
//       )}/${encodeURIComponent(board.teamName)}`
//     );
//   };

//   return (
//     <div className="container py-5">
//       <div className="mb-4">
//         <h2 className="fw-bold">My Whiteboards</h2>
//         <p className="text-muted mb-0">
//           Select a whiteboard you are assigned to.
//         </p>
//       </div>

//       {whiteboards.length === 0 ? (
//         <div className="alert alert-warning">
//           No whiteboards found for your account.
//         </div>
//       ) : (
//         <div className="row g-4">
//           {whiteboards.map((board) => (
//             // <div className="col-md-6 col-lg-4" key={board.classId}>
//             <div
//               className="col-md-6 col-lg-4"
//               key={`${board.className}-${board.projectName}-${board.teamName}`}
//             >
//               <div className="card h-100 shadow-sm border-0 rounded-4">
//                 <div className="card-body d-flex flex-column">
//                   <h5 className="card-title fw-bold">
//                     {/* {board.courseID ||
//                       board.className ||
//                       board.classDisplayName}
//                        */}
//                     Project: {board.projectName}
//                   </h5>

//                   <p className="text-primary fw-semibold mb-2">
//                     {/* Project: {board.projectName} */}
//                     Class:{" "}
//                     {board.courseID ||
//                       board.className ||
//                       board.classDisplayName}
//                   </p>

//                   {/* <p className="card-text mb-1">
//                     <strong>Semester:</strong> {board.semester}
//                   </p> */}

//                   <p className="card-text text-muted small mb-4">
//                     Teacher: {board.teacherEmail}
//                   </p>

//                   <button
//                     className="btn btn-primary mt-auto"
//                     onClick={() => handleOpenWhiteboard(board)}
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

// export default StudentWhiteboards;
