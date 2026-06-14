import { existsSync, readdirSync } from "node:fs";
import path from "node:path";

/**
 * Shallow game-engine detection at the repo root. Single source of truth for
 * both the agent (injects GAME_PROMPT) and verify (skips JS/TS checks), so the
 * two can't diverge on what counts as a game project (e.g. Unreal `.uproject`).
 */
export function detectGameEngine(workdir: string): boolean {
  if (existsSync(path.join(workdir, "project.godot"))) return true;
  if (existsSync(path.join(workdir, "ProjectSettings", "ProjectVersion.txt")))
    return true;
  try {
    return readdirSync(workdir).some((f) => f.endsWith(".uproject"));
  } catch {
    return false;
  }
}
