"use client";

import { useState } from "react";
import type { Household, Item, List } from "@/lib/types";
import { addDays, localDateKey } from "@/lib/display";

type Props = {
  item: Item;
  list: List;
  household: Household | null;
  onSave: (patch: Partial<Item>) => void;
  onCancel: () => void;
};

/**
 * Editing everything about an item, not just its name.
 *
 * Which fields appear comes from the list, the same way the row decides what
 * to show: a show has a service, an episode and a profile; a grocery item has
 * a quantity and an aisle. One sheet, no per-list variants.
 *
 * It lives at page level because every row carries a backdrop blur, and a
 * panel drawn inside one is trapped in that row's stacking context.
 */
export default function EditSheet({ item, list, household, onSave, onCancel }: Props) {
  const [text, setText] = useState(item.text);
  const [service, setService] = useState(item.service ?? "");
  const [progress, setProgress] = useState(item.progress ?? "");
  const [profile, setProfile] = useState(item.profile ?? "");
  const [qty, setQty] = useState(item.qty ?? "");
  const [aisle, setAisle] = useState(item.aisle ?? "");
  const [dueOn, setDueOn] = useState(item.due_on ?? "");

  const isWatch = list.kind === "watch";
  const isShop = list.kind === "shop";

  function orNull(value: string) {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    const title = text.trim();
    if (!title) return;

    const patch: Partial<Item> = { text: title };
    if (isWatch) {
      patch.service = orNull(service);
      patch.progress = orNull(progress);
      patch.profile = orNull(profile);
    } else if (isShop) {
      patch.qty = orNull(qty);
      patch.aisle = orNull(aisle);
    } else {
      patch.due_on = orNull(dueOn);
    }
    onSave(patch);
  }

  const label = "block text-xs uppercase tracking-wider text-slate-500";
  const field =
    "w-full rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-2 text-sm text-slate-100 outline-none focus:border-blue-500";

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3"
      onClick={onCancel}
    >
      <form
        onSubmit={save}
        onClick={(e) => e.stopPropagation()}
        className="max-h-[85vh] w-full max-w-md space-y-3 overflow-y-auto rounded-2xl border border-slate-700 bg-slate-900 p-4 shadow-2xl"
      >
        <div className="space-y-1">
          <label className={label} htmlFor="edit-title">
            {isWatch ? "Title" : "What"}
          </label>
          <input
            id="edit-title"
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
            className={field}
          />
        </div>

        {isWatch && (
          <>
            <div className="space-y-1">
              <label className={label} htmlFor="edit-service">
                Where we watch it
              </label>
              <select
                id="edit-service"
                value={service}
                onChange={(e) => setService(e.target.value)}
                className={field}
              >
                <option value="">Not set</option>
                {(household?.services ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {/* Keeps a service that has since been removed from settings
                    rather than silently blanking it on the next save. */}
                {service && !(household?.services ?? []).includes(service) && (
                  <option value={service}>{service}</option>
                )}
              </select>
            </div>

            <div className="space-y-1">
              <label className={label} htmlFor="edit-progress">
                Up to
              </label>
              <input
                id="edit-progress"
                value={progress}
                onChange={(e) => setProgress(e.target.value)}
                placeholder="S2 E4"
                className={field}
              />
            </div>

            <div className="space-y-1">
              <label className={label} htmlFor="edit-profile">
                Whose profile
              </label>
              <select
                id="edit-profile"
                value={profile}
                onChange={(e) => setProfile(e.target.value)}
                className={field}
              >
                <option value="">Not set</option>
                {(household?.profiles ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {profile && !(household?.profiles ?? []).includes(profile) && (
                  <option value={profile}>{profile}</option>
                )}
              </select>
            </div>
          </>
        )}

        {isShop && (
          <>
            <div className="space-y-1">
              <label className={label} htmlFor="edit-qty">
                How much
              </label>
              <input
                id="edit-qty"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                placeholder="2L, 1kg, free range"
                className={field}
              />
            </div>

            <div className="space-y-1">
              <label className={label} htmlFor="edit-aisle">
                Section of the shop
              </label>
              <select
                id="edit-aisle"
                value={aisle}
                onChange={(e) => setAisle(e.target.value)}
                className={field}
              >
                <option value="">Not sorted yet</option>
                {(household?.aisle_order ?? []).map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
                {aisle && !(household?.aisle_order ?? []).includes(aisle) && (
                  <option value={aisle}>{aisle}</option>
                )}
              </select>
            </div>
          </>
        )}

        {!isWatch && !isShop && (
          <div className="space-y-1">
            <label className={label} htmlFor="edit-due">
              Due
            </label>
            <select
              id="edit-due"
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
              className={field}
            >
              <option value="">No particular day</option>
              <option value={localDateKey()}>Today</option>
              <option value={addDays(1)}>Tomorrow</option>
              <option value={addDays(7)}>Within the week</option>
              {dueOn &&
                ![localDateKey(), addDays(1), addDays(7)].includes(dueOn) && (
                  <option value={dueOn}>{dueOn}</option>
                )}
            </select>
          </div>
        )}

        <div className="flex gap-2 pt-1">
          <button
            type="submit"
            className="flex-1 rounded-lg bg-blue-600 px-3 py-2 text-sm font-medium text-white"
          >
            Save
          </button>
          <button
            type="button"
            onClick={onCancel}
            className="rounded-lg border border-slate-700 px-3 py-2 text-sm text-slate-400"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
}
