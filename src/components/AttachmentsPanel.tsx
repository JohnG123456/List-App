"use client";

import { useEffect, useMemo, useState } from "react";
import { FileText, Paperclip, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Attachment } from "@/lib/types";
import {
  ACCEPT,
  attachFile,
  detach,
  formatSize,
  isImage,
  signedLinks,
} from "@/lib/attachments";

type Props = {
  itemId: string;
  householdId: string | null;
  attachments: Attachment[];
  onAdded: (added: Attachment[]) => void;
  onRemoved: (removed: Attachment) => void;
};

/**
 * Photos and documents on one item, inside the edit sheet. Changes save
 * straight away rather than waiting for the sheet's Save button: an upload
 * that only lands if you remember to press Save is an upload that gets lost.
 */
export default function AttachmentsPanel({
  itemId,
  householdId,
  attachments,
  onAdded,
  onRemoved,
}: Props) {
  const supabase = useMemo(() => createClient(), []);
  const [links, setLinks] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pathsKey = attachments.map((a) => a.path).join("|");

  // Links expire after a few minutes, so they're fetched when the sheet opens
  // rather than kept around.
  useEffect(() => {
    let cancelled = false;
    const paths = pathsKey ? pathsKey.split("|") : [];
    void signedLinks(supabase, paths).then((next) => {
      if (!cancelled) setLinks(next);
    });
    return () => {
      cancelled = true;
    };
  }, [supabase, pathsKey]);

  async function add(files: FileList | null) {
    if (!files || files.length === 0) return;
    if (!householdId) {
      setError("Couldn't find your household, so there's nowhere to put this.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      for (const file of Array.from(files)) {
        onAdded(await attachFile(supabase, householdId, [itemId], file));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't attach that");
    } finally {
      setBusy(false);
    }
  }

  async function remove(attachment: Attachment) {
    if (!window.confirm(`Remove ${attachment.file_name}?`)) return;
    setError(null);
    try {
      await detach(supabase, attachment);
      onRemoved(attachment);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't remove that");
    }
  }

  const label = "block text-xs uppercase tracking-wider text-slate-500";

  return (
    <div className="space-y-2">
      <p className={label}>Photos and files</p>

      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map((attachment) => {
            const link = links[attachment.path];
            return (
              <li
                key={attachment.id}
                className="flex items-center gap-2 rounded-lg border border-slate-700 bg-slate-800/40 p-1.5"
              >
                <a
                  href={link}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-disabled={!link}
                  className="flex min-w-0 flex-1 items-center gap-2"
                >
                  {isImage(attachment.mime_type) && link ? (
                    // A signed, expiring link to private storage: next/image's
                    // optimiser would fetch and cache it server-side, which is
                    // exactly what a private file shouldn't do.
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={link}
                      alt=""
                      className="h-10 w-10 shrink-0 rounded object-cover"
                    />
                  ) : (
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-slate-700/60 text-slate-300">
                      <FileText className="h-5 w-5" />
                    </span>
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-slate-100">
                      {attachment.file_name}
                    </span>
                    <span className="block text-[11px] text-slate-500">
                      {formatSize(attachment.size_bytes)}
                    </span>
                  </span>
                </a>
                <button
                  type="button"
                  onClick={() => void remove(attachment)}
                  aria-label={`Remove ${attachment.file_name}`}
                  className="shrink-0 p-1.5 text-slate-500 hover:text-red-400"
                >
                  <X className="h-4 w-4" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* No `capture` attribute, so a phone offers the camera, the photo
          library and its files all from the one button. */}
      <label
        className={`flex cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-slate-600 px-3 py-2 text-sm text-slate-300 hover:border-blue-500 ${
          busy ? "pointer-events-none opacity-50" : ""
        }`}
      >
        <input
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          disabled={busy}
          onChange={(e) => {
            void add(e.target.files);
            e.target.value = "";
          }}
        />
        <Paperclip className="h-4 w-4" />
        {busy ? "Attaching..." : "Add a photo or file"}
      </label>

      {error && <p className="text-xs text-red-400">{error}</p>}
    </div>
  );
}
