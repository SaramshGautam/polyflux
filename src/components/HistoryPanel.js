import React from "react";
import "../App.css";
import { getIndefiniteArticle } from "../utils/GetIndefiniteArticle";

export default function HistoryPanel({ actionHistory = [] }) {
  return (
    <div className="historyPanel">
      <h4 className="historyTitle">Action History</h4>

      {actionHistory.length === 0 ? (
        <p className="historyEmpty">No actions recorded yet.</p>
      ) : (
        <ul className="historyList">
          {actionHistory.map((action, index) => {
            // console.log(`--- action timestamp --- ${action.timestamp}`);
            // Convert timestamp to readable format
            // const formattedTimestamp = action.timestamp?.seconds
            //   ? new Date(action.timestamp.seconds * 1000).toLocaleString()
            //   : "";

            let formattedTimestamp = "Unknown Time";
            if (action.timestamp) {
              if (typeof action.timestamp === "string") {
                formattedTimestamp = new Date(
                  action.timestamp
                ).toLocaleString();
              } else if (action.timestamp.seconds) {
                formattedTimestamp = new Date(
                  action.timestamp.seconds * 1000
                ).toLocaleString();
              }
            }

            console.log(`--- Formatted Timestamp --- ${formattedTimestamp}`);

            return (
              <li key={index} className="historyItem">
                <strong>{action.userId || "Unknown User"}</strong>{" "}
                {action.action} {getIndefiniteArticle(action.shapeType)}{" "}
                {action.shapeType}
                {/* {action.shapeId} */}
                <div className="timestamp">{formattedTimestamp}</div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
