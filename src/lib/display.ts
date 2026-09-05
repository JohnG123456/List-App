import type { Household, Item, List, Member } from "@/lib/types";

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
