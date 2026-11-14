import type { Item, List } from "@/lib/types";
import { canRecommend } from "@/lib/display";

/**
 * What the Share sheet can send: the pill on screen, or a slice of the TV
 * lists (recommended, watched together, one person's own).
 *
 * The text for friends deliberately leaves out everything that's only
 * meaningful at home: who added it, episode progress, whose profile, and
 * anything on Didn't like.
 */

export type ShareChoice = {
  key: string;
  /** What the sheet shows. */
  label: string;
  /** The heading of what's sent: the email subject or the message's first line. */
  title: string;
  items: Item[];
  recommended: boolean;
};

export function shareChoices({
  lists,
  items,
  activeGroup,
  watchers,
}: {
  lists: List[];
  items: Item[];
  activeGroup: string;
  watchers: string[];
}): ShareChoice[] {
  const listById = new Map(lists.map((l) => [l.id, l]));
  const live = items.filter((i) => !i.archived_at);
  const openOn = (pred: (l: List) => boolean) =>
    live.filter((i) => {
      const list = listById.get(i.list_id);
      return list && !list.is_archive && !i.done && pred(list);
    });

  const choices: ShareChoice[] = [
    {
      key: "pill",
      label: activeGroup ? `This list (${activeGroup})` : "This list",
      title: activeGroup || "Our list",
      items: openOn((l) => l.group_name === activeGroup),
      recommended: false,
    },
  ];

  if (!lists.some((l) => l.kind === "watch")) return choices;

  const watchOpen = openOn((l) => l.kind === "watch");
  choices.push({
    key: "recommended",
    label: "★ Recommended shows",
    title: "Shows we recommend",
    items: live.filter((i) => {
      const list = listById.get(i.list_id);
      return Boolean(i.recommended) && list !== undefined && canRecommend(list);
    }),
    recommended: true,
  });
  choices.push({
    key: "together",
    label: "Shows we watch together",
    title: "Shows we're watching",
    items: watchOpen.filter((i) => !i.watcher),
    recommended: false,
  });
  for (const watcher of watchers) {
    choices.push({
      key: `watcher:${watcher}`,
      label: `${watcher}'s shows`,
      title: `${watcher}'s shows`,
      items: watchOpen.filter((i) => i.watcher === watcher),
      recommended: false,
    });
  }
  return choices;
}

/** The message for the phone's share menu: plain text that reads well anywhere. */
export function shareText(choice: ShareChoice) {
  const lines = choice.items.map((item) => {
    const detail = [item.qty, item.service].filter(Boolean).join(", ");
    const note = choice.recommended && item.recommend_note ? ` — ${item.recommend_note}` : "";
    return `${choice.recommended ? "★" : "•"} ${item.text}${detail ? ` (${detail})` : ""}${note}`;
  });
  return `${choice.title}\n\n${lines.join("\n")}`;
}
