"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";

type Props = {
  values: string[];
  placeholder: string;
  /** When the order carries meaning, as it does for supermarket sections. */
  ordered?: boolean;
  onChange: (values: string[]) => void;
};

/**
 * A short list of words you edit by hand: streaming services, viewing profiles,
 * the sections of your supermarket. Small enough that a chip each beats a form.
 */
export default function ChipEditor({ values, placeholder, ordered, onChange }: Props) {
  const [draft, setDraft] = useState("");

  function add(e: React.FormEvent) {
    e.preventDefault();
    const value = draft.trim();
    if (!value) return;
    // Case-insensitive, because the whole point of a fixed list is that one
    // thing has one spelling.
    if (values.some((v) => v.toLowerCase() === value.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...values, value]);
    setDraft("");
  }

  function remove(index: number) {
    onChange(values.filter((_, i) => i !== index));
  }

  function move(index: number, by: number) {
    const target = index + by;
    if (target < 0 || target >= values.length) return;
    const next = [...values];
    [next[index], next[target]] = [next[target], next[index]];
    onChange(next);
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {values.map((value, i) => (
          <span
            key={value}
            className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/50 py-1 pl-2 pr-1 text-xs text-slate-200"
          >
            {ordered && <span className="text-slate-500">{i + 1}.</span>}
            {value}
            {ordered && (
              <>
                <button
                  onClick={() => move(i, -1)}
                  disabled={i === 0}
                  aria-label={`Move ${value} earlier`}
                  className="text-slate-500 hover:text-blue-300 disabled:opacity-25"
                >
                  <ChevronLeft className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => move(i, 1)}
                  disabled={i === values.length - 1}
                  aria-label={`Move ${value} later`}
                  className="text-slate-500 hover:text-blue-300 disabled:opacity-25"
                >
                  <ChevronRight className="h-3.5 w-3.5" />
                </button>
              </>
            )}
            <button
              onClick={() => remove(i)}
              aria-label={`Remove ${value}`}
              className="text-slate-500 hover:text-red-400"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </span>
        ))}
        {values.length === 0 && (
          <span className="text-xs text-slate-500">Nothing yet.</span>
        )}
      </div>

      <form onSubmit={add} className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          className="flex-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-100 placeholder-slate-500 outline-none focus:border-blue-500"
        />
        <button
          type="submit"
          aria-label="Add"
          className="flex items-center gap-1 rounded-lg border border-slate-700 bg-slate-800/60 px-3 py-1.5 text-sm text-slate-300"
        >
          <Plus className="h-3.5 w-3.5" />
          Add
        </button>
      </form>
    </div>
  );
}
