import { supabase } from "@/lib/supabase";
import { hash53, type SyncItem } from "@/lib/syncItems";

// Note images and attachments live in Supabase Storage (private bucket
// "user-files", one folder per user) instead of inside the synced notes.
// On the device, items keep their data: URLs, so notes work offline exactly
// as before. Only the synced copy swaps each data: URL for a short
// "cloudfile:<name>" reference, and other devices download the file and
// turn it back into a data: URL. Names come from the file's content, so the
// same image is stored once and never uploaded twice.

export const FILE_BUCKET = "user-files";
export const CLOUD_REF = "cloudfile:";
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const FILE_FIELDS = ["uri", "originalUri"] as const;

// Must match the bucket's allowed types in supabase/migrations/0002.
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
};
const MIME_BY_EXT = Object.fromEntries(Object.entries(EXT_BY_MIME).map(([mime, ext]) => [ext, mime]));

export const isCloudRef = (v: unknown): v is string => typeof v === "string" && v.startsWith(CLOUD_REF);
export const refName = (ref: string) => ref.slice(CLOUD_REF.length);

function parseDataUrl(uri: string): { mime: string; base64: string } | null {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) return null;
  const header = uri.slice(5, comma);
  if (!/;base64$/i.test(header)) return null;
  let mime = header.split(";")[0].toLowerCase();
  if (mime === "image/jpg") mime = "image/jpeg";
  return { mime, base64: uri.slice(comma + 1) };
}

const refCache = new Map<string, string | null>();

/** The storage reference for a data: URL, or null if it can't be stored. */
export function refForDataUrl(uri: string): string | null {
  const cached = refCache.get(uri);
  if (cached !== undefined) return cached;
  const parsed = parseDataUrl(uri);
  const ext = parsed ? EXT_BY_MIME[parsed.mime] : undefined;
  const ref = parsed && ext ? `${CLOUD_REF}${hash53(parsed.base64)}-${parsed.base64.length.toString(36)}.${ext}` : null;
  if (refCache.size > 400) refCache.clear();
  refCache.set(uri, ref);
  return ref;
}

/** The synced form of an item; `files` collects name → data: URL for upload. */
export function toCloudForm(item: SyncItem, files: Map<string, string>): SyncItem {
  if (item.collection !== "note_item" || !item.data || typeof item.data !== "object") return item;
  const data = item.data as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of FILE_FIELDS) {
    const value = data[field];
    if (typeof value !== "string" || !value.startsWith("data:")) continue;
    const ref = refForDataUrl(value);
    if (!ref) continue;
    next ??= { ...data };
    next[field] = ref;
    files.set(refName(ref), value);
  }
  return next ? { ...item, data: next } : item;
}

function base64ToBytes(base64: string): Uint8Array {
  const bin = atob(base64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const s = String(reader.result);
      resolve(s.slice(s.indexOf(",") + 1));
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

export type UploadResult = "ok" | "too-large" | "unsupported";

export async function uploadFile(userId: string, name: string, dataUrl: string): Promise<UploadResult> {
  if (!supabase) throw new Error("Sync isn't set up.");
  const parsed = parseDataUrl(dataUrl);
  if (!parsed || !EXT_BY_MIME[parsed.mime]) return "unsupported";
  if (Math.floor((parsed.base64.length * 3) / 4) > MAX_FILE_BYTES) return "too-large";
  const { error } = await supabase.storage
    .from(FILE_BUCKET)
    .upload(`${userId}/${name}`, base64ToBytes(parsed.base64), { contentType: parsed.mime, upsert: false, cacheControl: "31536000" });
  if (!error) return "ok";
  const detail = `${error.message} ${(error as { statusCode?: string }).statusCode ?? ""}`;
  if (/already exists|duplicate|409/i.test(detail)) return "ok";
  if (/mime|content type|415/i.test(detail)) return "unsupported";
  if (/size|too large|413|payload/i.test(detail)) return "too-large";
  throw error;
}

const downloaded = new Map<string, string>();

/** A stored file as a data: URL, or null if it can't be fetched right now. */
export async function downloadFile(userId: string, name: string): Promise<string | null> {
  const hit = downloaded.get(name);
  if (hit) return hit;
  const mime = MIME_BY_EXT[name.slice(name.lastIndexOf(".") + 1)];
  if (!supabase || !mime) return null;
  try {
    const { data, error } = await supabase.storage.from(FILE_BUCKET).download(`${userId}/${name}`);
    if (error || !data) return null;
    const uri = `data:${mime};base64,${await blobToBase64(data)}`;
    if (downloaded.size > 60) downloaded.clear();
    downloaded.set(name, uri);
    return uri;
  } catch {
    return null;
  }
}

/**
 * Turn an item's file references back into data: URLs — from `known`
 * (files this device already has) or by downloading.
 */
export async function resolveRefs(
  userId: string,
  data: unknown,
  known?: Map<string, string>
): Promise<{ data: unknown; changed: boolean }> {
  if (!data || typeof data !== "object") return { data, changed: false };
  const src = data as Record<string, unknown>;
  let next: Record<string, unknown> | null = null;
  for (const field of FILE_FIELDS) {
    const value = src[field];
    if (!isCloudRef(value)) continue;
    const name = refName(value);
    const uri = known?.get(name) ?? (await downloadFile(userId, name));
    if (!uri) continue;
    next ??= { ...src };
    next[field] = uri;
  }
  return next ? { data: next, changed: true } : { data, changed: false };
}

async function listFiles(userId: string): Promise<{ name: string; created_at?: string | null }[]> {
  if (!supabase) return [];
  const out: { name: string; created_at?: string | null }[] = [];
  for (let offset = 0; offset < 20_000; offset += 1000) {
    const { data, error } = await supabase.storage
      .from(FILE_BUCKET)
      .list(userId, { limit: 1000, offset, sortBy: { column: "name", order: "asc" } });
    if (error) throw error;
    out.push(...(data ?? []).filter((f) => f.name && !f.name.startsWith(".")));
    if (!data || data.length < 1000) break;
  }
  return out;
}

async function removeNames(userId: string, names: string[]) {
  if (!supabase) return;
  for (let i = 0; i < names.length; i += 100) {
    const { error } = await supabase.storage.from(FILE_BUCKET).remove(names.slice(i, i + 100).map((n) => `${userId}/${n}`));
    if (error) throw error;
  }
}

/** Delete files no note uses any more (older than a grace period, in case another device is mid-upload). */
export async function removeUnreferencedFiles(userId: string, referenced: Set<string>, graceMs = 7 * 24 * 3600 * 1000) {
  const cutoff = Date.now() - graceMs;
  const doomed = (await listFiles(userId))
    .filter((f) => !referenced.has(f.name) && f.created_at && Date.parse(f.created_at) < cutoff)
    .map((f) => f.name);
  await removeNames(userId, doomed);
  return doomed.length;
}

/** Delete every file this user stored (for account deletion). */
export async function removeAllFiles(userId: string) {
  for (let round = 0; round < 25; round++) {
    const files = await listFiles(userId);
    if (!files.length) return;
    await removeNames(userId, files.map((f) => f.name));
  }
}
