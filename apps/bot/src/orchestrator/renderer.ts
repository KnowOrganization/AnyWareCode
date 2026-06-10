import type { RunnerEvent } from "@anywherecode/shared";

const MAX_LINES = 14;
const MAX_MESSAGE_LENGTH = 3800; // headroom under Discord's 4096 embed limit

/**
 * Formats one event as a progress line, or null for events that aren't part
 * of the rolling progress display (assistant text and done get their own
 * messages).
 */
export function renderEventLine(event: RunnerEvent): string | null {
  switch (event.type) {
    case "plan":
      return `🧠 ${truncate(event.text, 200)}`;
    case "read_files":
      return `📂 Reading ${truncate(event.files.join(", "), 200)}`;
    case "edit_file":
      return `✏️ Editing ${truncate(event.file, 200)}`;
    case "bash":
      return `💻 \`${truncate(event.command.replaceAll("`", "'"), 180)}\``;
    case "tests":
      return `${event.passed ? "✅" : "❌"} ${truncate(event.summary, 200)}`;
    case "pushed":
      return `🔀 Pushed \`${event.branch}\``;
    case "error":
      return `⚠️ ${truncate(event.message, 300)}`;
    case "assistant_text":
    case "done":
      return null;
  }
}

/** Rolling window of progress lines rendered into a single Discord message. */
export class ProgressRenderer {
  private lines: string[] = [];

  add(event: RunnerEvent): boolean {
    const line = renderEventLine(event);
    if (line === null) return false;
    // Collapse consecutive reads into the latest one to cut message churn.
    const last = this.lines.at(-1);
    if (line.startsWith("📂") && last?.startsWith("📂")) {
      this.lines[this.lines.length - 1] = line;
    } else {
      this.lines.push(line);
    }
    if (this.lines.length > MAX_LINES) {
      this.lines.splice(0, this.lines.length - MAX_LINES);
    }
    return true;
  }

  render(): string {
    let text = this.lines.join("\n");
    while (text.length > MAX_MESSAGE_LENGTH && this.lines.length > 1) {
      this.lines.shift();
      text = this.lines.join("\n");
    }
    return text || "🧠 Starting…";
  }
}

/** Coalesces frequent updates into at most one call per interval. */
export class ThrottledUpdater {
  private timer: NodeJS.Timeout | null = null;
  private dirty = false;
  private inFlight = false;

  constructor(
    private update: () => Promise<void>,
    private intervalMs = 2000,
  ) {}

  schedule(): void {
    this.dirty = true;
    if (this.timer) return;
    this.timer = setTimeout(() => void this.flush(), this.intervalMs);
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty || this.inFlight) return;
    this.dirty = false;
    this.inFlight = true;
    try {
      await this.update();
    } catch {
      // Discord edit failures (rate limits, deleted message) are non-fatal.
    } finally {
      this.inFlight = false;
      if (this.dirty) this.schedule();
    }
  }
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
