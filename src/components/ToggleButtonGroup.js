import React from "react";
import "../App.css";

export default function ToggleButtonGroup({
  isViewingHistory,
  setIsViewingHistory,
  // Action History is public-canvas-only again — the private canvas tab
  // is hidden entirely, leaving just Comments there.
  isPublicCanvas = true,
}) {
  return (
    <div className="toggleButtonContainer">
      {isPublicCanvas && (
        <button
          onClick={() => setIsViewingHistory(true)}
          className={isViewingHistory ? "active-button" : "toggle-button"}
        >
          Action History
        </button>
      )}
      <button
        onClick={() => setIsViewingHistory(false)}
        className={!isViewingHistory ? "active-button" : "toggle-button"}
      >
        Comments
      </button>
    </div>
  );
}
