/**
 * Tiny coordination point between the Preloader and entrance animations.
 * The Preloader calls `holdIntro()` before any fx builds (it is the first
 * child on the page, so its layout effect runs first); entrance fx ask
 * `introHeld()` and defer building their tweens via `whenIntroDone()` so the
 * hero choreography plays as the curtain lifts instead of underneath it.
 *
 * Pages that never mount a Preloader (dashboard, legal) never hold, so fx
 * build immediately. A safety timer auto-releases in case the preloader
 * timeline is interrupted — content must never stay hidden.
 */

type Listener = () => void;

let held = false;
let listeners: Listener[] = [];
let safety: ReturnType<typeof setTimeout> | null = null;

export function holdIntro(): void {
  held = true;
  safety ??= setTimeout(releaseIntro, 5000);
}

export function releaseIntro(): void {
  held = false;
  if (safety) {
    clearTimeout(safety);
    safety = null;
  }
  const pending = listeners;
  listeners = [];
  for (const fn of pending) fn();
}

export function introHeld(): boolean {
  return held;
}

/** Run `fn` now, or as soon as the intro releases. */
export function whenIntroDone(fn: Listener): void {
  if (!held) fn();
  else listeners.push(fn);
}
