import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
} from "node:crypto";
import { eq } from "drizzle-orm";
import type { Config } from "../config.js";
import { schema, type Db } from "@anywherecode/db";

function deriveKey(secret: string): Buffer {
  return Buffer.from(
    hkdfSync(
      "sha256",
      Buffer.from(secret, "utf8"),
      "anywherecode",
      "credential-encryption-v1",
      32,
    ),
  );
}

export function encryptCredential(
  secret: string,
  guildId: string,
  plaintext: string,
): string {
  const key = deriveKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  cipher.setAAD(Buffer.from(guildId, "utf8"));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1.${iv.toString("base64url")}.${ct.toString("base64url")}.${tag.toString("base64url")}`;
}

export function decryptCredential(
  secret: string,
  guildId: string,
  blob: string,
): string | null {
  try {
    const parts = blob.split(".");
    if (parts[0] !== "v1" || parts.length !== 4) return null;
    const [, ivB64, ctB64, tagB64] = parts as [string, string, string, string];
    const key = deriveKey(secret);
    const iv = Buffer.from(ivB64, "base64url");
    const ct = Buffer.from(ctB64, "base64url");
    const tag = Buffer.from(tagB64, "base64url");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAAD(Buffer.from(guildId, "utf8"));
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString(
      "utf8",
    );
  } catch {
    return null;
  }
}

export type LlmAuth =
  | { type: "anthropic_api_key"; token: string }
  | { type: "claude_oauth"; token: string }
  | { type: "custom"; token: string; baseUrl: string; model: string };

export type ResolvedLlmAuth =
  | { auth: LlmAuth; source: "guild" | "platform" }
  | { auth: null; reason: string };

export async function resolveLlmAuth(
  db: Db,
  config: Config,
  guildId: string,
): Promise<ResolvedLlmAuth> {
  const guild = await db.query.guilds.findFirst({
    where: eq(schema.guilds.id, guildId),
  });

  if (guild?.llmProviderType && guild.llmCredentialEnc) {
    const token = decryptCredential(
      config.CREDENTIAL_SECRET,
      guildId,
      guild.llmCredentialEnc,
    );
    if (!token) {
      return {
        auth: null,
        reason:
          "Stored credential unreadable — admin must run `/connect llm` again (key may have rotated).",
      };
    }
    if (guild.llmProviderType === "custom") {
      if (!guild.llmBaseUrl || !guild.llmModel) {
        return {
          auth: null,
          reason:
            "Custom provider config incomplete — admin must run `/connect llm` again.",
        };
      }
      return {
        auth: {
          type: "custom",
          token,
          baseUrl: guild.llmBaseUrl,
          model: guild.llmModel,
        },
        source: "guild",
      };
    }
    if (
      guild.llmProviderType === "claude_oauth" ||
      guild.llmProviderType === "anthropic_api_key"
    ) {
      return {
        auth: { type: guild.llmProviderType, token },
        source: "guild",
      };
    }
  }

  if (config.ANTHROPIC_API_KEY) {
    return {
      auth: { type: "anthropic_api_key", token: config.ANTHROPIC_API_KEY },
      source: "platform",
    };
  }

  return { auth: null, reason: "No LLM connected. Admin: run `/connect llm`." };
}

export async function validateLlmAuth(
  auth: LlmAuth,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { url, headers } = buildAnthropicHeaders(auth);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { ...headers, "content-type": "application/json" },
      body: JSON.stringify({
        model:
          auth.type === "custom" ? auth.model : "claude-haiku-4-5-20251001",
        max_tokens: 1,
        messages: [{ role: "user", content: "hi" }],
      }),
    });
    if (res.status === 401 || res.status === 403) {
      return {
        ok: false,
        reason: "Authentication failed (401/403). Check your credential.",
      };
    }
    // 400 = params error but auth passed; 200 = full success
    if (res.status === 200 || res.status === 400) return { ok: true };
    const body = await res.text().catch(() => "");
    return {
      ok: false,
      reason: `Unexpected status ${res.status}. ${body.slice(0, 200)}`,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `Connection failed: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

/** Messages-API endpoint + auth headers for each provider type. Single source
 * for the three auth shapes; used by credential probes and the chat classifier. */
export function buildAnthropicHeaders(auth: LlmAuth): {
  url: string;
  headers: Record<string, string>;
} {
  switch (auth.type) {
    case "anthropic_api_key":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          "x-api-key": auth.token,
          "anthropic-version": "2023-06-01",
        },
      };
    case "claude_oauth":
      return {
        url: "https://api.anthropic.com/v1/messages",
        headers: {
          authorization: `Bearer ${auth.token}`,
          "anthropic-version": "2023-06-01",
          "anthropic-beta": "oauth-2025-04-20",
        },
      };
    case "custom":
      return {
        url: `${auth.baseUrl.replace(/\/$/, "")}/v1/messages`,
        headers: {
          authorization: `Bearer ${auth.token}`,
          "anthropic-version": "2023-06-01",
        },
      };
  }
}

const AUTH_ERROR_RE =
  /\b(401|403|authentication_error|invalid.*(key|token)|unauthorized)\b/i;

export function isAuthError(message: string): boolean {
  return AUTH_ERROR_RE.test(message);
}
