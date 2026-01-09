import React, { useCallback, useEffect } from "react";

const ToggleExpandButton = ({ isPanelCollapsed, togglePanel }) => {
  useEffect(() => {
    console.log("[ToggleExpandButton] MOUNT");
    return () => console.log("[ToggleExpandButton] UNMOUNT");
  }, []);

  useEffect(() => {
    console.log(
      "[ToggleExpandButton] isPanelCollapsed changed:",
      isPanelCollapsed
    );
  }, [isPanelCollapsed]);

  const handleClick = useCallback(() => {
    console.log("[ToggleExpandButton] Toggle button clicked");
    togglePanel();
  }, [togglePanel]);

  return (
    <div className="toggle-expand-container">
      <button
        onClick={handleClick}
        className={`toggle-expand-button ${
          isPanelCollapsed ? "collapsed" : ""
        }`}
      />
      <div className="panel-label">History/Comment Panel</div>
    </div>
  );
};

export default React.memo(ToggleExpandButton);
