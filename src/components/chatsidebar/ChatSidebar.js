// import React from "react";
// import "./ChatSidebar.css";

// const ChatSidebar = ({ messages, isOpen, toggleSidebar }) => {
//   const toLines = (val) => {
//     if (val === null || val === undefined) return [];
//     if (typeof val === "string") return val.split("\n");
//     if (typeof val === "number" || typeof val === "boolean")
//       return String(val).split("\n");
//     // objects / arrays → pretty JSON
//     try {
//       return JSON.stringify(val, null, 2).split("\n");
//     } catch {
//       return [String(val)];
//     }
//   };

//   return (
//     <div className={`chat-sidebar ${isOpen ? "open" : ""}`}>
//       <div className="chat-sidebar-header">
//         <h3>Chat History</h3>
//         <button className="close-btn" onClick={toggleSidebar}>
//           &times;
//         </button>
//       </div>
//       <div className="chat-sidebar-messages">
//         {messages.map((msg, idx) => (
//           <div key={idx} className={`chat-sidebar-message ${msg.sender}`}>
//             {/* {msg.text.split("\n").map((line, i) => (
//               <p key={i} style={{ margin: 0 }}>
//                 {line}
//               </p>
//             ))} */}
//             {toLines(msg.text).map((line, i) => (
//               <p key={i} style={{ margin: 0 }}>
//                 {line}
//               </p>
//             ))}

//             {msg.image_urls && (
//               <div className="chat-sidebar-images">
//                 {msg.image_urls.map((url, i) => (
//                   <img
//                     key={i}
//                     src={url}
//                     alt={`img-${i}`}
//                     className="chat-sidebar-image"
//                   />
//                 ))}
//               </div>
//             )}
//           </div>
//         ))}
//       </div>
//     </div>
//   );
// };

// export default ChatSidebar;

import React from "react";
import "./ChatSidebar.css";
import ChatBot from "../ChatBot";

const ChatSidebar = ({ isOpen, onClose, ...chatbotProps }) => {
  if (!isOpen) return null;

  return (
    <div className={`chat-sidebar ${isOpen ? "open" : ""}`}>
      {/* <div className="chat-sidebar-header">
        <h3>Chat History</h3>
        <button className="close-btn" onClick={onClose}>
          &times;
        </button>
      </div> */}

      <div className="chat-sidebar-body">
        <ChatBot {...chatbotProps} variant="sidebar" toggleSidebar={onClose} />
      </div>
    </div>
  );
};

export default ChatSidebar;
