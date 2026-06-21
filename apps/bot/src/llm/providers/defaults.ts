/**
 * Default-model resolution and the single effective-model rule
 * (multi-provider-model-switching).
 *
 * `guilds.llmModel` is the Selected_Model for every provider type. When a guild
 * has not chosen one, the provider type's Default_Model is used instead. Both
 * the Chat_Path, Task_Path, credential validation, and status output compute
 * the effective model through the one `effectiveModel` rule defined here, so the
 * resolution is identical everywhere (design "Default model resolution" and
 * "Effective model" sections; Req 5.4).
 *
 * This module is pure: no network, filesystem, or other I/O.
 */

import type { Config } from "../../config.js";
import type { LlmAuth } from "../credentials.js";

/**
 * Every configurable provider type. This is a forward-compatible superset of
 * the current `LlmAuth["type"]` union: the `openai`/`openrouter` members are
 * named here ahead of being added to the `LlmAuth` union, and the union
 * dedupes to the same set once they are. Keeping the type here lets
 * `defaultModelFor` switch over the full provider set without a downstream
 * dependency on the `LlmAuth` refactor landing first.
 */
export type ProviderType = LlmAuth["type"] | "openai" | "openrouter";

/**
 * The Default_Model for a provider type, used when a guild has no Selected_Model:
 * - `openai`     → `OPENAI_DEFAULT_MODEL`
 * - `openrouter` → `OPENROUTER_DEFAULT_MODEL`
 * - `custom`     → the row's stored model (custom rows always populate
 *   `llmModel`, so the effective-model rule returns it before this fallback is
 *   reached; `DEFAULT_MODEL` is the safe last resort when no row model exists)
 * - Anthropic    → `DEFAULT_MODEL`
 */
export function defaultModelFor(type: ProviderType, cfg: Config): string {
	switch (type) {
		case "openai":
			return cfg.OPENAI_DEFAULT_MODEL;
		case "openrouter":
			return cfg.OPENROUTER_DEFAULT_MODEL;
		case "custom":
			// Custom rows always store their own model, so the effective-model
			// rule returns the stored value before reaching this branch. When no
			// stored model is present, fall back to the Anthropic default.
			return cfg.DEFAULT_MODEL;
		default:
			return cfg.DEFAULT_MODEL;
	}
}

/**
 * The single effective-model rule shared by every path:
 *
 *   effectiveModel = (storedModel?.trim() || null) ?? defaultModelFor(type)
 *
 * i.e. the stored Selected_Model trimmed of surrounding whitespace when that
 * trimmed value is non-empty, and the provider type's Default_Model otherwise.
 *
 * Callers pass the relevant fields from either a guild row
 * (`guild.llmProviderType`, `guild.llmModel`) or a resolved `LlmAuth`
 * (`auth.type`, `auth.model`), so the rule has one definition (Req 5.4).
 */
export function effectiveModel(
	type: ProviderType,
	storedModel: string | null | undefined,
	cfg: Config,
): string {
	const trimmed = storedModel?.trim();
	return trimmed && trimmed.length > 0 ? trimmed : defaultModelFor(type, cfg);
}
