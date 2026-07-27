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
  // Which canvas is active — used to show that canvas's own slice of
  // history (public canvas history when true, this user's own private
  // canvas history when false). Defaults true so this keeps working
  // exactly as before for any caller that hasn't been updated to pass it.
  isPublicCanvas = true,
  // Needed to filter private-canvas history down to just this user's own
  // entries — the underlying "actions" collection is shared by the whole
  // team, not scoped per private-canvas owner.
  currentUserUid = null,
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

  useEffect(() => {
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = 0;
        handleScroll();
      }
    });
  }, [isViewingHistory, actionHistory, comments]);

  // Action History is hidden on the private canvas (its tab button
  // disappears too — see ToggleButtonGroup), so force this back to
  // Comments on switching there. Otherwise a user who was on the History
  // tab in public mode would land on a blank/stuck view with no visible
  // way to get back, since the tab that would flip isViewingHistory back
  // no longer renders.
  useEffect(() => {
    if (!isPublicCanvas) setIsViewingHistory(false);
  }, [isPublicCanvas]);

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
        className="panel-content overflow-y-auto flex-1 min-h-0 relative"
        onScroll={handleScroll}
      >
        {isViewingHistory ? (
          <HistoryPanel
            actionHistory={actionHistory}
            onHistoryItemClick={onHistoryItemClick}
            isPublicCanvas={isPublicCanvas}
            currentUserUid={currentUserUid}
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
