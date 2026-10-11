/**
 * Which Claude model each route uses, overridable per deployment.
 *
 * A route-specific variable wins; otherwise CLAUDE_MODEL sets the default for
 * the other routes. Capture ignores CLAUDE_MODEL and defaults to Haiku: it runs
 * on every thing said or typed, so latency and cost matter most there.
 */
const DEFAULT_MODEL = "claude-opus-5";

function pick(routeVar: string | undefined, fallback: string) {
  return routeVar?.trim() || process.env.CLAUDE_MODEL?.trim() || fallback;
}

export const models = {
  capture: () => process.env.CLAUDE_CAPTURE_MODEL?.trim() || "claude-haiku-5-5",
  pick: () => pick(process.env.CLAUDE_PICK_MODEL, DEFAULT_MODEL),
  readPhoto: () => pick(process.env.CLAUDE_READ_PHOTO_MODEL, DEFAULT_MODEL),
};
