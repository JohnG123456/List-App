import type { SupabaseClient } from "@supabase/supabase-js";
import type { Attachment } from "@/lib/types";

/**
 * Photos and documents on items. Files go straight from the browser to a
 * private Supabase Storage bucket rather than through the app's own server,
 * which caps request bodies at about 4.5 MB on Vercel; a phone photo is often
 * bigger than that before it's shrunk.
 */

export const BUCKET = "attachments";

/** Matches the bucket's own limit in migration 0012. */
export const MAX_BYTES = 10 * 1024 * 1024;

/** Matches the bucket's allowed types in migration 0012. */
const ALLOWED_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "image/heic",
  "image/heif",
  "application/pdf",
  "text/plain",
  "text/csv",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

export const ACCEPT =
  "image/*,.pdf,.txt,.csv,.doc,.docx,.xls,.xlsx,.ppt,.pptx";

/** How long a link to a file works. Long enough to open it, not to share it. */
const LINK_SECONDS = 5 * 60;

// The longest side a photo is kept at. Plenty to read a receipt.
const MAX_SIDE = 2048;

export function isImage(type: string) {
  return type.startsWith("image/");
}

export function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Re-draws a photo smaller and as a JPEG. Besides the size, this drops the
 * photo's metadata, which on a phone includes where it was taken.
 *
 * GIFs are left alone (redrawing would freeze them), and anything the browser
 * can't decode, such as HEIC outside Safari, goes up as it came.
 */
export async function shrinkPhoto(file: File): Promise<File> {
  if (!isImage(file.type) || file.type === "image/gif") return file;

  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const width = Math.round(bitmap.width * scale);
    const height = Math.round(bitmap.height * scale);

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) return file;
    context.drawImage(bitmap, 0, 0, width, height);
    bitmap.close();

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/jpeg", 0.85)
    );
    if (!blob) return file;

    const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
    return new File([blob], name, { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/** Why a file can't be attached, or null if it can. */
export function rejectReason(file: File) {
  if (!ALLOWED_TYPES.has(file.type)) {
    return "That type of file can't be attached. Photos, PDFs, Word, Excel, PowerPoint and text files can.";
  }
  if (file.size > MAX_BYTES) {
    return `That file is ${formatSize(file.size)}. The limit is ${formatSize(MAX_BYTES)}.`;
  }
  return null;
}

function extensionFor(file: File) {
  const fromName = file.name.match(/\.([a-z0-9]{1,5})$/i)?.[1];
  if (fromName) return fromName.toLowerCase();
  return file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "").slice(0, 5) || "bin";
}

/**
 * Uploads one file and ties it to every item in `itemIds`. If the rows can't
 * be saved the file is removed again, so nothing is left behind unattached.
 */
export async function attachFile(
  supabase: SupabaseClient,
  householdId: string,
  itemIds: string[],
  original: File
): Promise<Attachment[]> {
  const file = await shrinkPhoto(original);
  const reason = rejectReason(file);
  if (reason) throw new Error(reason);

  // The stored name is random; the real one is kept in the row for display.
  const path = `${householdId}/${crypto.randomUUID()}.${extensionFor(file)}`;
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (uploadError) throw uploadError;

  const { data, error: insertError } = await supabase
    .from("item_attachments")
    .insert(
      itemIds.map((item_id) => ({
        item_id,
        path,
        file_name: original.name || file.name,
        mime_type: file.type,
        size_bytes: file.size,
      }))
    )
    .select();

  if (insertError) {
    await supabase.storage.from(BUCKET).remove([path]);
    throw insertError;
  }
  return data ?? [];
}

/**
 * Removes the stored files once their rows are gone. A file another item still
 * uses is refused by the storage policy and simply stays, which is the point.
 */
export async function removeFiles(supabase: SupabaseClient, paths: string[]) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return;
  await supabase.storage.from(BUCKET).remove(unique);
}

export async function detach(supabase: SupabaseClient, attachment: Attachment) {
  const { error } = await supabase
    .from("item_attachments")
    .delete()
    .eq("id", attachment.id);
  if (error) throw error;
  await removeFiles(supabase, [attachment.path]);
}

/** Short-lived links for showing or opening files, keyed by path. */
export async function signedLinks(supabase: SupabaseClient, paths: string[]) {
  const unique = [...new Set(paths)];
  if (unique.length === 0) return {} as Record<string, string>;
  const { data } = await supabase.storage
    .from(BUCKET)
    .createSignedUrls(unique, LINK_SECONDS);
  const links: Record<string, string> = {};
  for (const entry of data ?? []) {
    if (entry.path && entry.signedUrl) links[entry.path] = entry.signedUrl;
  }
  return links;
}
