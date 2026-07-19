import React, { useEffect } from "react";
import "../App.css";

export default function ToggleButtonGroup({
  isViewingHistory,
  setIsViewingHistory,
  // Action History has nothing meaningful to show on a private canvas
  // (see HistoryPanel) — hide the tab there rather than let someone land
  // on an explanatory empty state by clicking into it.
  isPublicCanvas = true,
}) {
  // If the canvas switches to private while the history tab is open,
  // fall back to Comments so the UI doesn't end up pointed at a tab that
  // no longer has a button to get back out of.
  useEffect(() => {
    if (!isPublicCanvas && isViewingHistory) {
      setIsViewingHistory(false);
    }
  }, [isPublicCanvas, isViewingHistory, setIsViewingHistory]);

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
