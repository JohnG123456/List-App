import type { Item, List } from "@/lib/types";
import { dueBucket, isSnoozed } from "@/lib/display";

/**
 * The morning email: what is actually due today, then how much else is waiting.
 *
 * Deliberately not the whole list. An email that reprints everything gets
 * skimmed once and filtered forever after, so this leads with the handful of
 * things that are due and reduces the rest to a count you can act on or ignore.
 */

export type Digest = { subject: string; text: string; html: string } | null;

function escapeHtml(text: string) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The trailing detail that makes a line useful: "2L", "Netflix, S2 E4". */
function detailFor(item: Item) {
  const bits = [item.qty, item.service, item.progress].filter(Boolean);
  return bits.length ? ` (${bits.join(", ")})` : "";
}

export function buildDigest(lists: List[], items: Item[], greeting: string): Digest {
  const usable = lists.filter((l) => !l.is_archive);
  const listById = new Map(usable.map((l) => [l.id, l]));

  const open = items.filter(
    (i) =>
      listById.has(i.list_id) && !i.done && !i.archived_at && !isSnoozed(i)
  );

  const dueToday = open.filter((i) => i.due_on && dueBucket(i.due_on) === "Today");

  const waiting = usable
    .map((list) => ({
      list,
      count: open.filter((i) => i.list_id === list.id && !dueToday.includes(i)).length,
    }))
    .filter((row) => row.count > 0);

  // Nothing due and nothing waiting means no email at all. A daily message
  // that says "nothing to report" is the fastest way to train someone to
  // ignore the ones that matter.
  if (dueToday.length === 0 && waiting.length === 0) return null;

  const subject =
    dueToday.length > 0
      ? `${dueToday.length} for today`
      : "Nothing due today";

  const textParts: string[] = [greeting, ""];
  const htmlParts: string[] = [`<p>${escapeHtml(greeting)}</p>`];

  if (dueToday.length > 0) {
    textParts.push("Due today");
    textParts.push(
      ...dueToday.map((i) => {
        const list = listById.get(i.list_id);
        return `  - ${i.text}${detailFor(i)}${list ? ` [${list.name}]` : ""}`;
      })
    );
    textParts.push("");

    htmlParts.push("<h3>Due today</h3><ul>");
    htmlParts.push(
      ...dueToday.map((i) => {
        const list = listById.get(i.list_id);
        return `<li>${escapeHtml(i.text + detailFor(i))}${
          list ? ` <small>${escapeHtml(list.name)}</small>` : ""
        }</li>`;
      })
    );
    htmlParts.push("</ul>");
  }

  if (waiting.length > 0) {
    textParts.push("Also waiting");
    textParts.push(...waiting.map((r) => `  ${r.list.name}: ${r.count}`));

    htmlParts.push("<h3>Also waiting</h3><ul>");
    htmlParts.push(
      ...waiting.map(
        (r) => `<li>${escapeHtml(r.list.name)}: ${r.count}</li>`
      )
    );
    htmlParts.push("</ul>");
  }

  return {
    subject,
    text: textParts.join("\n"),
    html: htmlParts.join(""),
  };
}
