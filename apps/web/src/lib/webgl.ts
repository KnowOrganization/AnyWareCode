let cached: boolean | null = null;

/** One-time WebGL capability probe (client only). */
export function webglOk(): boolean {
  if (cached !== null) return cached;
  try {
    const c = document.createElement("canvas");
    cached = Boolean(
      c.getContext("webgl2") ?? c.getContext("webgl"),
    );
  } catch {
    cached = false;
  }
  return cached;
}
