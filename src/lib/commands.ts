import type { Item, List } from "@/lib/types";

/**
 * The few things worth recognising in the browser, before anything reaches
 * Claude.
 *
 * Two reasons, and the second is the important one. Ticking an item off is the
 * command you use most, standing in an aisle with your hands full, and a round
 * trip makes it feel broken. And a supermarket dead spot would leave that round
 * trip hanging forever, so the command that matters most in a shop is the one
 * that must not need the network.
 *
 * Anything not confidently recognised here returns null and goes to Claude, so
 * this is a fast path rather than a parser. Being wrong is worse than being
 * slow: a tick only matches when exactly one open item fits.
 */

export type LocalCommand =
  | { type: "tick"; item: Item }
  | { type: "switch"; group: string }
  | { type: "read"; group: string | null };

/** Lowercase, no punctuation, no double spaces, no leading article. */
function normalise(text: string) {
  return text
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(the|a|an|some|my|our)\s+/, "");
}

// Ways of saying a thing is dealt with. Generous on purpose: a phrase only
// ticks something if it also names an item already on a list, so "got milk"
// ticks the milk when it is there and falls through to Claude when it isn't.
const TICK_PREFIXES = [
  "tick off",
  "ticked off",
  "tick",
  "cross off",
  "crossed off",
  "cross out",
  "check off",
  "checked off",
  "got the",
  "got",
  "ive got",
  "weve got",
  "i got",
  "we got",
  "picked up",
  "pick up",
  "grabbed",
  "bought",
  "done with",
  "finished with",
  "finished",
  "we finished",
];

const READ_PREFIXES = [
  "read me the",
  "read me",
  "read out the",
  "read out",
  "read the",
  "read aloud the",
  "read aloud",
  "read",
];

const SWITCH_PREFIXES = [
  "open the",
  "open",
  "show me the",
  "show me",
  "show the",
  "show",
  "go to the",
  "go to",
  "switch to the",
  "switch to",
];

/** Strips a leading phrase from a list, longest first, or returns null. */
function afterPrefix(text: string, prefixes: string[]) {
  const sorted = [...prefixes].sort((a, b) => b.length - a.length);
  for (const prefix of sorted) {
    if (text === prefix) return "";
    if (text.startsWith(`${prefix} `)) return text.slice(prefix.length + 1).trim();
  }
  return null;
}

/**
 * Crude singular form, so "the grocery list" finds the group called
 * "Groceries". Only the two endings that actually come up in list names.
 */
function stem(phrase: string) {
  return phrase
    .split(" ")
    .map((word) =>
      word.endsWith("ies")
        ? `${word.slice(0, -3)}y`
        : word.endsWith("s") && !word.endsWith("ss")
          ? word.slice(0, -1)
          : word
    )
    .join(" ");
}

/** Whole-word containment, so "milk" matches "milk" but "ilk" doesn't. */
function containsPhrase(haystack: string, needle: string) {
  if (!needle) return false;
  return ` ${haystack} `.includes(` ${needle} `);
}

function matchGroup(phrase: string, groups: string[]) {
  const cleaned = normalise(phrase).replace(/\s+list$/, "").trim();
  if (!cleaned) return null;

  const exact = groups.find((g) => normalise(g) === cleaned);
  if (exact) return exact;

  const wanted = stem(cleaned);
  const partial = groups.filter((g) => {
    const name = stem(normalise(g));
    return name === wanted || containsPhrase(name, wanted) || containsPhrase(wanted, name);
  });
  return partial.length === 1 ? partial[0] : null;
}

export function matchLocalCommand(
  raw: string,
  context: { items: Item[]; lists: List[]; groups: string[] }
): LocalCommand | null {
  const text = normalise(raw);
  if (!text) return null;

  // Read comes first: "read me the grocery list" also looks like a switch.
  const readPhrase = afterPrefix(text, READ_PREFIXES);
  if (readPhrase !== null) {
    if (!readPhrase || readPhrase === "list" || readPhrase === "it out") {
      return { type: "read", group: null };
    }
    const group = matchGroup(readPhrase, context.groups);
    if (group) return { type: "read", group };
    return null;
  }

  const tickPhrase = afterPrefix(text, TICK_PREFIXES);
  if (tickPhrase) {
    const wanted = normalise(tickPhrase);
    const open = context.items.filter((i) => !i.done && !i.archived_at);

    // Exact wording wins outright; otherwise the phrase has to sit inside
    // exactly one item, so "got the milk" never ticks two different milks.
    const exact = open.filter((i) => normalise(i.text) === wanted);
    const candidates =
      exact.length > 0
        ? exact
        : open.filter((i) => containsPhrase(normalise(i.text), wanted));

    if (candidates.length === 1) return { type: "tick", item: candidates[0] };
    return null;
  }

  const switchPhrase = afterPrefix(text, SWITCH_PREFIXES);
  if (switchPhrase) {
    const group = matchGroup(switchPhrase, context.groups);
    if (group) return { type: "switch", group };
  }

  return null;
}
