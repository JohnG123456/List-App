/**
 * Which Claude model each AI feature uses.
 *
 * In order: the household's choice in Settings, then an env var, then the
 * default here. Only models on MODEL_OPTIONS are honoured, and every one of
 * them accepts what all three routes send (a forced tool_choice, an effort
 * level, images). Opus 5.5 and Sonnet 5.5 are left off deliberately: both
 * reject a forced tool_choice, so capture and pick would fail on them.
 *
 * Safe to import from client components: it reads env vars only when called.
 */
export const MODEL_OPTIONS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "fastest, cheapest" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "middle ground" },
  { id: "claude-opus-5", label: "Opus 5", note: "most careful, slowest" },
] as const;

export type ModelId = (typeof MODEL_OPTIONS)[number]["id"];

export type ModelFeature = "capture" | "pick" | "readPhoto";

/** The households column that holds each feature's choice. */
export const MODEL_COLUMNS = {
  capture: "capture_model",
  pick: "pick_model",
  readPhoto: "read_photo_model",
} as const satisfies Record<ModelFeature, string>;

export const DEFAULT_MODELS: Record<ModelFeature, ModelId> = {
  capture: "claude-haiku-5-5",
  pick: "claude-opus-5",
  readPhoto: "claude-opus-5",
};

const ENV_VARS: Record<ModelFeature, string> = {
  capture: "CLAUDE_CAPTURE_MODEL",
  pick: "CLAUDE_PICK_MODEL",
  readPhoto: "CLAUDE_READ_PHOTO_MODEL",
};

function allowed(value: unknown): value is ModelId {
  return MODEL_OPTIONS.some((option) => option.id === value);
}

/**
 * The model to call for a feature. `household` is the households row, or
 * whatever part of it was fetched; a missing column just means no choice yet.
 */
export function modelFor(
  feature: ModelFeature,
  household?: Record<string, unknown> | null
): ModelId {
  const chosen = household?.[MODEL_COLUMNS[feature]];
  if (allowed(chosen)) return chosen;

  const fromEnv = process.env[ENV_VARS[feature]]?.trim();
  if (allowed(fromEnv)) return fromEnv;

  // Capture stays on its own default rather than following CLAUDE_MODEL: it
  // runs on everything said or typed, so speed and cost matter most there.
  const global = process.env.CLAUDE_MODEL?.trim();
  if (feature !== "capture" && allowed(global)) return global;

  return DEFAULT_MODELS[feature];
}
