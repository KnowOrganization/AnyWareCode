/**
 * Mutable bridge between GSAP ScrollTrigger (writes) and the R3F frame loop
 * (reads). Plain object on purpose — no React state, no re-renders, read every
 * frame inside useFrame.
 */
export const scrollFx = {
  /** 0..1 progress through the whole document scroll. */
  progress: 0,
  /** ScrollTrigger velocity (px/s, signed). */
  velocity: 0,
  /** Normalized window pointer, -1..1 (y up). */
  pointerX: 0,
  pointerY: 0,
};
