import React from "react";

const ToggleExpandButton = ({ isPanelCollapsed, togglePanel }) => {
  console.log(
    `[ToggleExpandButton] Rendered — isPanelCollapsed = ${isPanelCollapsed}`
  );

  const handleClick = () => {
    console.log("[ToggleExpandButton] Toggle button clicked");
    console.log(
      `[ToggleExpandButton] Before toggle → isPanelCollapsed = ${isPanelCollapsed}`
    );
    togglePanel(); // parent should update state
  };

  return (
    <div className="toggle-expand-container">
      <button
        onClick={handleClick}
        className={`toggle-expand-button ${
          isPanelCollapsed ? "collapsed" : ""
        }`}
      ></button>

      <div className="panel-label">History/Comment Panel</div>
    </div>
  );
};

export default ToggleExpandButton;
