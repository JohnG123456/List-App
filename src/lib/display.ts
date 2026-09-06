import type { Household, Item, List, Member } from "@/lib/types";

/** "Ours" becomes "Ours'", not "Ours's". Profile names are often plural. */
export function possessive(name: string) {
  return /s$/i.test(name) ? `${name}\u2019` : `${name}\u2019s`;
}

export function formatTimestamp(iso: string) {
  const date = new Date(iso);
  const day = date.getDate();
  const month = date.toLocaleString(undefined, { month: "short" });
  const hours24 = date.getHours();
  const minutes = date.getMinutes().toString().padStart(2, "0");
  const ampm = hours24 >= 12 ? "pm" : "am";
  const hours = hours24 % 12 || 12;
  return `${day} ${month} at ${hours}:${minutes} ${ampm}`;
}

export function initialsFromEmail(email: string) {
  const local = email.split("@")[0];
  const parts = local.split(/[.\-_]+/).filter(Boolean);
  const initials =
    parts.length >= 2 ? parts[0][0] + parts[1][0] : local.slice(0, 2);
  return initials.toUpperCase();
}

/** The initials to show against an item, or null if we have nothing to show. */
export function initialsFor(
  userId: string | null,
  members: Member[],
  fallbackEmails: Record<string, string>
) {
  if (!userId) return null;
  const member = members.find((m) => m.user_id === userId);
  if (member?.initials) return member.initials.toUpperCase();
  const email = fallbackEmails[userId];
  return email ? initialsFromEmail(email) : null;
}

/** A snoozed item is out of sight and out of the count until its time comes. */
export function isSnoozed(item: Item, now = Date.now()) {
  return item.hidden_until !== null && new Date(item.hidden_until).getTime() > now;
}

/** Items that count as "open" on a list: not done, not snoozed, not archived. */
export function openItems(items: Item[], listId: string) {
  return items.filter(
    (i) => i.list_id === listId && !i.done && !i.archived_at && !isSnoozed(i)
  );
}

export function listsInGroup(lists: List[], groupName: string) {
  return lists
    .filter((l) => l.group_name === groupName)
    .sort((a, b) => a.position - b.position);
}

/** Pill labels, in list order, each appearing once. */
export function groupNames(lists: List[]) {
  const seen: string[] = [];
  for (const list of [...lists].sort((a, b) => a.position - b.position)) {
    if (!seen.includes(list.group_name)) seen.push(list.group_name);
  }
  return seen;
}

export type ItemGroup = { heading: string | null; items: Item[] };

/** Local date as YYYY-MM-DD, so "today" means today here, not in UTC. */
export function localDateKey(date = new Date()) {
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function addDays(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return localDateKey(date);
}

/**
 * Which bucket a due date falls in. Anything overdue joins today rather than
 * getting its own section: it is still a thing to do now, and a list with a
 * permanent "Overdue" heading is a list you stop reading.
 */
export function dueBucket(due: string | null, today = localDateKey()) {
  if (!due) return "Whenever";
  if (due <= today) return "Today";
  if (due <= addDays(7)) return "This week";
  return "Later";
}

const DUE_ORDER = ["Today", "This week", "Later", "Whenever"];

/**
 * Arranges a list's items the way that list is configured to arrange them:
 * by streaming service, by supermarket aisle, or not at all. Anything with no
 * value for the grouping field collects in its own bucket at the end, so a
 * missing service reads as a visible loose end rather than a silent gap.
 */
export function groupItems(
  list: List,
  items: Item[],
  household: Household | null
): ItemGroup[] {
  if (!list.group_by) return [{ heading: null, items }];

  if (list.group_by === "due") {
    const buckets = new Map<string, Item[]>();
    for (const item of items) {
      const key = dueBucket(item.due_on);
      const bucket = buckets.get(key);
      if (bucket) bucket.push(item);
      else buckets.set(key, [item]);
    }
    return DUE_ORDER.filter((heading) => buckets.has(heading)).map((heading) => ({
      // A list where everything is undated needs no headings at all.
      heading: buckets.size === 1 && heading === "Whenever" ? null : heading,
      items: buckets
        .get(heading)!
        .sort((a, b) => (a.due_on ?? "9999").localeCompare(b.due_on ?? "9999")),
    }));
  }

  const field = list.group_by === "service" ? "service" : "aisle";
  const unknownHeading =
    list.group_by === "service" ? "Service unknown" : "Not sorted yet";

  const buckets = new Map<string, Item[]>();
  for (const item of items) {
    const key = (item[field] as string | null) || unknownHeading;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(item);
    else buckets.set(key, [item]);
  }

  const preferred =
    list.group_by === "aisle" ? household?.aisle_order ?? [] : household?.services ?? [];

  const headings = [...buckets.keys()].sort((a, b) => {
    if (a === unknownHeading) return 1;
    if (b === unknownHeading) return -1;
    const ai = preferred.indexOf(a);
    const bi = preferred.indexOf(b);
    if (ai === -1 && bi === -1) return a.localeCompare(b);
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });

  return headings.map((heading) => ({ heading, items: buckets.get(heading)! }));
}

/**
 * Bumps "S2 E4" to "S2 E5" for the one-tap case of finishing an episode.
 * Anything it can't read confidently is left exactly as it was, since a wrong
 * episode number is worse than an unchanged one.
 */
export function bumpEpisode(progress: string | null) {
  if (!progress || !progress.trim()) return "S1 E1";

  // The separator is captured so "Episode 3" doesn't come back as "Episode4".
  const episode = progress.match(/^(.*[Ee])(\s*)(\d+)\s*$/);
  if (episode) return `${episode[1]}${episode[2]}${Number(episode[3]) + 1}`;

  return progress;
}

/**
 * Answers "have we watched this?" from the lists themselves, with no round
 * trip. The useful part of the answer is the service and whose profile it was
 * on, which is exactly what the streaming apps can't tell you.
 */
export function watchVerdict(query: string, items: Item[], lists: List[]) {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length < 2) return null;

  const watchLists = lists.filter((l) => l.kind === "watch");
  const watchListIds = new Set(watchLists.map((l) => l.id));

  const matches = items.filter(
    (i) => watchListIds.has(i.list_id) && i.text.toLowerCase().includes(trimmed)
  );

  if (matches.length === 0) {
    return {
      found: false,
      text:
        `No match. Nothing on your TV lists is called that, so if you did watch ` +
        `it, it was before this list existed.`,
    };
  }

  const match = matches[0];
  const list = watchLists.find((l) => l.id === match.list_id)!;
  const where = [match.service, match.profile ? `${possessive(match.profile)} profile` : null]
    .filter(Boolean)
    .join(", ");

  if (list.is_archive) {
    return {
      found: true,
      text: `Yes. You finished ${match.text}${where ? ` on ${where}` : ""}.`,
    };
  }

  if (list.promote_to) {
    return {
      found: true,
      text:
        `Not yet. ${match.text} is on ${list.name}` +
        `${match.service ? `, on ${match.service}` : ", service not set yet"}.`,
    };
  }

  return {
    found: true,
    text:
      `Part way. ${match.text} is up to ${match.progress ?? "somewhere"}` +
      `${where ? ` on ${where}` : ""}.`,
  };
}
