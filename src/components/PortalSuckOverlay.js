import React, { useEffect, useState } from "react";

/**
 * Renders a single fly-into-the-portal animation. Fully decoupled from
 * tldraw — it just takes a pre-rendered image + a starting screen rect +
 * a target point, and animates a plain <img> from one to the other.
 *
 * Why an <img> clone instead of animating the real tldraw shape: tldraw
 * shapes are store-driven (position/rotation/scale live in the sync store,
 * not in local CSS), so animating "shrink and fly" on the real shape would
 * mean writing dozens of intermediate frames into the synced document —
 * visible to every collaborator, and fighting the sync engine the whole
 * way. A throwaway visual clone sidesteps all of that.
 *
 * `effect` shape:
 *   {
 *     id: string | number   // unique per trigger, used as the img `key`
 *     imgUrl: string        // object URL, e.g. from editor.getSvgString()
 *     startRect: { left, top, width, height }  // screen-space, from getBoundingClientRect()-style values
 *     target: { x, y }      // screen-space point to shrink into (portal center)
 *     duration?: number     // ms, default 480
 *   }
 */
export default function PortalSuckOverlay({ effect, onDone }) {
  const [phase, setPhase] = useState("start");

  useEffect(() => {
    if (!effect) return;
    setPhase("start");

    // Two rAFs: the first commits the "start" (pre-animation) styles to
    // the DOM, the second flips to "end" on the following frame so the
    // browser actually has a frame boundary to transition across. Doing
    // this in a single rAF sometimes gets batched with the initial paint
    // and the transition never visibly starts.
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => setPhase("end"));
    });

    const duration = effect.duration ?? 480;
    const timer = setTimeout(() => {
      onDone?.(effect.id);
    }, duration + 60);

    return () => {
      cancelAnimationFrame(raf1);
      if (raf2) cancelAnimationFrame(raf2);
      clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [effect?.id]);

  if (!effect) return null;

  const { imgUrl, startRect, target, duration = 480 } = effect;

  const centerX = startRect.left + startRect.width / 2;
  const centerY = startRect.top + startRect.height / 2;
  const dx = target.x - centerX;
  const dy = target.y - centerY;

  const isEnd = phase === "end";

  return (
    <img
      key={effect.id}
      src={imgUrl}
      alt=""
      style={{
        position: "fixed",
        left: startRect.left,
        top: startRect.top,
        width: startRect.width,
        height: startRect.height,
        transformOrigin: "center center",
        transform: isEnd
          ? `translate(${dx}px, ${dy}px) scale(0.04) rotate(380deg)`
          : "translate(0px, 0px) scale(1) rotate(0deg)",
        opacity: isEnd ? 0 : 1,
        filter: isEnd ? "blur(2px) saturate(1.4)" : "blur(0px)",
        transition: `transform ${duration}ms cubic-bezier(.61,-0.01,.87,.44), opacity ${duration}ms ease-in ${
          duration * 0.35
        }ms, filter ${duration}ms ease-in`,
        pointerEvents: "none",
        zIndex: 10130,
        borderRadius: 6,
        willChange: "transform, opacity, filter",
      }}
    />
  );
}
