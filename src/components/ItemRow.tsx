"use client";

import { useState } from "react";
import { Check, MoveRight, Pencil, Play, Plus, Trash2, X } from "lucide-react";
import type { Item, List } from "@/lib/types";
import { formatTimestamp } from "@/lib/display";

type Props = {
  item: Item;
  list: List;
  /** Every list the item could be moved to. */
  moveTargets: List[];
  /** The streaming services this household actually pays for. */
  services: string[];
  isSettling: boolean;
  isFresh: boolean;
  addedByInitials: string | null;
  doneByInitials: string | null;
  onToggleDone: (item: Item) => void;
  onEdit: (item: Item, text: string) => void;
  onDelete: (item: Item) => void;
  onMove: (item: Item, listId: string) => void;
  onPromote: (item: Item) => void;
  onBumpEpisode: (item: Item) => void;
  onSetService: (item: Item, service: string) => void;
};

/**
 * One row for every list. What differs between a grocery item and a TV show is
 * which fields have values, not which component renders them, so a new list
 * needs no new row.
 */
export default function ItemRow({
  item,
  list,
  moveTargets,
  isSettling,
  isFresh,
  addedByInitials,
  doneByInitials,
  onToggleDone,
  onEdit,
  onDelete,
  onMove,
  onPromote,
  onBumpEpisode,
  onSetService,
  services,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.text);
  const [showMove, setShowMove] = useState(false);
  const [showServices, setShowServices] = useState(false);

  const isShared = list.private_to === null;
  const isWatch = list.kind === "watch";

  function save() {
    const text = draft.trim();
    if (text && text !== item.text) onEdit(item, text);
    setEditing(false);
  }

  return (
    <div
      className={`relative flex items-center gap-2.5 rounded-xl border px-3 py-2 backdrop-blur transition ${
        isFresh
          ? "border-emerald-400/70 bg-emerald-900/25 shadow-[0_0_18px_-8px_rgba(52,211,153,0.7)]"
          : "border-slate-700/60 bg-slate-900/50"
      } ${isSettling ? "opacity-60" : "opacity-100"}`}
    >
      {isFresh && (
        <span className="absolute -top-2 right-3 rounded bg-emerald-400 px-1.5 text-[9px] font-semibold tracking-wider text-emerald-950">
          NEW
        </span>
      )}

      <button
        onClick={() => onToggleDone(item)}
        aria-label={item.done ? "Mark as not done" : "Mark as done"}
        className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 transition ${
          item.done ? "border-blue-500 bg-blue-500" : "border-slate-600 hover:border-blue-500"
        }`}
      >
        {item.done && <Check className="h-4 w-4 text-white" />}
      </button>

      {editing ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save();
          }}
          className="flex flex-1 items-center gap-2"
        >
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setDraft(item.text);
                setEditing(false);
              }
            }}
            className="flex-1 rounded-lg border border-blue-500/50 bg-slate-800/60 px-2 py-1 text-sm text-slate-100 outline-none focus:border-blue-500"
          />
          <button type="submit" aria-label="Save" className="shrink-0 text-blue-400 hover:text-blue-300">
            <Check className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => {
              setDraft(item.text);
              setEditing(false);
            }}
            aria-label="Cancel edit"
            className="shrink-0 text-slate-500 hover:text-red-400"
          >
            <X className="h-4 w-4" />
          </button>
        </form>
      ) : (
        <>
          <div className="min-w-0 flex-1">
            <p
              className={`text-sm leading-snug ${
                item.done ? "text-slate-500 line-through" : "text-slate-100"
              }`}
            >
              {item.text}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs leading-snug text-slate-500">
              {item.qty && (
                <span className="rounded border border-slate-700 bg-slate-500/10 px-1.5 text-[10px]">
                  {item.qty}
                </span>
              )}
              {isWatch && item.service && (
                <span className="rounded border border-slate-600 bg-slate-500/10 px-1.5 text-[10px] text-slate-300">
                  {item.service}
                </span>
              )}
              {isWatch && !item.service && (
                <button
                  onClick={() => setShowServices((v) => !v)}
                  title="Set the streaming service"
                  className="rounded border border-dashed border-orange-500/50 bg-orange-500/10 px-1.5 text-[10px] text-orange-300 hover:border-orange-400"
                >
                  Where?
                </button>
              )}
              {item.progress && <span className="text-blue-300">{item.progress}</span>}
              {item.profile && <span>{item.profile}&rsquo;s profile</span>}
              {item.suggested_by && <span>from {item.suggested_by}</span>}
              {!isWatch && <span>{formatTimestamp(item.created_at)}</span>}
              {isShared && addedByInitials && (
                <span
                  title="Added by"
                  className="rounded-full border border-slate-600 bg-slate-500/10 px-1.5 text-[10px]"
                >
                  {addedByInitials}
                </span>
              )}
              {isShared && item.done && doneByInitials && (
                <span
                  title="Ticked off by"
                  className="rounded-full border border-blue-500/40 bg-blue-500/10 px-1.5 text-[10px] text-blue-200"
                >
                  ticked {doneByInitials}
                </span>
              )}
            </div>
          </div>

          {list.promote_to && !item.done && (
            <button
              onClick={() => onPromote(item)}
              aria-label={list.promote_label ?? "Move on"}
              title={list.promote_label ?? "Move on"}
              className="shrink-0 text-slate-500 hover:text-emerald-400"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {isWatch && !list.is_archive && !list.promote_to && !item.done && (
            <button
              onClick={() => onBumpEpisode(item)}
              aria-label="Next episode"
              title="Next episode"
              className="shrink-0 text-slate-500 hover:text-blue-400"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
          <button
            onClick={() => setShowMove((v) => !v)}
            aria-label="Move to another list"
            title="Move to another list"
            className="shrink-0 text-slate-500 hover:text-blue-400"
          >
            <MoveRight className="h-4 w-4" />
          </button>
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit item"
            className="shrink-0 text-slate-500 hover:text-blue-400"
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            onClick={() => onDelete(item)}
            aria-label="Delete item"
            className="shrink-0 text-slate-500 hover:text-red-400"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </>
      )}

      {showServices && (
        <div className="absolute right-2 top-full z-20 mt-1 w-48 rounded-xl border border-slate-600 bg-slate-900 p-1.5 shadow-xl">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Watch it on
          </p>
          {services.map((service) => (
            <button
              key={service}
              onClick={() => {
                onSetService(item, service);
                setShowServices(false);
              }}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-blue-500/20 hover:text-blue-100"
            >
              {service}
            </button>
          ))}
        </div>
      )}

      {showMove && (
        <div className="absolute right-2 top-full z-20 mt-1 w-48 rounded-xl border border-slate-600 bg-slate-900 p-1.5 shadow-xl">
          <p className="px-2 pb-1 text-[10px] uppercase tracking-wider text-slate-500">
            Move to
          </p>
          {moveTargets.map((target) => (
            <button
              key={target.id}
              onClick={() => {
                onMove(item, target.id);
                setShowMove(false);
              }}
              className="block w-full rounded-lg px-2 py-1.5 text-left text-sm text-slate-200 hover:bg-blue-500/20 hover:text-blue-100"
            >
              {target.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
