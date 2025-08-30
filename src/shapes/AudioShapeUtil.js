// src/shapes/AudioShapeUtil.js
import React, { useEffect, useMemo, useRef } from "react";
import {
  BaseBoxShapeUtil,
  HTMLContainer,
  Rectangle2d,
  T,
  resizeBox,
} from "tldraw";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
  faPlay,
  faPause,
  faVolumeXmark,
  faVolumeUp,
} from "@fortawesome/free-solid-svg-icons";

export class AudioShapeUtil extends BaseBoxShapeUtil {
  static type = "audio";

  static props = {
    w: T.number,
    h: T.number,
    src: T.string,
    title: T.string,
    isPlaying: T.boolean,
    currentTime: T.number,
    duration: T.number,
  };

  getDefaultProps() {
    return {
      w: 420,
      h: 39,
      src: "",
      title: "Audio",
      isPlaying: false,
      currentTime: 0,
      duration: 0,
    };
  }

  getGeometry(shape) {
    return new Rectangle2d({
      width: shape.props.w,
      height: shape.props.h,
      isFilled: true,
    });
  }

  canResize() {
    return false;
  }

  canEdit() {
    return false;
  }

  isAspectRatioLocked() {
    return false;
  }

  // Remove duplicate onResize - BaseBoxShapeUtil handles this
  onResize(shape, info) {
    return resizeBox(shape, info);
  }

  component(shape) {
    return <AudioShapeView util={this} shape={shape} />;
  }

  indicator(shape) {
    return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
  }
}

