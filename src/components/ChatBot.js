import React, { useState, useEffect } from "react";
import "./ChatBot.css";
import { formatBotReply } from "../utils/formatBotReply";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRobot,
  faArrowsUpDownLeftRight,
} from "@fortawesome/free-solid-svg-icons";
import Draggable from "react-draggable";
import { Rnd } from "react-rnd";
import {
  faXmarkCircle,
  faPlusCircle,
  faClockRotateLeft,
} from "@fortawesome/free-solid-svg-icons";

const ChatBot = ({
  messages,
  setMessages,
  toggleSidebar,
  externalMessages = [],
}) => {
  const [userInput, setUserInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clipNotes, setClipNotes] = useState([]);
  const [position, setPosition] = useState({
    x: window.innerWidth - 400 - 20,
    y: window.innerHeight - 540 - 20,
  });

  useEffect(() => {
    if (externalMessages && externalMessages.length > 0) {
      setIsOpen(true);
      setMessages((prev) => [...prev, ...externalMessages]);
    }
  }, [externalMessages]);

  useEffect(() => {
    const handleExternalTrigger = (e) => {
      if (e.detail?.snippet) {
        setIsOpen(true);
        const newClip = { id: e.detail.source, snip: e.detail.snippet };
        setClipNotes((prev) => [...prev, newClip]);
        if (e.detail.position) {
          setPosition({
            x: e.detail.position.x,
            y: e.detail.position.y,
          });
        }

        const note = `💡 Suggestion: ${e.detail.snippet}`;
        setMessages((prev) => [...prev, { sender: "bot", text: note }]);
      } else {
        setIsOpen(true);
        if (e.detail?.position) {
          setPosition({
            x: e.detail.position.x,
            y: e.detail.position.y,
          });
        }
      }
    };

    window.addEventListener("trigger-chatbot", handleExternalTrigger);
    return () => {
      window.removeEventListener("trigger-chatbot", handleExternalTrigger);
    };
  }, []);

  const handleSend = async () => {
    if (!userInput.trim()) return;

    const newMessages = [...messages, { sender: "user", text: userInput }];
    setMessages(newMessages);
    setUserInput("");
    setLoading(true);

    try {
      const response = await fetch("http://127.0.0.1:5000/api/chatgpt-helper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: userInput }),
      });

      const data = await response.json();
      if (data.reply) {
        setMessages([
          ...newMessages,
          {
            sender: "bot",
            text: formatBotReply(data.reply),
            image_urls: data.image_urls || null,
          },
        ]);
      } else {
        setMessages([
          ...newMessages,
          { sender: "bot", text: "Something went wrong." },
        ]);
      }
    } catch (error) {
      console.error(error);
      setMessages([
        ...newMessages,
        { sender: "bot", text: "Error connecting to server." },
      ]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      {isOpen && (
        <Rnd
          position={position}
          // bounds="parent"
          className="chatbot-rnd"
          default={{
            x: window.innerWidth - 400 - 20,
            y: window.innerHeight - 540 - 20,
          }}
          size={{ width: 400, height: 500 }}
          onDragStop={(e, d) => setPosition({ x: d.x, y: d.y })}
          dragHandleClassName="chatbot-drag"
          enableResizing={{
            topLeft: true,
            bottomRight: false,
            top: true,
            right: false,
            bottom: false,
            left: false,
            topRight: false,
            bottomLeft: false,
          }}
          // minWidth={300}
          // minHeight={400}
          maxWidth={600}
          maxHeight={800}
        >
          {/* <div className="chatbot-toggle" onClick={() => setIsOpen(!isOpen)}>
          <FontAwesomeIcon icon={faRobot} />
        </div> */}

          <>
            <div className="chatbot-toggle-bar">
              <div
                className="chatbot-toggle"
                onClick={() => setIsOpen(!isOpen)}
                title="Toggle ChatBot"
              >
                <FontAwesomeIcon icon={faRobot} />
              </div>
              <div
                className="chatbot-history-toggle"
                onClick={() => toggleSidebar()}
                title="Toggle Chat History"
              >
                <FontAwesomeIcon icon={faClockRotateLeft} />
              </div>
              <div className="chatbot-drag">
                <FontAwesomeIcon icon={faArrowsUpDownLeftRight} />
              </div>
            </div>
            <div className="chatbot-container">
              <div className="chatbot-messages">
                {messages.map((msg, idx) => (
                  <div key={idx} className={`chatbot-message ${msg.sender}`}>
                    {msg.text.split("\n").map((line, i) => (
                      <p key={i} style={{ margin: 0 }}>
                        {line}
                      </p>
                    ))}

                    {msg.type && (
                      <div className="chatbot-nudge-type">
                        <strong>Type:</strong> {msg.type}
                      </div>
                    )}

                    {msg.chips && msg.chips.length > 0 && (
                      <div className="chatbot-nudge-chips">
                        {msg.chips.map((chip, i) => (
                          <div key={i} className="chatbot-chip">
                            {chip}
                          </div>
                        ))}
                      </div>
                    )}

                    {msg.image_urls && Array.isArray(msg.image_urls) && (
                      <div
                        className="chatbot-image-grid"
                        style={{
                          display: "grid",
                          gridTemplateColumns:
                            "repeat(auto-fit, minmax(120px, 1fr))",
                          gap: "10px",
                          marginTop: "10px",
                        }}
                      >
                        {msg.image_urls.map((url, i) => (
                          <img
                            key={i}
                            src={url}
                            alt={`Generated visual ${i + 1}`}
                            style={{
                              width: "100%",
                              borderRadius: "6px",
                              objectFit: "cover",
                            }}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                ))}
                {loading && (
                  <div className="chatbot-message bot">Thinking...</div>
                )}
              </div>

              <div className="chatbot-clipnote-bar">
                {clipNotes.map((clip, index) => (
                  <div key={index} className="chatbot-clip-box">
                    {/* <span>{clip.snip}</span> */}
                    <>
                      {clip.snip.startsWith("data") ? (
                        <img
                          src={clip.snip}
                          alt="Clip"
                          className="chatbot-clip-img"
                        />
                      ) : (
                        <span className="chatbot-clip-text">{clip.snip}</span>
                      )}

                      <div
                        className="chatbot-clip-delete"
                        onClick={() => {
                          // setClipNotes((prev) => prev.filter((c) => c.id !== clip.id));
                          setClipNotes((prev) =>
                            prev.filter((_, i) => i !== index)
                          );
                        }}
                      >
                        <FontAwesomeIcon icon={faXmarkCircle} />
                        {/* &times; */}
                      </div>
                    </>
                  </div>
                ))}
                <div className="chatbot-clip-box add-box">
                  {/* <span>+</span> */}
                  <FontAwesomeIcon icon={faPlusCircle} />
                </div>
              </div>
              <div className="chatbot-input">
                <input
                  type="text"
                  placeholder="Ask me something..."
                  value={userInput}
                  onChange={(e) => setUserInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSend()}
                />
                <button onClick={handleSend}>Send</button>
              </div>
              {/* <button className="chatbot-sidebar-toggle" onClick={toggleSidebar}>
              {" "}
              History{" "}
            </button> */}
            </div>
          </>
        </Rnd>
      )}
      {/* </Draggable> */}
    </>
  );
};

export default ChatBot;
