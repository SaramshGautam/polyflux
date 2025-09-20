import React, { useState, useEffect } from "react";
import "./ChatBot.css";
import { formatBotReply } from "../utils/formatBotReply";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faRobot,
  faArrowsUpDownLeftRight,
  faCopy,
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
  canvasId,
  role,
  user_id,
  targets,
  params,
}) => {
  const [userInput, setUserInput] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [clipNotes, setClipNotes] = useState([]);
  const [position, setPosition] = useState({
    x: window.innerWidth - 400 - 20,
    y: window.innerHeight - 540 - 20,
  });
  const [copiedKey, setCopiedKey] = useState(null);

  useEffect(() => {
    if (externalMessages && externalMessages.length > 0) {
      setIsOpen(true);
      setMessages((prev) => [...prev, ...externalMessages]);
    }
  }, [externalMessages]);

  // useEffect(() => {
  //   const handleExternalTrigger = (e) => {
  //     if (e.detail?.snippet) {
  //       setIsOpen(true);
  //       const newClip = { id: e.detail.source, snip: e.detail.snippet };
  //       setClipNotes((prev) => [...prev, newClip]);
  //       if (e.detail.position) {
  //         setPosition({
  //           x: e.detail.position.x,
  //           y: e.detail.position.y,
  //         });
  //       }

  //       const note = `💡 Suggestion: ${e.detail.snippet}`;
  //       setMessages((prev) => [...prev, { sender: "bot", text: note }]);
  //     } else {
  //       setIsOpen(true);
  //       if (e.detail?.position) {
  //         setPosition({
  //           x: e.detail.position.x,
  //           y: e.detail.position.y,
  //         });
  //       }
  //     }
  //   };

  //   window.addEventListener("trigger-chatbot", handleExternalTrigger);
  //   return () => {
  //     window.removeEventListener("trigger-chatbot", handleExternalTrigger);
  //   };
  // }, []);

  useEffect(() => {
    const handleExternalTrigger = (e) => {
      setIsOpen(true);

      // Reposition, if provided
      if (e.detail?.position) {
        setPosition({
          x: e.detail.position.x,
          y: e.detail.position.y,
        });
      }

      // Build clips:
      // - Prefer meta.selection (multi-select) → one clip per selected item
      // - Else fallback to snippet / image_urls like before
      const detail = e.detail || {};
      const nextClips = [];

      if (
        Array.isArray(detail?.meta?.selection) &&
        detail.meta.selection.length
      ) {
        for (const item of detail.meta.selection) {
          const snip = item.url || item.text || "";
          if (!snip) continue;
          nextClips.push({ id: item.id || Math.random().toString(36), snip });
        }
      } else if (Array.isArray(detail.image_urls) && detail.image_urls.length) {
        for (const url of detail.image_urls) {
          nextClips.push({
            id: `${detail.source || "sel"}:${url.slice(0, 24)}`,
            snip: url,
          });
        }
      } else if (detail.snippet) {
        nextClips.push({
          id: detail.source || Math.random().toString(36),
          snip: detail.snippet,
        });
      }

      if (nextClips.length) {
        setClipNotes((prev) =>
          // de-duplicate by (id,snip) pair
          dedupeBy([...prev, ...nextClips], (c) => `${c.id}|${c.snip}`)
        );
      }

      // IMPORTANT: do NOT push a "Suggestion:" message anymore.
    };

    window.addEventListener("trigger-chatbot", handleExternalTrigger);
    return () => {
      window.removeEventListener("trigger-chatbot", handleExternalTrigger);
    };
  }, []);

  const handleChipClick = async (chip, roleType) => {
    // setUserInput(chip);
    // console.log("Chip clicked:", chip);
    console.log("Sending /act payload:", {
      chip,
      canvas_id: canvasId,
      role: roleType || "catalyst",
      user_id,
      targets: targets,
      params,
    });
    // setLoading(true);

    const newMessages = [
      ...messages,
      { sender: "user", text: chip },
      { sender: "bot", text: `🔧 Running action: ${chip}` },
    ];
    setMessages(newMessages);

    try {
      // const response = await fetch("http://localhost:8080/act", {
      const response = await fetch(
        "https://rv4u3xtdyi.execute-api.us-east-2.amazonaws.com/Prod/act",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            chip: chip,
            canvas_id: canvasId,
            role: roleType || "catalyst",
            user_id: user_id,
            targets: targets || [],
            params: params || {},
          }),
        }
      );

      const data = await response.json();
      // const botReply = data.message || "Action completed.";
      // const botReply = data.result || "Action completed.";
      console.log(`---data---`, data);
      if (data.error) {
        setMessages([
          ...newMessages,
          { sender: "bot", text: `⚠️ Action error: ${data.error}` },
        ]);
        return;
      }
      const result = data.result ?? data;
      // const botReply = result.outputs.content;
      // setMessages([...newMessages, { sender: "bot", text: botReply }]);
      console.log("Action response:", result);
      // console.log("Action response:", botReply);

      // const reply = summarizeActResult(result, {
      //   chip: result.chip,
      //   role: result.role,
      // });
      console.log(`Bot Reply (raw):`, result?.output?.[0]?.content);

      const botReply = formatBotReply(
        // result?.outputs?.[0]?.content ?? "Action completed."
        result?.outputs?.find((o) => o?.type === "summary")?.content ??
          result?.output?.[0]?.content ??
          "Action completed."
      );
      // const images = extractImageUrls(result);
      console.log("Action reply:", botReply);

      setMessages([
        ...newMessages,
        {
          sender: "bot",
          text: botReply,
          type: roleType,
          // chips: result.chip || [],
          // image_urls: extractImageUrls(result),
        },
      ]);
    } catch (error) {
      console.error(error);
      const botReply = "Error executing action.";
      console.log("Action error:", botReply);
    } finally {
      setLoading(false);
    }
  };

  const handleSend = async () => {
    if (!userInput.trim()) return;

    const context = gatherContextFromClips(clipNotes);
    const newMessages = [
      ...messages,
      {
        sender: "user",
        text: userInput,
        image_urls: context.images,
        attached_texts: context.texts,
      },
    ];
    console.log("New Messages:", newMessages);
    setMessages(newMessages);
    setUserInput("");
    setClipNotes([]);
    setLoading(true);

    try {
      // const response = await fetch("http://127.0.0.1:8090/api/chatgpt-helper", {
      const response = await fetch(
        "https://flask-app-jqwkqdscaq-uc.a.run.app/api/chatgpt-helper",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userInput,
            canvas_id: canvasId,
            role,
            user_id,
            targets: targets || [],
            params: params || {},
            context: {
              images: context.images,
              texts: context.texts,
            },
          }),
        }
      );

      const data = await response.json();
      if (data.reply) {
        // const reply = summarizeActResult(data.result, { chip: chipText, role: roleType });
        setMessages([
          ...newMessages,
          {
            sender: "bot",
            text: formatBotReply(data.reply),
            image_urls: data.image_urls || null,
            // image_urls: (data.result.created_shapes || [])
            // .filter((s) => s.type === "image" && s.imageUrl)
            // .map((s) => s.imageUrl),
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

  // put near top of component
  const toLines = (val) => {
    if (val === null || val === undefined) return [];
    if (typeof val === "string") return val.split("\n");
    if (typeof val === "number" || typeof val === "boolean")
      return String(val).split("\n");
    // objects / arrays → pretty JSON
    try {
      return JSON.stringify(val, null, 2).split("\n");
    } catch {
      return [String(val)];
    }
  };

  // Turn /act result into a readable chat message
  const summarizeActResult = (res, { chip, role }) => {
    if (!res) return `✅ ${chip} via ${role || "agent"} — no result`;
    if (res.status === "error" || res.error)
      return `❌ ${res.error || "Action failed"}`;

    // 1) collect LLM outputs
    const chunks = Array.isArray(res.outputs)
      ? res.outputs.map((o) => {
          const tag = o?.type ? `[${o.type}] ` : "";
          const content =
            typeof o?.content === "string"
              ? o.content
              : JSON.stringify(o?.content, null, 2);
          return `${tag}${content}`;
        })
      : [];

    // 2) created shapes (ids)
    const created = res.created_shapes?.length
      ? `Created shapes: ${res.created_shapes.map((s) => s.id).join(", ")}`
      : "";

    // 3) any skipped
    const skipped = res.skipped?.length
      ? `Skipped: ${res.skipped.length} target(s)`
      : "";

    // 4) header + parts
    return [
      `✅ ${chip} via ${role || "agent"}`,
      chunks.join("\n\n"),
      created,
      skipped,
    ]
      .filter(Boolean)
      .join("\n\n");
  };

  // Extract any image URLs from the standardized result
  const extractImageUrls = (res) => {
    if (!res?.created_shapes) return [];
    return res.created_shapes
      .filter((s) => s.type === "image" && s.imageUrl)
      .map((s) => s.imageUrl);
  };

  // Helpers to classify and gather context from clipNotes
  const isImageLike = (val) =>
    typeof val === "string" &&
    (/^data:image\//i.test(val) || /^https?:\/\//i.test(val));

  const dedupeBy = (arr, keyFn) => {
    const seen = new Set();
    const out = [];
    for (const item of arr) {
      const key = keyFn(item);
      if (!seen.has(key)) {
        seen.add(key);
        out.push(item);
      }
    }
    return out;
  };

  const gatherContextFromClips = (clips) => {
    const images = [];
    const texts = [];
    for (const c of clips) {
      const snip = c?.snip;
      if (!snip) continue;
      if (isImageLike(snip)) images.push(snip);
      else if (typeof snip === "string" && snip.trim()) texts.push(snip.trim());
    }
    // optional de-dup
    return {
      images: dedupeBy(images, (x) => x),
      texts: dedupeBy(texts, (x) => x),
    };
  };

  const badgePing = (key) => {
    setCopiedKey(key);
    setTimeout(() => setCopiedKey(null), 1200);
  };

  const notifyCanvas = (payload) => {
    try {
      window.dispatchEvent(
        new CustomEvent("chatbot-copy", { detail: payload })
      );
    } catch {}
  };

  const copyText = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text || "");
      badgePing(key);
      notifyCanvas({ kind: "text", content: text || "" });
    } catch (e) {
      console.error("Copy text failed:", e);
    }
  };

  const IMAGE_PROXY_URL =
    "https://flask-app-jqwkqdscaq-uc.a.run.app/proxy-image?url=";
  const canWriteImages = () => !!(navigator.clipboard && window.ClipboardItem);
  const writeImageToClipboard = async (blob, url, key) => {
    const item = new ClipboardItem({
      [blob.type || "image/png"]: blob,
      "text/html": new Blob([`<img src="${url}">`], { type: "text/html" }),
      "text/plain": new Blob([url], { type: "text/plain" }),
    });
    await navigator.clipboard.write([item]);
    badgePing(key);
    notifyCanvas({ kind: "image", content: url });
  };
  const fetchBlob = async (url) => {
    const res = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    const ct = res.headers.get("content-type") || "";
    if (!ct.startsWith("image/")) throw new Error("not an image");
    return await res.blob();
  };

  const canvasBlob = (url) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      // img.crossOrigin = "anonymous"; // needs server CORS
      img.onload = () => {
        const c = document.createElement("canvas");
        c.width = img.naturalWidth;
        c.height = img.naturalHeight;
        const ctx = c.getContext("2d");
        ctx.drawImage(img, 0, 0);
        c.toBlob(
          (b) => (b ? resolve(b) : reject(new Error("toBlob failed"))),
          "image/png"
        );
      };
      img.onerror = () => reject(new Error("image load failed"));
      img.src = url;
    });

  const proxyBlob = async (url) => {
    const res = await fetch(IMAGE_PROXY_URL + encodeURIComponent(url));
    if (!res.ok) throw new Error("proxy fetch failed");
    return await res.blob();
  };

  // const htmlImg = (url) => {
  //   `<img data-chatbot-img="1" alt="chatbot image" src="${url.replace(
  //     /"/g,
  //     "&quot;"
  //   )}">`;
  // };

  const copyImage = async (url, key) => {
    // try {
    //   let blob;
    //   // handles https: and data: URIs
    //   const res = await fetch(url);
    //   blob = await res.blob();

    //   if (navigator.clipboard && window.ClipboardItem) {
    //     const item = new ClipboardItem({ [blob.type || "image/png"]: blob });
    //     await navigator.clipboard.write([item]);
    //     badgePing(key);
    //     notifyCanvas({ kind: "image", content: url });
    //   } else {
    //     // fallback: copy the URL instead
    //     await navigator.clipboard.writeText(url);
    //     badgePing(key);
    //     notifyCanvas({ kind: "image-url", content: url });
    //   }
    // } catch (err) {
    //   console.error("Image copy failed, falling back to URL:", err);
    //   try {
    //     await navigator.clipboard.writeText(url);
    //     badgePing(key);
    //     notifyCanvas({ kind: "image-url", content: url });
    //   } catch (e2) {
    //     console.error("URL copy failed:", e2);
    //   }
    // }
    try {
      if (!canWriteImages()) throw new Error("no image clipboard support");
      let blob;
      if (url.startsWith("data:")) {
        blob = await (await fetch(url)).blob();
      } else {
        try {
          // 1) direct fetch → blob
          blob = await fetchBlob(url);
        } catch {
          try {
            // 2) draw to canvas (requires CORS on the image host)
            blob = await canvasBlob(url);
          } catch {
            // 3) proxy (server fetches and returns with permissive CORS)
            blob = await proxyBlob(url);
          }
        }
      }
      await writeImageToClipboard(blob, url, key);
    } catch (e) {
      // try {
      //   const items = {};

      //   // Try to include a real bitmap first
      //   if (canWriteImages()) {
      //     try {
      //       let blob;
      //       if (url.startsWith("data:")) {
      //         blob = await (await fetch(url)).blob();
      //       } else {
      //         try {
      //           blob = await fetchBlob(url);
      //         } catch {
      //           try {
      //             blob = await canvasBlob(url);
      //           } catch {
      //             blob = await proxyBlob(url);
      //           }
      //         }
      //       }
      //       items[blob.type || "image/png"] = blob;
      //     } catch (_) {
      //       /* fall through to HTML/URL */
      //     }
      //   }
      //   // Always add HTML + text variants so paste can detect image intent
      //   items["text/html"] = new Blob([htmlImg(url)], { type: "text/html" });
      //   items["text/plain"] = new Blob([`CB_IMG:${url}`], { type: "text/plain" });
      //   items["text/uri-list"] = new Blob([url], { type: "text/uri-list" });

      //   await navigator.clipboard.write([new ClipboardItem(items)]);
      //   badgePing(key);
      //   notifyCanvas({
      //     kind: items["image/png"] ? "image" : "image-url",
      //     content: url,
      //   });
      // }

      console.error("Bitmap copy failed; copying URL instead:", e);
      await navigator.clipboard.writeText(url);
      badgePing(key);
      notifyCanvas({ kind: "image-url", content: url });
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
                    {msg.sender === "bot" && (
                      <button
                        className="chatbot-copy-btn"
                        title="Copy reply"
                        onClick={() =>
                          copyText(toLines(msg.text).join("\n"), `msg-${idx}`)
                        }
                      >
                        <FontAwesomeIcon icon={faCopy} />
                      </button>
                    )}
                    {copiedKey === `msg-${idx}` && (
                      <span className="chatbot-copied-pill">Copied</span>
                    )}

                    {/* {msg.text.split("\n").map((line, i) => (
                      <p key={i} style={{ margin: 0 }}>
                        {line}
                      </p>
                    ))} */}
                    {toLines(msg.text).map((line, i) => (
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
                          <div
                            key={i}
                            className="chatbot-chip"
                            onClick={() => {
                              handleChipClick(chip, msg.type);
                            }}
                            title={`Click to use "${chip}"`}
                            style={{ cursor: "pointer" }}
                          >
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
                        {/* {msg.image_urls.map((url, i) => (
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
                        ))} */}

                        {msg.image_urls.map((url, i) => (
                          <div key={i} className="chatbot-image-wrap">
                            <img
                              src={url}
                              alt={`Generated visual ${i + 1}`}
                              style={{
                                width: "100%",
                                borderRadius: "6px",
                                objectFit: "cover",
                              }}
                            />
                            <button
                              className="chatbot-copy-img-btn"
                              title="Copy image"
                              onClick={() => copyImage(url, `img-${idx}-${i}`)}
                            >
                              <FontAwesomeIcon icon={faCopy} />
                            </button>
                            {copiedKey === `img-${idx}-${i}` && (
                              <span className="chatbot-copied-pill">
                                Copied
                              </span>
                            )}
                          </div>
                        ))}
                      </div>
                    )}

                    {Array.isArray(msg.attached_texts) &&
                      msg.attached_texts.length > 0 && (
                        <div
                          className="chatbot-text-attachments"
                          style={{ marginTop: 10, display: "grid", gap: 8 }}
                        >
                          {msg.attached_texts.map((t, i) => (
                            <div
                              key={i}
                              style={{
                                fontSize: 12,
                                lineHeight: 1.4,
                                padding: "6px 8px",
                                borderRadius: 6,
                                background: "rgba(0,0,0,0.06)",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                              }}
                            >
                              {t.length > 400 ? t.slice(0, 400) + "…" : t}
                            </div>
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