function AudioShapeView({ util, shape }) {
  const editor = util.editor;
  const audioRef = useRef(null);
  const rafRef = useRef(null);

  // Play/pause sync with props
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !shape.props.src) return;

    console.log("Play state changed:", shape.props.isPlaying);

    if (shape.props.isPlaying) {
      el.play().catch((error) => {
        console.error("Auto-play failed:", error);
        // Reset playing state if play fails
        editor.updateShape({
          id: shape.id,
          type: "audio",
          props: { isPlaying: false },
        });
      });
    } else {
      el.pause();
    }

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [shape.props.isPlaying, shape.props.src, editor, shape.id]);

  // Keep <audio> element in sync when currentTime prop changes externally
  useEffect(() => {
    const el = audioRef.current;
    if (!el) return;
    if (
      Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
    ) {
      el.currentTime = shape.props.currentTime || 0;
    }
  }, [shape.props.currentTime]);

  // Wire audio element → shape props (time, duration, ended)
  useEffect(() => {
    const el = audioRef.current;
    if (!el || !shape.props.src) return;

    console.log("Setting up audio listeners for:", shape.props.src);

    const updateFromAudio = () => {
      // rafRef.current = requestAnimationFrame(() => {
      //   // Ensure all values are valid numbers before updating
      //   const currentTime = Number.isFinite(el.currentTime)
      //     ? Math.max(0, el.currentTime)
      //     : 0;
      //   const duration = Number.isFinite(el.duration)
      //     ? Math.max(0, el.duration)
      //     : Number.isFinite(shape.props.duration)
      //     ? shape.props.duration
      //     : 0;

      //   editor.updateShape({
      //     id: shape.id,
      //     type: "audio",
      //     props: {
      //       currentTime,
      //       duration,
      //     },
      //   });
      // });
      const nextCurrent = Number.isFinite(el.currentTime)
        ? Math.max(0, el.currentTime)
        : 0;
      const nextDuration = Number.isFinite(el.duration)
        ? Math.max(0, el.duration)
        : Number.isFinite(shape.props.duration)
        ? shape.props.duration
        : 0;

      if (
        Math.abs((shape.props.currentTime || 0) - nextCurrent) > 0.05 ||
        (shape.props.duration || 0) !== nextDuration
      ) {
        editor.updateShape({
          id: shape.id,
          type: "audio",
          props: { currentTime: nextCurrent, duration: nextDuration },
        });
      }
    };

    const onLoaded = () => {
      console.log("Audio loaded, duration:", el.duration);
      const duration =
        Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
      if ((shape.props.duration || 0) !== duration) {
        editor.updateShape({
          id: shape.id,
          type: "audio",
          props: { duration },
        });
      }
    };

    const onError = (e) => {
      console.error("Audio loading error:", e);
    };

    const onCanPlay = () => {
      console.log("Audio can play");
    };

    const onEnded = () => {
      console.log("Audio ended");
      editor.updateShape({
        id: shape.id,
        type: "audio",
        props: { isPlaying: false, currentTime: 0 },
      });
    };

    el.addEventListener("timeupdate", updateFromAudio);
    el.addEventListener("loadedmetadata", onLoaded);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);
    el.addEventListener("canplay", onCanPlay);

    return () => {
      el.removeEventListener("timeupdate", updateFromAudio);
      el.removeEventListener("loadedmetadata", onLoaded);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.removeEventListener("canplay", onCanPlay);
    };
  }, [editor, shape.id, shape.props.src]); // Add src to dependencies

  const togglePlay = async (e) => {
    console.log("🔴 BUTTON CLICKED - togglePlay called!"); // This should appear
    e.stopPropagation();

    const el = audioRef.current;
    if (!el || !shape.props.src) {
      console.warn("Cannot play: no audio element or source");
      return;
    }

    const newIsPlaying = !shape.props.isPlaying;

    try {
      if (newIsPlaying) {
        console.log("Attempting to play audio");
        await el.play();
      } else {
        console.log("Pausing audio");
        el.pause();
      }

      editor.updateShape({
        id: shape.id,
        type: "audio",
        props: { isPlaying: newIsPlaying },
      });
    } catch (error) {
      console.error("Play/pause error:", error);
      // Reset playing state on error
      editor.updateShape({
        id: shape.id,
        type: "audio",
        props: { isPlaying: false },
      });
    }
  };

  const seek = (e) => {
    e.stopPropagation();
    const v = Number(e.target.value);
    if (!Number.isFinite(v) || v < 0) return;

    const el = audioRef.current;
    if (!el || !shape.props.src) return;

    const clamped = Math.max(0, Math.min(v, shape.props.duration || v));
    if (Math.abs(clamped - (shape.props.currentTime || 0)) < 0.01) return;

    try {
      el.currentTime = clamped;
      editor.updateShape({
        id: shape.id,
        type: "audio",
        props: { currentTime: clamped },
      });
    } catch (error) {
      console.error("Seek error:", error);
    }
  };

  // const fmt = (s) => {
  //   const v = Number.isFinite(s) && s > 0 ? s : 0;
  //   const m = Math.floor(v / 60);
  //   const ss = Math.floor(v % 60)
  //     .toString()
  //     .padStart(2, "0");
  //   return `${m.toString().padStart(2, "0")}:${ss}`;
  // };

  const fmt = (s) => {
    if (!Number.isFinite(s) || s < 0) s = 0;
    const m = Math.floor(s / 60);
    const ss = Math.floor(s % 60)
      .toString()
      .padStart(2, "0");
    return `${m}:${ss}`;
  };

  const toggleMute = (e) => {
    e.stopPropagation();
    const el = audioRef.current;
    if (!el) return;
    el.muted = !el.muted;
  };

  // const styles = useMemo(
  //   () => ({
  //     wrapper: {
  //       width: "100%",
  //       height: "100%",
  //       background: "#f3f4f6",
  //       border: "1px solid #e5e7eb",
  //       borderRadius: 8,
  //       display: "flex",
  //       alignItems: "center",
  //       gap: 10,
  //       padding: "8px 12px",
  //       boxSizing: "border-box",
  //       userSelect: "none",
  //     },
  //     play: {
  //       width: 28,
  //       height: 28,
  //       borderRadius: "999px",
  //       border: "1px solid #d1d5db",
  //       background: "white",
  //       display: "grid",
  //       placeItems: "center",
  //       cursor: "pointer",
  //       flex: "0 0 auto",
  //       pointerEvents: "all", // Ensure button receives events
  //       zIndex: 10, // Bring button to front
  //     },
  //     title: {
  //       fontSize: 12,
  //       color: "#374151",
  //       flex: "0 0 auto",
  //       maxWidth: 120,
  //       whiteSpace: "nowrap",
  //       overflow: "hidden",
  //       textOverflow: "ellipsis",
  //     },
  //     trackWrap: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
  //     time: {
  //       fontSize: 12,
  //       color: "#6b7280",
  //       minWidth: 38,
  //       textAlign: "right",
  //     },
  //     range: {
  //       flex: 1,
  //       WebkitAppearance: "none",
  //       height: 4,
  //       borderRadius: 999,
  //       background: "#e5e7eb",
  //       outline: "none",
  //     },
  //     icon: { width: 0, height: 0, borderStyle: "solid" },
  //   }),
  //   []
  // );

  const styles = useMemo(
    () => ({
      wrapper: {
        width: "100%",
        height: "100%",
        background: "var(--color-low)",
        border: "1px solid var(--color-low-border)",
        borderRadius: 8,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "6px 10px",
        boxSizing: "border-box",
        userSelect: "none",
      },
      play: {
        width: 22,
        height: 22,
        borderRadius: 999,
        border: "1px solid transparent",
        background: "transparent",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        flex: "0 0 auto",
        pointerEvents: "all",
      },
      timeCombo: {
        fontSize: 12,
        color: "var(--color-text-3)",
        whiteSpace: "nowrap",
        flex: "0 0 auto",
        minWidth: 78, // e.g. "00:00 / 00:00"
      },
      rangeWrap: { flex: 1, display: "flex", alignItems: "center" },
      range: {
        width: "100%",
        WebkitAppearance: "none",
        height: 4,
        borderRadius: 999,
        background: "#e5e7eb",
        outline: "none",
      },
      mute: {
        width: 22,
        height: 22,
        borderRadius: 999,
        border: "1px solid transparent",
        background: "transparent",
        display: "grid",
        placeItems: "center",
        cursor: "pointer",
        flex: "0 0 auto",
        pointerEvents: "all",
      },
      icon: { width: 0, height: 0, borderStyle: "solid" },
    }),
    []
  );

  return (
    <HTMLContainer
      id={shape.id}
      style={{
        width: shape.props.w,
        height: shape.props.h,
        pointerEvents: "all",
        color: "var(--color-text-3)",
        backgroundColor: "var(--color-low)",
        border: "1px solid var(--color-low-border)",
        borderRadius: 8,
        boxSizing: "border-box",
      }}
      onPointerDown={(e) => {
        console.log("HTMLContainer pointer down");
        // e.stopPropagation();
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      onClick={(e) => {
        console.log("HTMLContainer clicked");
        // e.stopPropagation();
      }}
    >
      {/* <div style={styles.wrapper}>
        <audio ref={audioRef} src={shape.props.src} preload="metadata" />
        <button
          aria-label={shape.props.isPlaying ? "Pause" : "Play"}
          style={styles.play}
          onClick={togglePlay}
          onPointerDown={(e) => e.stopPropagation()}
          onPointerUp={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onMouseUp={(e) => e.stopPropagation()}
        >
          {shape.props.isPlaying ? (
            <div style={{ display: "flex", gap: 3 }}>
              <div style={{ width: 3, height: 12, background: "#111827" }} />
              <div style={{ width: 3, height: 12, background: "#111827" }} />
            </div>
          ) : (
            <div
              style={{
                ...styles.icon,
                borderWidth: "7px 0 7px 11px",
                borderColor: "transparent transparent transparent #111827",
                marginLeft: 2,
              }}
            />
          )}
        </button>

        <div style={styles.title} title={shape.props.title}>
          {shape.props.title}
        </div>

        <div style={styles.trackWrap}>
          <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
          <input
            type="range"
            min={0}
            max={shape.props.duration || 0}
            step="0.01"
            value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
            onChange={seek}
            style={styles.range}
          />
          <div style={styles.time}>{fmt(shape.props.duration)}</div>
        </div>
      </div> */}

      {/* scale-safe wrapper like tl's internal components */}
      {/* <div className="tl-counter-scaled">
        <div className="tl-audio-container">
          <div style={styles.wrapper}>
            <audio
              ref={audioRef}
              src={shape.props.src}
              preload="metadata"
              // give it tl-like class names for easier styling in CSS
              className={`tl-audio tl-audio-shape-${
                shape.id.split(":")[1] || shape.id
              }`}
              // when you want to let the native controls show, flip this to true
              controls={false}
              // keep the element interactive
              style={{ pointerEvents: "all", flex: "0 0 auto" }}
            />
            <button
              aria-label={shape.props.isPlaying ? "Pause" : "Play"}
              style={styles.play}
              onClick={togglePlay}
              onPointerDown={(e) => e.stopPropagation()}
              onPointerUp={(e) => e.stopPropagation()}
              onMouseDown={(e) => e.stopPropagation()}
              onMouseUp={(e) => e.stopPropagation()}
              className="tl-audio-play"
            >
              {shape.props.isPlaying ? (
                <div style={{ display: "flex", gap: 3 }}>
                  <div
                    style={{ width: 3, height: 12, background: "#111827" }}
                  />
                  <div
                    style={{ width: 3, height: 12, background: "#111827" }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    ...styles.icon,
                    borderWidth: "7px 0 7px 11px",
                    borderColor: "transparent transparent transparent #111827",
                    marginLeft: 2,
                  }}
                />
              )}
            </button>
            <div
              style={styles.title}
              title={shape.props.title}
              className="tl-audio-title"
            >
              {shape.props.title}
            </div>
            <div style={styles.trackWrap} className="tl-audio-track">
              <div style={styles.time} className="tl-audio-time">
                {fmt(shape.props.currentTime)}
              </div>
              <input
                type="range"
                min={0}
                max={shape.props.duration || 0}
                step="0.01"
                value={Math.min(
                  shape.props.currentTime,
                  shape.props.duration || 0
                )}
                onChange={seek}
                style={styles.range}
                className="tl-audio-range"
                onPointerDown={(e) => e.stopPropagation()}
              />
              <div style={styles.time} className="tl-audio-duration">
                {fmt(shape.props.duration)}
              </div>
            </div>
          </div>
        </div>
      </div> */}

      {/* <div className="tl-counter-scaled">
        <div className="tl-audio-container">
          <div style={styles.wrapper}>
            <audio
              ref={audioRef}
              src={shape.props.src}
              preload="metadata"
              className={`tl-audio tl-audio-shape-${
                shape.id.split(":")[1] || shape.id
              }`}
              controls={false}
              style={{ pointerEvents: "all", flex: "0 0 auto" }}
              // onClick={(e) => e.stopPropagation()}
              // onPointerDown={(e) => e.stopPropagation()}
            />
            <button
              aria-label={shape.props.isPlaying ? "Pause" : "Play"}
              style={styles.play}
              onClick={togglePlay}
              // onPointerDown={(e) => e.stopPropagation()}
              // onPointerUp={(e) => e.stopPropagation()}
              // onMouseDown={(e) => e.stopPropagation()}
              // onMouseUp={(e) => e.stopPropagation()}
              className="tl-audio-play"
            >
              {shape.props.isPlaying ? (
                <div style={{ display: "flex", gap: 3 }}>
                  <div
                    style={{ width: 3, height: 12, background: "#111827" }}
                  />
                  <div
                    style={{ width: 3, height: 12, background: "#111827" }}
                  />
                </div>
              ) : (
                <div
                  style={{
                    ...styles.icon,
                    borderWidth: "7px 0 7px 11px",
                    borderColor: "transparent transparent transparent #111827",
                    marginLeft: 2,
                  }}
                />
              )}
            </button>

            <div
              style={styles.title}
              title={shape.props.title}
              className="tl-audio-title"
            >
              {shape.props.title || "Recording"}
            </div>

            <div
              style={styles.trackWrap}
              className="tl-audio-track"
              onPointerDown={(e) => e.stopPropagation()}
            >
              <div style={styles.time} className="tl-audio-time">
                {fmt(shape.props.currentTime)}
              </div>
              <input
                type="range"
                min={0}
                max={Math.max(0.01, shape.props.duration || 0)}
                step="0.01"
                value={Math.min(
                  shape.props.currentTime,
                  shape.props.duration || 0
                )}
                onChange={seek}
                style={styles.range}
                className="tl-audio-range"
                onPointerDown={(e) => e.stopPropagation()}
              />
              <div style={styles.time} className="tl-audio-duration">
                {fmt(shape.props.duration)}
              </div>
            </div>
          </div>
        </div>
      </div> */}

      {/* <div className="tl-counter-scaled"> */}
      <div className="tl-audio-container">
        <div style={styles.wrapper}>
          {/* hidden native element that actually plays audio */}
          <audio
            ref={audioRef}
            src={shape.props.src}
            preload="metadata"
            className={`tl-audio tl-audio-shape-${
              shape.id.split(":")[1] || shape.id
            }`}
            controls={false}
            style={{ display: "none" }}
            onClick={(e) => e.stopPropagation()}
            onPointerDown={(e) => e.stopPropagation()}
          />

          {/* Play / Pause */}
          <button
            aria-label={shape.props.isPlaying ? "Pause" : "Play"}
            style={styles.play}
            onClick={togglePlay}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
            onMouseDown={(e) => e.stopPropagation()}
            onMouseUp={(e) => e.stopPropagation()}
          >
            {shape.props.isPlaying ? (
              <div style={{ display: "flex", gap: 3 }}>
                <div style={{ width: 2, height: 10, background: "#111827" }} />
                <div style={{ width: 2, height: 10, background: "#111827" }} />
              </div>
            ) : (
              <div
                style={{
                  ...styles.icon,
                  borderWidth: "6px 0 6px 10px",
                  borderColor: "transparent transparent transparent #111827",
                  marginLeft: 1,
                }}
              />
            )}
          </button>

          {/* 00:03 / 00:05 */}
          <div style={styles.timeCombo}>
            {fmt(shape.props.currentTime)} / {fmt(shape.props.duration)}
          </div>

          {/* Seekbar */}
          <div
            style={styles.rangeWrap}
            onPointerDown={(e) => e.stopPropagation()}
          >
            <input
              type="range"
              min={0}
              max={Math.max(0.01, shape.props.duration || 0)}
              step="0.01"
              value={Math.min(
                shape.props.currentTime,
                shape.props.duration || 0
              )}
              onChange={seek}
              style={styles.range}
              className="tl-audio-range"
            />
          </div>

          {/* Mute / Unmute */}
          {/* <button
            aria-label="Toggle mute"
            style={styles.mute}
            onClick={toggleMute}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <span style={{ fontSize: 12, lineHeight: 1 }}>🔈</span>
          </button> */}
          {/* Mute / Unmute */}
          <button
            // aria-label="Toggle mute"
            style={styles.mute}
            onClick={toggleMute}
            onPointerDown={(e) => e.stopPropagation()}
            onPointerUp={(e) => e.stopPropagation()}
          >
            <FontAwesomeIcon
              icon={audioRef.current?.muted ? faVolumeUp : faVolumeXmark}
              style={{ fontSize: 14, color: "#111827" }}
            />
          </button>
        </div>
      </div>
      {/* </div> */}
    </HTMLContainer>
  );
}
//////////////////
//////////////////
//////////////////
//////////////////
//////////////////
//////////////////
//////////////////
//////////////////
//////////////////
// // // src/shapes/AudioShapeUtil.js
// import React, { useEffect, useMemo, useRef } from "react";
// import {
//   BaseBoxShapeUtil,
//   HTMLContainer,
//   Rectangle2d,
//   T,
//   resizeBox,
// } from "tldraw";

// export class AudioShapeUtil extends BaseBoxShapeUtil {
//   static type = "audio";

//   static props = {
//     w: T.number,
//     h: T.number,
//     src: T.string,
//     title: T.string,
//     isPlaying: T.boolean,
//     currentTime: T.number,
//     duration: T.number,
//   };

//   getDefaultProps() {
//     return {
//       w: 360,
//       h: 60,
//       src: "",
//       title: "Audio",
//       isPlaying: false,
//       currentTime: 0,
//       duration: 0, // Make sure this is always a valid number
//     };
//   }

//   getGeometry(shape) {
//     return new Rectangle2d({
//       width: shape.props.w,
//       height: shape.props.h,
//       isFilled: true,
//     });
//   }

//   canResize() {
//     return true;
//   }

//   canEdit() {
//     return false;
//   }

//   isAspectRatioLocked() {
//     return false;
//   }

//   // Remove duplicate onResize - BaseBoxShapeUtil handles this
//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   component(shape) {
//     return <AudioShapeView util={this} shape={shape} />;
//   }

//   indicator(shape) {
//     return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
//   }
// }

// function AudioShapeView({ util, shape }) {
//   const editor = util.editor;
//   const audioRef = useRef(null);
//   const rafRef = useRef(null);

//   // Play/pause sync with props
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el || !shape.props.src) return;

