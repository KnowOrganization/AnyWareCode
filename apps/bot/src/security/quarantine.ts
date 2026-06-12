/**
 * Untrusted-content quarantine — the injection-hardening layer ("designed
 * after Comment and Control"). External text (issues, PR bodies, transcripts)
 * passes through here before any prompt is built from it:
 *
 *  1. sanitizeUntrusted strips the carriers of hidden instructions — HTML
 *     comments and invisible Unicode — that render as nothing to humans but
 *     read as text to a model.
 *  2. detectInjection flags instruction-shaped content so the humans deciding
 *     whether to run a proposal see "⚠️ hidden instruction-like content"
 *     before they click.
 *
 * Pure functions; the defense is layered (untrusted framing in prompts,
 * read-only ask tokens, human-actor validation) — this is the first pass,
 * not the whole wall.
 */

const HTML_COMMENT = /<!--[\s\S]*?(?:-->|$)/g;

// Zero-width and invisible code points commonly used to hide payloads:
// ZWSP..RTL marks (U+200B-200F), word-joiner block (U+2060-2064), BOM, soft
// hyphen, and the Unicode "tags" block (U+E0000-E007F, the surrogate pair
// DB40 DC00-DC7F) used for ASCII-invisible smuggling.
const INVISIBLE =
  /[\u200B-\u200F\u2060-\u2064\uFEFF\u00AD]|\uDB40[\uDC00-\uDC7F]/g;

export interface SanitizeResult {
  text: string;
  /** True when hidden content was removed (itself an injection signal). */
  stripped: boolean;
}

export function sanitizeUntrusted(raw: string): SanitizeResult {
  const withoutComments = raw.replace(HTML_COMMENT, " ");
  const withoutInvisible = withoutComments.replace(INVISIBLE, "");
  const text = withoutInvisible.replace(/[ \t]{3,}/g, "  ").trim();
  return {
    text,
    stripped:
      withoutComments !== raw || withoutInvisible !== withoutComments,
  };
}

const INJECTION_PATTERNS: Array<{ re: RegExp; flag: string }> = [
  {
    re: /ignore\s+(?:all|any|the|previous|prior|above|earlier)\s+(?:\w+\s+)?(?:instructions|prompts|rules|context)/i,
    flag: "instruction-override",
  },
  {
    re: /disregard\s+(?:all|any|the|previous|prior|above|your)\s+(?:\w+\s+)?(?:instructions|rules|guidelines)/i,
    flag: "instruction-override",
  },
  { re: /you\s+are\s+now\s+(?:a|an|in|the)\b/i, flag: "role-reassignment" },
  { re: /\bsystem\s*prompt\b/i, flag: "system-prompt-reference" },
  {
    re: /\bjailbreak\b|\bDAN\s+mode\b|developer\s+mode\s+enabled/i,
    flag: "jailbreak-marker",
  },
  {
    re: /do\s+not\s+(?:tell|mention|reveal|disclose|inform)\s+(?:the\s+)?(?:user|anyone|them|humans?)/i,
    flag: "concealment-instruction",
  },
  {
    re: /(?:run|execute|eval)\s+the\s+following\s+(?:command|code|script)\s+(?:as|with|silently|immediately)/i,
    flag: "covert-execution",
  },
  {
    re: /\b(?:exfiltrate|leak|send|post|upload)\b[^.\n]{0,60}\b(?:secrets?|tokens?|credentials?|env|api[\s_-]?keys?)/i,
    flag: "exfiltration-instruction",
  },
  { re: /<\s*(?:system|assistant)\s*>/i, flag: "fake-chat-markup" },
];

/**
 * Heuristic injection scan. Runs on the RAW text (pre-sanitize) so content
 * hidden in comments/invisible chars is caught; marks patterns that were
 * ONLY visible before stripping as `hidden:*` (stronger signal), and any
 * stripped carrier as `hidden-content`.
 */
export function detectInjection(raw: string): string[] {
  const flags = new Set<string>();
  for (const { re, flag } of INJECTION_PATTERNS) {
    if (re.test(raw)) flags.add(flag);
  }
  const { text, stripped } = sanitizeUntrusted(raw);
  if (stripped) {
    flags.add("hidden-content");
    for (const { re, flag } of INJECTION_PATTERNS) {
      if (re.test(raw) && !re.test(text)) flags.add(`hidden:${flag}`);
    }
  }
  return [...flags];
}

/** One-call helper for ingestion points: clean text + audit flags. */
export function quarantine(raw: string): { text: string; flags: string[] } {
  return { text: sanitizeUntrusted(raw).text, flags: detectInjection(raw) };
}
