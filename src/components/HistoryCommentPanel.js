import React, { useState, useEffect, useRef } from "react";
import ToggleButtonGroup from "./ToggleButtonGroup";
import HistoryPanel from "./HistoryPanel";
import CommentPanel from "./CommentPanel";

const HistoryCommentPanel = ({
  actionHistory,
  comments,
  selectedShape,
  isPanelCollapsed,
  togglePanel,
  onHistoryItemClick,
  // Firestore shape docs (each may carry its own `comments` array) — used
  // to build the all-comments list, and the click handler that pans to
  // whichever shape a given comment belongs to and opens its comment box.
  shapes,
  onCommentItemClick,
  // Action History only tracks the shared canvas — private-canvas edits
  // are personal to that user and have nothing to show. Defaults true so
  // this keeps working exactly as before for any caller that hasn't been
  // updated to pass it yet.
  isPublicCanvas = true,
}) => {
  const [isViewingHistory, setIsViewingHistory] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(true);
  const scrollRef = useRef(null);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;

    // Show button when user has scrolled down more than 50px
    setShowScrollButton(element.scrollTop > 0);
  };

  const scrollToTop = () => {
    const element = scrollRef.current;
    if (!element) return;
    try {
      if (typeof element.scrollTo === "function") {
        element.scrollTo({ top: 0, behavior: "smooth" });
      } else {
        element.scrollTop = 0;
      }
    } catch {
      element.scrollTop = 0;
    }
  };

  const handleViewChange = (newValue) => {
    setIsViewingHistory(newValue);
    // Reset scroll when switching views
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        setShowScrollButton(false);
      }
    });
  };

  // If the canvas switches to private while History is open, land on
  // Comments instead — History has nothing to show there, and
  // ToggleButtonGroup itself will hide the button that would let someone
  // switch back to it, so this is what keeps that transition from
  // stranding the view on a tab with no way back.
  useEffect(() => {
    if (!isPublicCanvas && isViewingHistory) {
      handleViewChange(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isPublicCanvas]);

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        handleScroll();
      }
    });
  }, [isViewingHistory, actionHistory, comments]);

  return (
    <div className="panelContainer relative h-full flex flex-col">
      {/* Toggle Collapse Button */}
      <button
        onClick={togglePanel}
        className={`toggle-collapse-button ${
          isPanelCollapsed ? "collapsed" : ""
        }`}
      ></button>

      {/* Toggle between History and Comment view */}
      <ToggleButtonGroup
        isViewingHistory={isViewingHistory}
        setIsViewingHistory={handleViewChange}
        isPublicCanvas={isPublicCanvas}
      />

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        className="panel-content overflow-y-auto flex-1 min-h-0 p-2 relative"
        onScroll={handleScroll}
      >
        {isViewingHistory ? (
          <HistoryPanel
            actionHistory={actionHistory}
            onHistoryItemClick={onHistoryItemClick}
            isPublicCanvas={isPublicCanvas}
          />
        ) : (
          <CommentPanel
            shapes={shapes}
            onCommentItemClick={onCommentItemClick}
          />
        )}
      </div>

      {/* Scroll-to-top button (appears only when scrolled down) */}
      {showScrollButton && (
        <button
          onClick={scrollToTop}
          className="scroll-top-btn absolute bottom-4 right-4 bg-gray-800 text-white px-3 py-2 rounded-full shadow-md hover:bg-gray-700 transition z-10"
          aria-label="Scroll to top"
        >
          ↑ Top
        </button>
      )}
    </div>
  );
};

export default HistoryCommentPanel;