//     console.log("Play state changed:", shape.props.isPlaying);

//     if (shape.props.isPlaying) {
//       el.play().catch((error) => {
//         console.error("Auto-play failed:", error);
//         // Reset playing state if play fails
//         editor.updateShape({
//           id: shape.id,
//           type: "audio",
//           props: { isPlaying: false },
//         });
//       });
//     } else {
//       el.pause();
//     }

//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//     };
//   }, [shape.props.isPlaying, shape.props.src, editor, shape.id]);

//   // Keep <audio> element in sync when currentTime prop changes externally
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (
//       Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
//     ) {
//       el.currentTime = shape.props.currentTime || 0;
//     }
//   }, [shape.props.currentTime]);

//   // Wire audio element → shape props (time, duration, ended)
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el || !shape.props.src) return;

//     console.log("Setting up audio listeners for:", shape.props.src);

//     const updateFromAudio = () => {
//       rafRef.current = requestAnimationFrame(() => {
//         // Ensure all values are valid numbers before updating
//         const currentTime = Number.isFinite(el.currentTime)
//           ? Math.max(0, el.currentTime)
//           : 0;
//         const duration = Number.isFinite(el.duration)
//           ? Math.max(0, el.duration)
//           : Number.isFinite(shape.props.duration)
//           ? shape.props.duration
//           : 0;

//         editor.updateShape({
//           id: shape.id,
//           type: "audio",
//           props: {
//             currentTime,
//             duration,
//           },
//         });
//       });
//     };

//     const onLoaded = () => {
//       console.log("Audio loaded, duration:", el.duration);
//       const duration =
//         Number.isFinite(el.duration) && el.duration > 0 ? el.duration : 0;
//       editor.updateShape({
//         id: shape.id,
//         type: "audio",
//         props: { duration },
//       });
//     };

//     const onError = (e) => {
//       console.error("Audio loading error:", e);
//     };

//     const onCanPlay = () => {
//       console.log("Audio can play");
//     };

//     const onEnded = () => {
//       console.log("Audio ended");
//       editor.updateShape({
//         id: shape.id,
//         type: "audio",
//         props: { isPlaying: false, currentTime: 0 },
//       });
//     };

//     el.addEventListener("timeupdate", updateFromAudio);
//     el.addEventListener("loadedmetadata", onLoaded);
//     el.addEventListener("ended", onEnded);
//     el.addEventListener("error", onError);
//     el.addEventListener("canplay", onCanPlay);

//     return () => {
//       el.removeEventListener("timeupdate", updateFromAudio);
//       el.removeEventListener("loadedmetadata", onLoaded);
//       el.removeEventListener("ended", onEnded);
//       el.removeEventListener("error", onError);
//       el.removeEventListener("canplay", onCanPlay);
//     };
//   }, [editor, shape.id, shape.props.src]); // Add src to dependencies

//   const togglePlay = async (e) => {
//     e.stopPropagation();

//     console.log("Toggling play state from:", shape.props.isPlaying);

//     const el = audioRef.current;
//     if (!el || !shape.props.src) {
//       console.warn("Cannot play: no audio element or source");
//       return;
//     }

//     const newIsPlaying = !shape.props.isPlaying;

//     try {
//       if (newIsPlaying) {
//         console.log("Attempting to play audio");
//         await el.play();
//       } else {
//         console.log("Pausing audio");
//         el.pause();
//       }

//       editor.updateShape({
//         id: shape.id,
//         type: "audio",
//         props: { isPlaying: newIsPlaying },
//       });
//     } catch (error) {
//       console.error("Play/pause error:", error);
//       // Reset playing state on error
//       editor.updateShape({
//         id: shape.id,
//         type: "audio",
//         props: { isPlaying: false },
//       });
//     }
//   };

//   const seek = (e) => {
//     e.stopPropagation();
//     const v = Number(e.target.value);

//     // Validate the seek value
//     if (!Number.isFinite(v) || v < 0) return;

//     const el = audioRef.current;
//     if (!el || !shape.props.src) return;

