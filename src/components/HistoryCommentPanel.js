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
}) => {
  const [isViewingHistory, setIsViewingHistory] = useState(true);
  const [showScrollButton, setShowScrollButton] = useState(true);
  const scrollRef = useRef(null);

  const handleScroll = () => {
    const element = scrollRef.current;
    if (!element) return;

    // console.log("Scroll event triggered!");
    // console.log("scrollTop:", element.scrollTop);
    // console.log("scrollHeight:", element.scrollHeight);
    // console.log("clientHeight:", element.clientHeight);

    // Show button when user has scrolled down more than 50px
    setShowScrollButton(element.scrollTop > 0);
  };

  const scrollToTop = () => {
    const element = scrollRef.current;
    if (!element) return;
    // element.scrollTo({ top: 0, behavior: "smooth" });
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

  // useEffect(() => {
  //   const el = scrollRef.current;
  //   if (el) {
  //     // Reset scroll position to top when switching views
  //     el.scrollTop = 0;
  //     setShowScrollButton(false);
  //     console.log("Panel mounted/updated:");
  //     console.log("scrollHeight:", el.scrollHeight);
  //     console.log("clientHeight:", el.clientHeight);
  //     console.log("Is scrollable:", el.scrollHeight > el.clientHeight);
  //   }
  // }, [isViewingHistory, actionHistory, comments]);

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
    // ensure initial state is correct after data/view changes
    requestAnimationFrame(() => {
      if (scrollRef.current) {
        // newest at top → start at top
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
      />

      {/* Scrollable Content */}
      <div
        ref={scrollRef}
        className="panel-content overflow-y-auto flex-1 min-h-0 p-2 relative"
        onScroll={handleScroll}
        // style={{ minHeight: 0 }}
        // style={{ maxHeight: "100px" }}
      >
        {isViewingHistory ? (
          <HistoryPanel
            actionHistory={actionHistory}
            onHistoryItemClick={onHistoryItemClick}
          />
        ) : (
          <CommentPanel selectedShape={selectedShape} />
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
