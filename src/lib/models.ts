/**
 * Which Claude model each AI feature uses.
 *
 * In order: the household's choice in Settings, then an env var, then the
 * default here. Only models on that feature's options are honoured.
 *
 * Capture, pick and photo reading force a tool call, which Opus 5.5 and
 * Sonnet 5.5 reject, so those three are offered the 5 generation. Finding
 * release days doesn't force one, so it gets the 5.5 models instead.
 *
 * Safe to import from client components: it reads env vars only when called.
 */
export const MODEL_OPTIONS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "fastest, cheapest" },
  { id: "claude-sonnet-5", label: "Sonnet 5", note: "middle ground" },
  { id: "claude-opus-5", label: "Opus 5", note: "most careful, slowest" },
] as const;

export const RELEASE_DAYS_MODEL_OPTIONS = [
  { id: "claude-haiku-5-5", label: "Haiku 5.5", note: "fastest, cheapest" },
  { id: "claude-sonnet-5-5", label: "Sonnet 5.5", note: "middle ground" },
  { id: "claude-opus-5-5", label: "Opus 5.5", note: "most careful, slowest" },
] as const;

export type ModelId =
  | (typeof MODEL_OPTIONS)[number]["id"]
  | (typeof RELEASE_DAYS_MODEL_OPTIONS)[number]["id"];

export type ModelFeature = "capture" | "pick" | "readPhoto" | "releaseDays";

type ModelOption = { id: ModelId; label: string; note: string };

/** The models Settings offers, and the server accepts, for a feature. */
export function modelOptionsFor(feature: ModelFeature): readonly ModelOption[] {
  return feature === "releaseDays" ? RELEASE_DAYS_MODEL_OPTIONS : MODEL_OPTIONS;
}

/** The households column that holds each feature's choice. */
export const MODEL_COLUMNS = {
  capture: "capture_model",
  pick: "pick_model",
  readPhoto: "read_photo_model",
  releaseDays: "release_days_model",
} as const satisfies Record<ModelFeature, string>;

export const DEFAULT_MODELS: Record<ModelFeature, ModelId> = {
  capture: "claude-haiku-5-5",
  pick: "claude-opus-5",
  readPhoto: "claude-opus-5",
  // Haiku was tried first and confirmed far fewer shows; worth the extra cost
  // on a button pressed now and then.
  releaseDays: "claude-opus-5-5",
};

const ENV_VARS: Record<ModelFeature, string> = {
  capture: "CLAUDE_CAPTURE_MODEL",
  pick: "CLAUDE_PICK_MODEL",
  readPhoto: "CLAUDE_READ_PHOTO_MODEL",
  releaseDays: "CLAUDE_RELEASE_DAYS_MODEL",
};

/** "Haiku 5.5" for "claude-haiku-5-5"; unknown ids come back as they are. */
export function modelLabel(id: string) {
  return (
    [...MODEL_OPTIONS, ...RELEASE_DAYS_MODEL_OPTIONS].find((option) => option.id === id)
      ?.label ?? id
  );
}

function allowed(feature: ModelFeature, value: unknown): value is ModelId {
  return modelOptionsFor(feature).some((option) => option.id === value);
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
  if (allowed(feature, chosen)) return chosen;

  const fromEnv = process.env[ENV_VARS[feature]]?.trim();
  if (allowed(feature, fromEnv)) return fromEnv;

  // Capture stays on its own default rather than following CLAUDE_MODEL: it
  // runs on everything said or typed, so speed and cost matter most there.
  const global = process.env.CLAUDE_MODEL?.trim();
  if (feature !== "capture" && allowed(feature, global)) return global;

  return DEFAULT_MODELS[feature];
}