//     console.log("Seeking to:", v);

//     try {
//       el.currentTime = v;
//       editor.updateShape({
//         id: shape.id,
//         type: "audio",
//         props: { currentTime: Math.max(0, v) },
//       });
//     } catch (error) {
//       console.error("Seek error:", error);
//     }
//   };

//   const fmt = (s) => {
//     if (!Number.isFinite(s) || s < 0) s = 0;
//     const m = Math.floor(s / 60);
//     const ss = Math.floor(s % 60)
//       .toString()
//       .padStart(2, "0");
//     return `${m}:${ss}`;
//   };

//   const styles = useMemo(
//     () => ({
//       wrapper: {
//         width: "100%",
//         height: "100%",
//         background: "#f3f4f6",
//         border: "1px solid #e5e7eb",
//         borderRadius: 8,
//         display: "flex",
//         alignItems: "center",
//         gap: 10,
//         padding: "8px 12px",
//         boxSizing: "border-box",
//         userSelect: "none",
//       },
//       play: {
//         width: 28,
//         height: 28,
//         borderRadius: "999px",
//         border: "1px solid #d1d5db",
//         background: "white",
//         display: "grid",
//         placeItems: "center",
//         cursor: "pointer",
//         flex: "0 0 auto",
//       },
//       title: {
//         fontSize: 12,
//         color: "#374151",
//         flex: "0 0 auto",
//         maxWidth: 120,
//         whiteSpace: "nowrap",
//         overflow: "hidden",
//         textOverflow: "ellipsis",
//       },
//       trackWrap: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
//       time: {
//         fontSize: 12,
//         color: "#6b7280",
//         minWidth: 38,
//         textAlign: "right",
//       },
//       range: {
//         flex: 1,
//         WebkitAppearance: "none",
//         height: 4,
//         borderRadius: 999,
//         background: "#e5e7eb",
//         outline: "none",
//       },
//       icon: { width: 0, height: 0, borderStyle: "solid" },
//     }),
//     []
//   );

//   return (
//     <HTMLContainer
//       id={shape.id}
//       style={{ width: shape.props.w, height: shape.props.h }}
//       onPointerDown={(e) => e.stopPropagation()}
//       onDoubleClick={(e) => e.stopPropagation()}
//       onClick={(e) => e.stopPropagation()}
//     >
//       <div style={styles.wrapper}>
//         <audio ref={audioRef} src={shape.props.src} preload="metadata" />
//         <button
//           aria-label={shape.props.isPlaying ? "Pause" : "Play"}
//           style={styles.play}
//           onClick={togglePlay}
//         >
//           {shape.props.isPlaying ? (
//             <div style={{ display: "flex", gap: 3 }}>
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//             </div>
//           ) : (
//             <div
//               style={{
//                 ...styles.icon,
//                 borderWidth: "7px 0 7px 11px",
//                 borderColor: "transparent transparent transparent #111827",
//                 marginLeft: 2,
//               }}
//             />
//           )}
//         </button>

//         <div style={styles.title} title={shape.props.title}>
//           {shape.props.title}
//         </div>

//         <div style={styles.trackWrap}>
//           <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
//           <input
//             type="range"
//             min={0}
//             max={shape.props.duration || 0}
//             step="0.01"
//             value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
//             onChange={seek}
//             style={styles.range}
//           />
//           <div style={styles.time}>{fmt(shape.props.duration)}</div>
//         </div>
//       </div>
//     </HTMLContainer>
//   );
// }
/////
/////
/////
/////
/////
/////
/////
/////
/////
/////
/////
/////
// // src/shapes/AudioShapeUtil.js
// import React, { useEffect, useMemo, useRef } from "react";
// import {
//   BaseBoxShapeUtil,
//   HTMLContainer,
//   Rectangle2d, // only needed for indicator bounds, fine to keep
//   T,
//   resizeBox,
//   ShapeUtil,
// } from "tldraw";

// export class AudioShapeUtil extends BaseBoxShapeUtil {
//   // export class AudioShapeUtil extends ShapeUtil {
//   static type = "audio";

//   static props = {
//     w: T.number,
//     h: T.number,
//     src: T.string,
//     title: T.string,
//     isPlaying: T.boolean,
//     currentTime: T.number,
//     duration: T.number,
//   };

//   getDefaultProps() {
//     return {
//       w: 360,
//       h: 60,
//       src: "",
//       title: "",
//       isPlaying: false,
//       currentTime: 0,
//       duration: 0,
//     };
//   }

//   getGeometry(shape) {
//     return new Rectangle2d({
//       width: shape.props.w,
//       height: shape.props.h,
//       isFilled: true,
//     });
//   }
//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   canResize() {
//     return true;
//   }
//   canEdit() {
//     return false;
//   }
//   isAspectRatioLocked() {
//     return false;
//   }

//   // BaseBoxShapeUtil already supplies geometry & resize,
//   // but it's fine to keep onResize if you want explicitness.
//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   component(shape) {
//     return <AudioShapeView util={this} shape={shape} />;
//   }

//   indicator(shape) {
//     // simple rounded rect selection outline
//     return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
//   }
// }

// function AudioShapeView({ util, shape }) {
//   const editor = util.editor;
//   const audioRef = useRef(null);
//   const rafRef = useRef(null);

//   console.log(`${util} and ${shape}`);

//   // Play/pause sync with props
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (shape.props.isPlaying) el.play().catch(() => {});
//     else el.pause();
//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//     };
//   }, [shape.props.isPlaying, shape.props.src]);

