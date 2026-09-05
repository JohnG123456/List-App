"use client";

import type { Item, List } from "@/lib/types";
import { listsInGroup, openItems } from "@/lib/display";

type Props = {
  groups: string[];
  lists: List[];
  items: Item[];
  activeGroup: string;
  /** Pill labels that have something newly added in them. */
  freshGroups: Set<string>;
  onSelect: (group: string) => void;
};

/**
 * One pill per group, not per list, so the two TV lists read as one place.
 * The count is what makes the rail worth having: you can see there are seven
 * things in Groceries without switching to it.
 */
export default function PillRail({
  groups,
  lists,
  items,
  activeGroup,
  freshGroups,
  onSelect,
}: Props) {
  return (
    <div
      role="tablist"
      aria-label="Your lists"
      className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      {groups.map((group) => {
        const groupLists = listsInGroup(lists, group);
        const count = groupLists
          .filter((l) => !l.is_archive)
          .reduce((sum, l) => sum + openItems(items, l.id).length, 0);
        const shared = groupLists.some((l) => l.private_to === null);
        const isActive = group === activeGroup;
        const isFresh = freshGroups.has(group);

        return (
          <button
            key={group}
            role="tab"
            aria-selected={isActive}
            onClick={() => onSelect(group)}
            className={`flex shrink-0 items-center gap-2 whitespace-nowrap rounded-full border px-3.5 py-1.5 text-sm backdrop-blur transition ${
              isActive
                ? "border-blue-500/60 bg-blue-500/15 text-blue-100 shadow-[0_0_22px_-6px_rgba(59,130,246,0.55)]"
                : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
            }`}
          >
            {shared && (
              <span
                aria-label="Shared"
                title="Shared with your household"
                className="h-1.5 w-1.5 rounded-full bg-pink-400"
              />
            )}
            {group}
            <span
              className={`rounded-full px-1.5 text-xs tabular-nums ${
                isFresh
                  ? "bg-emerald-500/30 text-emerald-200"
                  : isActive
                    ? "bg-blue-500/30 text-blue-100"
                    : "bg-slate-500/20 text-slate-400"
              }`}
            >
              {count}
            </span>
          </button>
        );
      })}
    </div>
  );
}
