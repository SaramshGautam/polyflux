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