//   // Keep <audio> element in sync when currentTime prop changes externally
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (
//       Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
//     ) {
//       el.currentTime = shape.props.currentTime || 0;
//     }
//   }, [shape.props.currentTime]);

//   // Wire audio element → shape props (time, duration, ended)
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;

//     const updateFromAudio = () => {
//       rafRef.current = requestAnimationFrame(() => {
//         console.log("About to update shape with props:", {
//           currentTime: el.currentTime,
//           duration: el.duration,
//           isPlaying: shape.props.isPlaying,
//         });

//         editor.updateShape({
//           id: shape.id,
//           type: AudioShapeUtil.type,
//           props: {
//             currentTime: el.currentTime || 0,
//             duration: Number.isFinite(el.duration)
//               ? el.duration
//               : shape.props.duration || 0,
//           },
//         });
//       });
//     };

//     const onLoaded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { duration: Number.isFinite(el.duration) ? el.duration : 0 },
//       });
//     };

//     const onEnded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { isPlaying: false, currentTime: 0 },
//       });
//     };

//     el.addEventListener("timeupdate", updateFromAudio);
//     el.addEventListener("loadedmetadata", onLoaded);
//     el.addEventListener("ended", onEnded);
//     return () => {
//       el.removeEventListener("timeupdate", updateFromAudio);
//       el.removeEventListener("loadedmetadata", onLoaded);
//       el.removeEventListener("ended", onEnded);
//     };
//   }, [editor, shape.id, shape.props.duration]);

//   const togglePlay = (e) => {
//     e.stopPropagation();
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { isPlaying: !shape.props.isPlaying },
//     });
//   };

//   const seek = (e) => {
//     e.stopPropagation();
//     const v = Number(e.target.value);
//     const el = audioRef.current;
//     if (el) el.currentTime = v;
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { currentTime: v },
//     });
//   };

//   const fmt = (s) => {
//     if (!Number.isFinite(s) || s < 0) s = 0;
//     const m = Math.floor(s / 60);
//     const ss = Math.floor(s % 60)
//       .toString()
//       .padStart(2, "0");
//     return `${m}:${ss}`;
//   };

//   const styles = useMemo(
//     () => ({
//       wrapper: {
//         width: "100%",
//         height: "100%",
//         background: "#f3f4f6",
//         border: "1px solid #e5e7eb",
//         borderRadius: 8,
//         display: "flex",
//         alignItems: "center",
//         gap: 10,
//         padding: "8px 12px",
//         boxSizing: "border-box",
//         userSelect: "none",
//       },
//       play: {
//         width: 28,
//         height: 28,
//         borderRadius: "999px",
//         border: "1px solid #d1d5db",
//         background: "white",
//         display: "grid",
//         placeItems: "center",
//         cursor: "pointer",
//         flex: "0 0 auto",
//       },
//       title: {
//         fontSize: 12,
//         color: "#374151",
//         flex: "0 0 auto",
//         maxWidth: 120,
//         whiteSpace: "nowrap",
//         overflow: "hidden",
//         textOverflow: "ellipsis",
//       },
//       trackWrap: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
//       time: {
//         fontSize: 12,
//         color: "#6b7280",
//         minWidth: 38,
//         textAlign: "right",
//       },
//       range: {
//         flex: 1,
//         WebkitAppearance: "none",
//         height: 4,
//         borderRadius: 999,
//         background: "#e5e7eb",
//         outline: "none",
//       },
//       icon: { width: 0, height: 0, borderStyle: "solid" },
//     }),
//     []
//   );

//   return (
//     <HTMLContainer
//       id={shape.id}
//       style={{ width: shape.props.w, height: shape.props.h }}
//       onPointerDown={(e) => e.stopPropagation()}
//       onDoubleClick={(e) => e.stopPropagation()}
//     >
//       <div style={styles.wrapper}>
//         <audio ref={audioRef} src={shape.props.src} preload="metadata" />
//         <button
//           aria-label={shape.props.isPlaying ? "Pause" : "Play"}
//           style={styles.play}
//           onClick={togglePlay}
//         >
//           {shape.props.isPlaying ? (
//             <div style={{ display: "flex", gap: 3 }}>
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//             </div>
//           ) : (
//             <div
//               style={{
//                 ...styles.icon,
//                 borderWidth: "7px 0 7px 11px",
//                 borderColor: "transparent transparent transparent #111827",
//                 marginLeft: 2,
//               }}
//             />
//           )}
//         </button>

//         <div style={styles.title} title={shape.props.title}>
//           {shape.props.title}
//         </div>

//         <div style={styles.trackWrap}>
//           <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
//           <input
//             type="range"
//             min={0}
//             max={shape.props.duration || 0}
//             step="0.01"
//             value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
//             onChange={seek}
//             style={styles.range}
//           />
//           <div style={styles.time}>{fmt(shape.props.duration)}</div>
//         </div>
//       </div>
//     </HTMLContainer>
//   );
// }

/////////////////////////
/////////////////////////
/////////////////////////
/////////////////////////
/////////////////////////
/////////////////////////
/////////////////////////
/////////////////////////

// // src/shapes/AudioShapeUtil.js
// import React, { useEffect, useMemo, useRef } from "react";
// import {
//   BaseBoxShapeUtil,
//   ShapeUtil,
//   HTMLContainer,
//   Rectangle2d,
//   T,
//   resizeBox,
//   Tldraw,
//   resizeBox
// } from "tldraw";
// import { audioShapeMigrations } from "./AudioShapeMigration";

// // export class AudioShapeUtil extends BaseBoxShapeUtil {
// export class AudioShapeUtil extends ShapeUtil {
//   static type = "audio";
//   static props = {
//     w: T.number,
//     h: T.number,
//     src: T.string,
//     title: T.string,
//     isPlaying: T.boolean,
//     currentTime: T.number,
//     duration: T.number,
//   };
//   static migrations = audioShapeMigrations;

//   getDefaultProps() {
//     return {
//       w: 360,
//       h: 56,
//       src: "",
//       title: "Audio",
//       isPlaying: false,
//       currentTime: 0,
//       duration: 0,
//     };
//   }

//   canResize() {
//     return true;
//   }
//   canEdit() {
//     return false;
//   }
//   isAspectRatioLocked() {
//     return false;
//   }

// getGeometry(shape) {
//   return new Rectangle2d({
//     width: shape.props.w,
//     height: shape.props.h,
//     isFilled: true,
//   });
// }
// onResize(shape, info) {
//   return resizeBox(shape, info);
// }

//   component(shape) {
//     return <AudioShapeView util={this} shape={shape} />;
//   }
//   indicator(shape) {
//     return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
//   }
// }

// function AudioShapeView({ util, shape }) {
//   const editor = util.editor;
//   const audioRef = useRef(null);
//   const rafRef = useRef(null);

//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (shape.props.isPlaying) el.play().catch(() => {});
//     else el.pause();
//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//     };
//   }, [shape.props.isPlaying, shape.props.src]);

//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (
//       Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
//     ) {
//       el.currentTime = shape.props.currentTime || 0;
//     }
//   }, [shape.props.currentTime]);

//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;

//     const updateFromAudio = () => {
//       rafRef.current = requestAnimationFrame(() => {
//         editor.updateShape({
//           id: shape.id,
//           type: AudioShapeUtil.type,
//           props: {
//             currentTime: el.currentTime || 0,
//             duration: isFinite(el.duration)
//               ? el.duration
//               : shape.props.duration || 0,
//           },
//         });
//       });
//     };

//     const onLoaded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { duration: isFinite(el.duration) ? el.duration : 0 },
//       });
//     };

//     const onEnded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { isPlaying: false, currentTime: 0 },
//       });
//     };

//     el.addEventListener("timeupdate", updateFromAudio);
//     el.addEventListener("loadedmetadata", onLoaded);
//     el.addEventListener("ended", onEnded);
//     return () => {
//       el.removeEventListener("timeupdate", updateFromAudio);
//       el.removeEventListener("loadedmetadata", onLoaded);
//       el.removeEventListener("ended", onEnded);
//     };
//   }, [editor, shape.id, shape.props.duration]);

//   const togglePlay = (e) => {
//     e.stopPropagation();
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { isPlaying: !shape.props.isPlaying },
//     });
//   };

//   const seek = (e) => {
//     e.stopPropagation();
//     const v = Number(e.target.value);
//     const el = audioRef.current;
//     if (el) el.currentTime = v;
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { currentTime: v },
//     });
//   };

//   const fmt = (s) => {
//     if (!isFinite(s) || s < 0) s = 0;
//     const m = Math.floor(s / 60);
//     const ss = Math.floor(s % 60)
//       .toString()
//       .padStart(2, "0");
//     return `${m}:${ss}`;
//   };

//   const styles = useMemo(
//     () => ({
//       wrapper: {
//         width: "100%",
//         height: "100%",
//         background: "#f3f4f6",
//         border: "1px solid #e5e7eb",
//         borderRadius: 8,
//         display: "flex",
//         alignItems: "center",
//         gap: 10,
//         padding: "8px 12px",
//         boxSizing: "border-box",
//         userSelect: "none",
//       },
//       play: {
//         width: 28,
//         height: 28,
//         borderRadius: "999px",
//         border: "1px solid #d1d5db",
//         background: "white",
//         display: "grid",
//         placeItems: "center",
//         cursor: "pointer",
//         flex: "0 0 auto",
//       },
//       title: {
//         fontSize: 12,
//         color: "#374151",
//         flex: "0 0 auto",
//         maxWidth: 120,
//         whiteSpace: "nowrap",
//         overflow: "hidden",
//         textOverflow: "ellipsis",
//       },
//       trackWrap: { flex: 1, display: "flex", alignItems: "center", gap: 8 },
//       time: {
//         fontSize: 12,
//         color: "#6b7280",
//         minWidth: 38,
//         textAlign: "right",
//       },
//       range: {
//         flex: 1,
//         WebkitAppearance: "none",
//         height: 4,
//         borderRadius: 999,
//         background: "#e5e7eb",
//         outline: "none",
//       },
//       icon: { width: 0, height: 0, borderStyle: "solid" },
//     }),
//     []
//   );

//   return (
//     <HTMLContainer
//       style={{ width: shape.props.w, height: shape.props.h }}
//       onPointerDown={(e) => e.stopPropagation()}
//       onDoubleClick={(e) => e.stopPropagation()}
//     >
//       <div style={styles.wrapper}>
//         <audio ref={audioRef} src={shape.props.src} preload="metadata" />
//         <button
//           aria-label={shape.props.isPlaying ? "Pause" : "Play"}
//           style={styles.play}
//           onClick={togglePlay}
//         >
//           {shape.props.isPlaying ? (
//             <div style={{ display: "flex", gap: 3 }}>
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//             </div>
//           ) : (
//             <div
//               style={{
//                 ...styles.icon,
//                 borderWidth: "7px 0 7px 11px",
//                 borderColor: "transparent transparent transparent #111827",
//                 marginLeft: 2,
//               }}
//             />
//           )}
//         </button>
//         <div style={styles.title} title={shape.props.title}>
//           {shape.props.title}
//         </div>
//         <div style={styles.trackWrap}>
//           <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
//           <input
//             type="range"
//             min={0}
//             max={shape.props.duration || 0}
//             step="0.01"
//             value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
//             onChange={seek}
//             style={styles.range}
//           />
//           <div style={styles.time}>{fmt(shape.props.duration)}</div>
//         </div>
//       </div>
//     </HTMLContainer>
//   );
// }

/////////////
/////////////
/////////////
/////////////
/////////////
/////////////
/////////////

// import React, { useEffect, useMemo, useRef } from "react";
// import {
//   // ShapeUtil,
//   HTMLContainer,
//   Rectangle2d,
//   T,
//   resizeBox,
//   BaseBoxShapeUtil,
// } from "tldraw";
// import { audioShapeMigrations } from "./AudioShapeMigration";

// // Define the audio shape props schema
// const AudioShapeProps = {
//   w: T.number,
//   h: T.number,
//   src: T.string,
//   title: T.string,
//   isPlaying: T.boolean,
//   currentTime: T.number,
//   duration: T.number,
// };

// // Create the audio shape type definition
// const AudioShapeType = T.object({
//   id: T.string,
//   type: T.literal("audio-shape"),
//   x: T.number,
//   y: T.number,
//   rotation: T.number,
//   index: T.string,
//   parentId: T.string,
//   isLocked: T.boolean,
//   opacity: T.number,
//   props: T.object(AudioShapeProps),
//   meta: T.object({}),
// });

// export class AudioShapeUtil extends BaseBoxShapeUtil {
//   static type = "audio-shape";
//   static props = AudioShapeProps;
//   static migrations = audioShapeMigrations;

//   getDefaultProps() {
//     return {
//       w: 360,
//       h: 56,
//       src: "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav", // demo
//       title: "Audio",
//       isPlaying: false,
//       currentTime: 0,
//       duration: 0,
//     };
//   }

//   canResize() {
//     return true;
//   }

//   canEdit() {
//     return false;
//   }

//   isAspectRatioLocked() {
//     return false;
//   }

//   getGeometry(shape) {
//     return new Rectangle2d({
//       width: shape.props.w,
//       height: shape.props.h,
//       isFilled: true,
//     });
//   }

//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   // Component method - no hooks here
//   component(shape) {
//     return <AudioShapeView util={this} shape={shape} />;
//   }

//   indicator(shape) {
//     return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
//   }
// }

// /** Function component where hooks are allowed */
// function AudioShapeView({ util, shape }) {
//   const editor = util.editor;
//   const audioRef = useRef(null);
//   const rafRef = useRef(null);

//   // Play / pause when prop changes
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (shape.props.isPlaying) {
//       el.play().catch(() => {
//         /* autoplay may be blocked */
//       });
//     } else {
//       el.pause();
//     }
//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//     };
//   }, [shape.props.isPlaying, shape.props.src]);

//   // Sync currentTime prop -> element
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (
//       Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
//     ) {
//       el.currentTime = shape.props.currentTime || 0;
//     }
//   }, [shape.props.currentTime]);

//   // Wire element events -> shape props
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;

//     const updateFromAudio = () => {
//       rafRef.current = requestAnimationFrame(() => {
//         editor.updateShape({
//           id: shape.id,
//           type: AudioShapeUtil.type,
//           props: {
//             currentTime: el.currentTime || 0,
//             duration: isFinite(el.duration)
//               ? el.duration
//               : shape.props.duration || 0,
//           },
//         });
//       });
//     };

//     const onLoaded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { duration: isFinite(el.duration) ? el.duration : 0 },
//       });
//     };

//     const onEnded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { isPlaying: false, currentTime: 0 },
//       });
//     };

//     el.addEventListener("timeupdate", updateFromAudio);
//     el.addEventListener("loadedmetadata", onLoaded);
//     el.addEventListener("ended", onEnded);

//     return () => {
//       el.removeEventListener("timeupdate", updateFromAudio);
//       el.removeEventListener("loadedmetadata", onLoaded);
//       el.removeEventListener("ended", onEnded);
//     };
//   }, [editor, shape.id, shape.props.duration]);

//   const togglePlay = (e) => {
//     e.stopPropagation();
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { isPlaying: !shape.props.isPlaying },
//     });
//   };

//   const seek = (e) => {
//     e.stopPropagation();
//     const v = Number(e.target.value);
//     const el = audioRef.current;
//     if (el) el.currentTime = v;
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { currentTime: v },
//     });
//   };

//   const fmt = (s) => {
//     if (!isFinite(s) || s < 0) s = 0;
//     const m = Math.floor(s / 60);
//     const ss = Math.floor(s % 60)
//       .toString()
//       .padStart(2, "0");
//     return `${m}:${ss}`;
//   };

//   const styles = useMemo(
//     () => ({
//       wrapper: {
//         width: "100%",
//         height: "100%",
//         background: "#f3f4f6",
//         border: "1px solid #e5e7eb",
//         borderRadius: 8,
//         display: "flex",
//         alignItems: "center",
//         gap: 10,
//         padding: "8px 12px",
//         boxSizing: "border-box",
//         userSelect: "none",
//       },
//       play: {
//         width: 28,
//         height: 28,
//         borderRadius: "999px",
//         border: "1px solid #d1d5db",
//         background: "white",
//         display: "grid",
//         placeItems: "center",
//         cursor: "pointer",
//         flex: "0 0 auto",
//       },
//       title: {
//         fontSize: 12,
//         color: "#374151",
//         flex: "0 0 auto",
//         maxWidth: 120,
//         whiteSpace: "nowrap",
//         overflow: "hidden",
//         textOverflow: "ellipsis",
//       },
//       trackWrap: {
//         flex: 1,
//         display: "flex",
//         alignItems: "center",
//         gap: 8,
//       },
//       time: {
//         fontSize: 12,
//         color: "#6b7280",
//         minWidth: 38,
//         textAlign: "right",
//       },
//       range: {
//         flex: 1,
//         WebkitAppearance: "none",
//         height: 4,
//         borderRadius: 999,
//         background: "#e5e7eb",
//         outline: "none",
//       },
//       icon: { width: 0, height: 0, borderStyle: "solid" },
//     }),
//     []
//   );

//   return (
//     <HTMLContainer
//       style={{ width: shape.props.w, height: shape.props.h }}
//       onPointerDown={(e) => e.stopPropagation()}
//       onDoubleClick={(e) => e.stopPropagation()}
//     >
//       <div style={styles.wrapper}>
//         <audio ref={audioRef} src={shape.props.src} preload="metadata" />

//         <button
//           aria-label={shape.props.isPlaying ? "Pause" : "Play"}
//           style={styles.play}
//           onClick={togglePlay}
//         >
//           {shape.props.isPlaying ? (
//             <div style={{ display: "flex", gap: 3 }}>
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//             </div>
//           ) : (
//             <div
//               style={{
//                 ...styles.icon,
//                 borderWidth: "7px 0 7px 11px",
//                 borderColor: "transparent transparent transparent #111827",
//                 marginLeft: 2,
//               }}
//             />
//           )}
//         </button>

//         <div style={styles.title} title={shape.props.title}>
//           {shape.props.title}
//         </div>

//         <div style={styles.trackWrap}>
//           <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
//           <input
//             type="range"
//             min={0}
//             max={shape.props.duration || 0}
//             step="0.01"
//             value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
//             onChange={seek}
//             style={styles.range}
//           />
//           <div style={styles.time}>{fmt(shape.props.duration)}</div>
//         </div>
//       </div>
//     </HTMLContainer>
//   );
// }

////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////
////////////////////

// import React, { useEffect, useMemo, useRef } from "react";
// import { ShapeUtil, HTMLContainer, Rectangle2d, T, resizeBox } from "tldraw";

// export class AudioShapeUtil extends ShapeUtil {
//   static type = "audio-shape";
//   static props = {
//     w: T.number,
//     h: T.number,
//     src: T.string,
//     title: T.string,
//     isPlaying: T.boolean,
//     currentTime: T.number,
//     duration: T.number,
//   };

//   getDefaultProps() {
//     return {
//       w: 360,
//       h: 56,
//       src: "https://www2.cs.uic.edu/~i101/SoundFiles/StarWars60.wav", // demo
//       title: "Audio",
//       isPlaying: false,
//       currentTime: 0,
//       duration: 0,
//     };
//   }

//   canResize() {
//     return true;
//   }
//   canEdit() {
//     return false;
//   }
//   isAspectRatioLocked() {
//     return false;
//   }

//   getGeometry(shape) {
//     return new Rectangle2d({
//       width: shape.props.w,
//       height: shape.props.h,
//       isFilled: true,
//     });
//   }

//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   // ❗️No hooks here—delegate to a function component
//   component(shape) {
//     return <AudioShapeView util={this} shape={shape} />;
//   }

//   indicator(shape) {
//     return <rect rx={8} ry={8} width={shape.props.w} height={shape.props.h} />;
//   }
// }

// /** Function component where hooks are allowed */
// function AudioShapeView({ util, shape }) {
//   const editor = util.editor; // access the editor from the util (no useEditor hook needed)
//   const audioRef = useRef(null);
//   const rafRef = useRef(null);

//   // Play / pause when prop changes
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (shape.props.isPlaying) {
//       el.play().catch(() => {
//         /* autoplay may be blocked */
//       });
//     } else {
//       el.pause();
//     }
//     return () => {
//       if (rafRef.current) cancelAnimationFrame(rafRef.current);
//     };
//   }, [shape.props.isPlaying, shape.props.src]);

//   // Sync currentTime prop -> element
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;
//     if (
//       Math.abs((el.currentTime || 0) - (shape.props.currentTime || 0)) > 0.25
//     ) {
//       el.currentTime = shape.props.currentTime || 0;
//     }
//   }, [shape.props.currentTime]);

//   // Wire element events -> shape props
//   useEffect(() => {
//     const el = audioRef.current;
//     if (!el) return;

//     const updateFromAudio = () => {
//       rafRef.current = requestAnimationFrame(() => {
//         editor.updateShape({
//           id: shape.id,
//           type: AudioShapeUtil.type,
//           props: {
//             currentTime: el.currentTime || 0,
//             duration: isFinite(el.duration)
//               ? el.duration
//               : shape.props.duration || 0,
//           },
//         });
//       });
//     };

//     const onLoaded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { duration: isFinite(el.duration) ? el.duration : 0 },
//       });
//     };

//     const onEnded = () => {
//       editor.updateShape({
//         id: shape.id,
//         type: AudioShapeUtil.type,
//         props: { isPlaying: false, currentTime: 0 },
//       });
//     };

//     el.addEventListener("timeupdate", updateFromAudio);
//     el.addEventListener("loadedmetadata", onLoaded);
//     el.addEventListener("ended", onEnded);

//     return () => {
//       el.removeEventListener("timeupdate", updateFromAudio);
//       el.removeEventListener("loadedmetadata", onLoaded);
//       el.removeEventListener("ended", onEnded);
//     };
//   }, [editor, shape.id, shape.props.duration]);

//   const togglePlay = (e) => {
//     e.stopPropagation();
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { isPlaying: !shape.props.isPlaying },
//     });
//   };

//   const seek = (e) => {
//     e.stopPropagation();
//     const v = Number(e.target.value);
//     const el = audioRef.current;
//     if (el) el.currentTime = v;
//     editor.updateShape({
//       id: shape.id,
//       type: AudioShapeUtil.type,
//       props: { currentTime: v },
//     });
//   };

//   const fmt = (s) => {
//     if (!isFinite(s) || s < 0) s = 0;
//     const m = Math.floor(s / 60);
//     const ss = Math.floor(s % 60)
//       .toString()
//       .padStart(2, "0");
//     return `${m}:${ss}`;
//   };

//   const styles = useMemo(
//     () => ({
//       wrapper: {
//         width: "100%",
//         height: "100%",
//         background: "#f3f4f6",
//         border: "1px solid #e5e7eb",
//         borderRadius: 8,
//         display: "flex",
//         alignItems: "center",
//         gap: 10,
//         padding: "8px 12px",
//         boxSizing: "border-box",
//         userSelect: "none",
//       },
//       play: {
//         width: 28,
//         height: 28,
//         borderRadius: "999px",
//         border: "1px solid #d1d5db",
//         background: "white",
//         display: "grid",
//         placeItems: "center",
//         cursor: "pointer",
//         flex: "0 0 auto",
//       },
//       title: {
//         fontSize: 12,
//         color: "#374151",
//         flex: "0 0 auto",
//         maxWidth: 120,
//         whiteSpace: "nowrap",
//         overflow: "hidden",
//         textOverflow: "ellipsis",
//       },
//       trackWrap: {
//         flex: 1,
//         display: "flex",
//         alignItems: "center",
//         gap: 8,
//       },
//       time: {
//         fontSize: 12,
//         color: "#6b7280",
//         minWidth: 38,
//         textAlign: "right",
//       },
//       range: {
//         flex: 1,
//         WebkitAppearance: "none",
//         height: 4,
//         borderRadius: 999,
//         background: "#e5e7eb",
//         outline: "none",
//       },
//       icon: { width: 0, height: 0, borderStyle: "solid" },
//     }),
//     []
//   );

//   return (
//     <HTMLContainer
//       style={{ width: shape.props.w, height: shape.props.h }}
//       onPointerDown={(e) => e.stopPropagation()}
//       onDoubleClick={(e) => e.stopPropagation()}
//     >
//       <div style={styles.wrapper}>
//         <audio ref={audioRef} src={shape.props.src} preload="metadata" />

//         <button
//           aria-label={shape.props.isPlaying ? "Pause" : "Play"}
//           style={styles.play}
//           onClick={togglePlay}
//         >
//           {shape.props.isPlaying ? (
//             <div style={{ display: "flex", gap: 3 }}>
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//               <div style={{ width: 3, height: 12, background: "#111827" }} />
//             </div>
//           ) : (
//             <div
//               style={{
//                 ...styles.icon,
//                 borderWidth: "7px 0 7px 11px",
//                 borderColor: "transparent transparent transparent #111827",
//                 marginLeft: 2,
//               }}
//             />
//           )}
//         </button>

//         <div style={styles.title} title={shape.props.title}>
//           {shape.props.title}
//         </div>

//         <div style={styles.trackWrap}>
//           <div style={styles.time}>{fmt(shape.props.currentTime)}</div>
//           <input
//             type="range"
//             min={0}
//             max={shape.props.duration || 0}
//             step="0.01"
//             value={Math.min(shape.props.currentTime, shape.props.duration || 0)}
//             onChange={seek}
//             style={styles.range}
//           />
//           <div style={styles.time}>{fmt(shape.props.duration)}</div>
//         </div>
//       </div>
//     </HTMLContainer>
//   );
// }
// ------
// ------
// ------
// ------
// ------
// ------
// ------
// ------
// ------

// import {
//   HTMLContainer,
//   Rectangle2d,
//   ShapeUtil,
//   getDefaultColorTheme,
//   resizeBox,
//   T,
// } from "tldraw";

// export class AudioShapeUtil extends ShapeUtil {
//   static type = "audio";

//   // Define props
//   // static props = {
//   //   w: { type: "number", defaultValue: 300 },
//   //   h: { type: "number", defaultValue: 80 },
//   //   color: { type: "string", defaultValue: "black" },
//   //   audioUrl: { type: "string", defaultValue: "" },
//   // };

//   static props = {
//     w: T.number,
//     h: T.number,
//     // color: T.DefaultColorStyle,
//     url: T.string,
//   };

//   getDefaultProps() {
//     return {
//       w: 300,
//       h: 80,
//       // color: "black",
//       url: "",
//     };
//   }

//   getGeometry(shape) {
//     return new Rectangle2d({
//       width: shape.props.w,
//       height: shape.props.h,
//       isFilled: true,
//     });
//   }

//   component(shape) {
//     const theme = getDefaultColorTheme({
//       isDarkMode: this.editor.user.getIsDarkMode(),
//     });

//     return (
//       <HTMLContainer
//         id={shape.id}
//         style={{
//           border: "1px solid gray",
//           display: "flex",
//           flexDirection: "column",
//           alignItems: "center",
//           justifyContent: "center",
//           pointerEvents: "all",
//           backgroundColor: theme[shape.props.color]?.semi || "white",
//           width: shape.props.w,
//           height: shape.props.h,
//         }}
//       >
//         <audio controls src={shape.props.audioUrl} style={{ width: "90%" }} />
//       </HTMLContainer>
//     );
//   }

//   indicator(shape) {
//     return <rect width={shape.props.w} height={shape.props.h} />;
//   }

//   onResize(shape, info) {
//     return resizeBox(shape, info);
//   }

//   canResize() {
//     return true;
//   }

//   isAspectRatioLocked() {
//     return false;
//   }
// }

// export default AudioShapeUtil;

// // import { useState, useRef, useEffect } from "react";
// // import {
// //   HTMLContainer,
// //   Rectangle2d,
// //   ShapeUtil,
// //   getDefaultColorTheme,
// //   resizeBox,
// // } from "tldraw";
// // import { audioShapeMigrations } from "./AudioShapeMigration";
// // import { audioShapeProps } from "./AudioShapeProps";

// // export class AudioShapeUtil extends ShapeUtil {
// //   static type = "audio";
// //   static props = audioShapeProps;
// //   static migrations = audioShapeMigrations;

// //   isAspectRatioLocked(_shape) {
// //     return false;
// //   }

// //   canResize(_shape) {
// //     return true;
// //   }

// //   getDefaultProps() {
// //     return {
// //       w: 300,
// //       h: 120,
// //       color: "black",
// //       audioUrl: "",
// //       playing: false,
// //       currentTime: 0,
// //       volume: 1,
// //       duration: 0,
// //       name: "Audio Recording",
// //     };
// //   }

// //   getGeometry(shape) {
// //     return new Rectangle2d({
// //       width: shape.props.w,
// //       height: shape.props.h,
// //       isFilled: true,
// //     });
// //   }

// //   component(shape) {
// //     const theme = getDefaultColorTheme({
// //       isDarkMode: this.editor.user.getIsDarkMode(),
// //     });

// //     // eslint-disable-next-line react-hooks/rules-of-hooks
// //     const audioRef = useRef(null);
// //     // eslint-disable-next-line react-hooks/rules-of-hooks
// //     const [isPlaying, setIsPlaying] = useState(shape.props.playing || false);
// //     // eslint-disable-next-line react-hooks/rules-of-hooks
// //     const [currentTime, setCurrentTime] = useState(
// //       shape.props.currentTime || 0
// //     );
// //     // eslint-disable-next-line react-hooks/rules-of-hooks
// //     const [duration, setDuration] = useState(shape.props.duration || 0);

// //     // eslint-disable-next-line react-hooks/rules-of-hooks
// //     useEffect(() => {
// //       const audio = audioRef.current;
// //       if (!audio) return;

// //       const handleLoadedMetadata = () => {
// //         setDuration(audio.duration);
// //         // Update shape props with duration
// //         this.editor.updateShape({
// //           id: shape.id,
// //           type: "audio",
// //           props: {
// //             ...shape.props,
// //             duration: audio.duration,
// //           },
// //         });
// //       };

// //       const handleTimeUpdate = () => {
// //         setCurrentTime(audio.currentTime);
// //       };

// //       const handleEnded = () => {
// //         setIsPlaying(false);
// //         this.editor.updateShape({
// //           id: shape.id,
// //           type: "audio",
// //           props: {
// //             ...shape.props,
// //             playing: false,
// //           },
// //         });
// //       };

// //       const handlePlay = () => {
// //         setIsPlaying(true);
// //       };

// //       const handlePause = () => {
// //         setIsPlaying(false);
// //       };

// //       audio.addEventListener("loadedmetadata", handleLoadedMetadata);
// //       audio.addEventListener("timeupdate", handleTimeUpdate);
// //       audio.addEventListener("ended", handleEnded);
// //       audio.addEventListener("play", handlePlay);
// //       audio.addEventListener("pause", handlePause);

// //       return () => {
// //         audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
// //         audio.removeEventListener("timeupdate", handleTimeUpdate);
// //         audio.removeEventListener("ended", handleEnded);
// //         audio.removeEventListener("play", handlePlay);
// //         audio.removeEventListener("pause", handlePause);
// //       };
// //     }, [shape.id, shape.props]);

// //     const togglePlay = () => {
// //       const audio = audioRef.current;
// //       if (!audio) return;

// //       if (isPlaying) {
// //         audio.pause();
// //       } else {
// //         audio.play();
// //       }
// //     };

// //     const handleSeek = (e) => {
// //       e.stopPropagation();
// //       const audio = audioRef.current;
// //       if (!audio || !duration) return;

// //       const rect = e.currentTarget.getBoundingClientRect();
// //       const x = e.clientX - rect.left;
// //       const percentage = x / rect.width;
// //       const newTime = percentage * duration;

// //       audio.currentTime = newTime;
// //       setCurrentTime(newTime);
// //     };

// //     const formatTime = (time) => {
// //       const minutes = Math.floor(time / 60);
// //       const seconds = Math.floor(time % 60);
// //       return `${minutes}:${seconds.toString().padStart(2, "0")}`;
// //     };

// //     return (
// //       <HTMLContainer
// //         id={shape.id}
// //         style={{
// //           border: `2px solid ${theme[shape.props.color].solid}`,
// //           borderRadius: "8px",
// //           display: "flex",
// //           flexDirection: "column",
// //           padding: "12px",
// //           pointerEvents: "all",
// //           backgroundColor: theme[shape.props.color].semi,
// //           color: theme[shape.props.color].solid,
// //         }}
// //       >
// //         <audio
// //           ref={audioRef}
// //           src={shape.props.audioUrl}
// //           preload="metadata"
// //           style={{ display: "none" }}
// //         />

// //         {/* Audio Info */}
// //         <div
// //           style={{
// //             fontSize: "12px",
// //             marginBottom: "8px",
// //             fontWeight: "bold",
// //             overflow: "hidden",
// //             textOverflow: "ellipsis",
// //             whiteSpace: "nowrap",
// //           }}
// //         >
// //           🎵 {shape.props.name}
// //         </div>

// //         {/* Progress Bar */}
// //         <div
// //           style={{
// //             width: "100%",
// //             height: "6px",
// //             backgroundColor: "rgba(0,0,0,0.1)",
// //             borderRadius: "3px",
// //             cursor: "pointer",
// //             marginBottom: "12px",
// //             position: "relative",
// //           }}
// //           onClick={handleSeek}
// //           onPointerDown={(e) => e.stopPropagation()}
// //         >
// //           <div
// //             style={{
// //               width: `${duration ? (currentTime / duration) * 100 : 0}%`,
// //               height: "100%",
// //               backgroundColor: theme[shape.props.color].solid,
// //               borderRadius: "3px",
// //               transition: "width 0.1s ease",
// //             }}
// //           />
// //         </div>

// //         {/* Controls */}
// //         <div
// //           style={{
// //             display: "flex",
// //             alignItems: "center",
// //             justifyContent: "space-between",
// //             gap: "8px",
// //           }}
// //         >
// //           <button
// //             onClick={togglePlay}
// //             onPointerDown={(e) => e.stopPropagation()}
// //             style={{
// //               border: "none",
// //               backgroundColor: theme[shape.props.color].solid,
// //               color: theme[shape.props.color].semi,
// //               borderRadius: "50%",
// //               width: "36px",
// //               height: "36px",
// //               cursor: "pointer",
// //               display: "flex",
// //               alignItems: "center",
// //               justifyContent: "center",
// //               fontSize: "14px",
// //               fontWeight: "bold",
// //             }}
// //           >
// //             {isPlaying ? "⏸️" : "▶️"}
// //           </button>

// //           <div
// //             style={{
// //               fontSize: "11px",
// //               fontFamily: "monospace",
// //               minWidth: "80px",
// //               textAlign: "right",
// //             }}
// //           >
// //             {formatTime(currentTime)} / {formatTime(duration)}
// //           </div>
// //         </div>
// //       </HTMLContainer>
// //     );
// //   }

// //   indicator(shape) {
// //     return <rect width={shape.props.w} height={shape.props.h} />;
// //   }

// //   onResize(shape, info) {
// //     return resizeBox(shape, info);
// //   }

// //   // Handle double-click to toggle play/pause
// //   onDoubleClick(shape) {
// //     this.editor.updateShape({
// //       id: shape.id,
// //       type: "audio",
// //       props: {
// //         ...shape.props,
// //         playing: !shape.props.playing,
// //       },
// //     });
// //   }
// // }
