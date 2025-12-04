// import React from "react";
// import "../App.css";
// import { getIndefiniteArticle } from "../utils/GetIndefiniteArticle";

// export default function HistoryPanel({ actionHistory = [] }) {
//   return (
//     <div className="historyPanel">
//       <h4 className="historyTitle">Action History</h4>

//       {actionHistory.length === 0 ? (
//         <p className="historyEmpty">No actions recorded yet.</p>
//       ) : (
//         <ul className="historyList">
//           {actionHistory.map((action, index) => {
//             // console.log(`--- action timestamp --- ${action.timestamp}`);
//             // Convert timestamp to readable format
//             // const formattedTimestamp = action.timestamp?.seconds
//             //   ? new Date(action.timestamp.seconds * 1000).toLocaleString()
//             //   : "";

//             let formattedTimestamp = "Unknown Time";
//             if (action.timestamp) {
//               if (typeof action.timestamp === "string") {
//                 formattedTimestamp = new Date(
//                   action.timestamp
//                 ).toLocaleString();
//               } else if (action.timestamp.seconds) {
//                 formattedTimestamp = new Date(
//                   action.timestamp.seconds * 1000
//                 ).toLocaleString();
//               }
//             }

//             // console.log(`--- Formatted Timestamp --- ${formattedTimestamp}`);

//             return (
//               <li key={index} className="historyItem">
//                 <strong>{action.userId || "Unknown User"}</strong>{" "}
//                 {action.action} {getIndefiniteArticle(action.shapeType)}{" "}
//                 {action.shapeType}
//                 {/* {action.shapeId} */}
//                 <div className="timestamp">{formattedTimestamp}</div>
//               </li>
//             );
//           })}
//         </ul>
//       )}
//     </div>
//   );
// }

// HistoryPanel.jsx
import React from "react";
import "../App.css";
import { getIndefiniteArticle } from "../utils/GetIndefiniteArticle";

export default function HistoryPanel({
  actionHistory = [],
  onHistoryItemClick,
}) {
  // Debug: log when actionHistory changes
  React.useEffect(() => {
    console.log("=== ActionHistory updated ===");
    actionHistory.forEach((e, i) => {
      console.log(`Entry #${i}`, e);
    });
  }, [actionHistory]);

  return (
    <div className="historyPanel">
      <h4 className="historyTitle">Action History</h4>

      {actionHistory.length === 0 ? (
        <p className="historyEmpty">No actions recorded yet.</p>
      ) : (
        // <ul className="historyList">
        //   {actionHistory.map((entry, index) => {
        //     const timeString = entry.timestamp
        //       ? new Date(entry.timestamp).toLocaleString()
        //       : "Unknown Time";

        //     const who = entry.userId || "Unknown User";
        //     const action = entry.action || "unknown action";
        //     const article = getIndefiniteArticle(entry.shapeType || "shape");
        //     const line = `${who} ${action} ${article} ${
        //       entry.shapeType || "shape"
        //     }`;

        //     return (
        //       <li key={index} className="historyItem">
        //         <strong>{line}</strong>
        //         <div className="timestamp">{timeString}</div>

        //         {/* Text preview for notes/text */}
        //         {entry.text && (
        //           <div className="historyTextPreview" title={entry.text}>
        //             “
        //             {entry.text.length > 160
        //               ? entry.text.slice(0, 160) + "…"
        //               : entry.text}
        //             ”
        //           </div>
        //         )}

        //         {/* Image thumbnail */}
        //         {entry.imageUrl && (
        //           <div className="historyThumbWrap">
        //             <img
        //               src={entry.imageUrl}
        //               alt="Edited image"
        //               className="historyThumb"
        //               loading="lazy"
        //               referrerPolicy="no-referrer"
        //             />
        //           </div>
        //         )}
        //       </li>
        //     );
        //   })}
        // </ul>
        <ul className="historyList">
          {actionHistory.map((entry, index) => {
            const timeString = entry.timestamp
              ? new Date(entry.timestamp).toLocaleString()
              : "Unknown Time";

            const who = entry.userId || "Unknown User";
            const action = entry.action || entry.verb || "did";
            const article = getIndefiniteArticle(entry.shapeType || "shape");
            const line = `${who} ${action} ${article} ${
              entry.shapeType || "shape"
            }`;

            const isClickable = !!(entry.shapeId && onHistoryItemClick);

            return (
              <li
                key={index}
                className={`historyItem ${
                  isClickable ? "historyItem--clickable" : ""
                }`}
                onClick={() => {
                  if (isClickable) {
                    onHistoryItemClick(entry.shapeId);
                  }
                }}
              >
                <strong>{line}</strong>
                <div className="timestamp">{timeString}</div>

                {entry.text && (
                  <div className="historyTextPreview" title={entry.text}>
                    “
                    {entry.text.length > 160
                      ? entry.text.slice(0, 160) + "…"
                      : entry.text}
                    ”
                  </div>
                )}

                {entry.imageUrl && (
                  <div className="historyThumbWrap">
                    <img
                      src={entry.imageUrl}
                      alt="Edited image"
                      className="historyThumb"
                      loading="lazy"
                      referrerPolicy="no-referrer"
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
