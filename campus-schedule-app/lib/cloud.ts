import { Platform } from "react-native";

import type { Course, Meeting, Weekday } from "@/context/store";
import { removeAllFiles } from "@/lib/cloudFiles";
import { validateActivityRow, type FriendActivity, type MyActivity } from "@/lib/activity";
import { MAX_BUSY_BLOCKS, validBusy, type BusyBlock } from "@/lib/freeTime";
import { validateSharedNotes, type SharedNote } from "@/lib/sharedNotes";
import { supabase } from "@/lib/supabase";

// Everything that talks to Supabase besides personal sync: sharing a course
// by code, class sections with shared deadlines, and deleting an account.
// The database enforces the real rules — who can see what, sizes, rate
// limits (supabase/migrations/0002). Checks here only give faster, friendlier
// feedback, and anything read back is re-validated before the app uses it.

export const LIMITS = {
  sectionName: 80,
  displayName: 40,
  postTitle: 140,
  postNote: 500,
  courseCode: 32,
} as const;

export class CloudError extends Error {}

function client() {
  if (!supabase) throw new CloudError("Accounts aren't set up in this version of the app.");
  return supabase;
}

export function friendlyCloudError(e: unknown): string {
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  const message =
    e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e ?? "");
  if (/failed to fetch|network|offline|load failed/i.test(message)) return "Couldn't reach the server. Check your connection.";
  if (["PGRST202", "PGRST205", "42883", "42P01", "42703"].includes(code) || /could not find the (function|table)/i.test(message))
    return "This needs a database update: run the newest file in supabase/migrations in the Supabase SQL Editor.";
  if (/row-level security|permission denied/i.test(message)) return "You don't have permission to do that.";
  if (/JWT|not signed in/i.test(message)) return "Sign in again to continue.";
  return message || "Something went wrong.";
}

async function run<T>(request: PromiseLike<{ data: T; error: unknown }>): Promise<T> {
  const { data, error } = await request;
  if (error) throw new CloudError(friendlyCloudError(error));
  return data;
}

// --- Codes & links ---------------------------------------------------------------

/** Codes use A–Z without I/O and 2–9; people type them in any case, with spaces or dashes. */
export const cleanCode = (input: string) => input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 10);
export const isValidCode = (code: string) => /^[A-HJ-NP-Z2-9]{10}$/.test(code);
export const formatCode = (code: string) => (code.length === 10 ? `${code.slice(0, 5)}-${code.slice(5)}` : code);

function appBaseUrl(): string | null {
  if (Platform.OS !== "web" || typeof document === "undefined") return null;
  const manifest = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  return manifest ? new URL(".", manifest.href).href : `${window.location.origin}/`;
}

export function inviteLink(kind: "course" | "section" | "deadlines", code: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return kind === "course" ? `${base}courses?course=${code}` : kind === "section" ? `${base}tasks?join=${code}` : `${base}deadlines?code=${code}`;
}

export async function copyText(text: string): Promise<boolean> {
  try {
    if (Platform.OS === "web" && navigator.clipboard) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Clipboard blocked (e.g. not a secure context); the text stays selectable.
  }
  return false;
}

// --- Validation of anything read back ----------------------------------------------

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const str = (v: unknown, max: number) => (typeof v === "string" && v.trim() && v.length <= max ? v.trim() : undefined);

export type SharedCourse = Omit<Course, "id" | "color"> & { color?: string };

export function validateSharedCourse(v: unknown): SharedCourse | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const code = str(o.code, LIMITS.courseCode);
  if (!code || !Array.isArray(o.meetings)) return null;
  const meetings: Meeting[] = [];
  for (const m of o.meetings.slice(0, 10)) {
    if (!m || typeof m !== "object") return null;
    const mm = m as Record<string, unknown>;
    const days = Array.isArray(mm.days) ? mm.days.filter((d): d is Weekday => Number.isInteger(d) && (d as number) >= 0 && (d as number) <= 6) : [];
    if (!days.length || typeof mm.start !== "string" || typeof mm.end !== "string" || !HHMM.test(mm.start) || !HHMM.test(mm.end)) return null;
    meetings.push({ days, start: mm.start, end: mm.end, room: str(mm.room, 60) });
  }
  const units = typeof o.units === "number" && o.units >= 0 && o.units <= 30 ? o.units : undefined;
  return {
    code,
    title: str(o.title, 120),
    section: str(o.section, 20),
    instructor: str(o.instructor, 80),
    color: typeof o.color === "string" && /^#[0-9A-Fa-f]{6}$/.test(o.color) ? o.color : undefined,
    units,
    meetings,
  };
}

// --- Share a course -----------------------------------------------------------------

export async function shareCourse(course: Course): Promise<string> {
  const payload = {
    code: course.code.trim().slice(0, LIMITS.courseCode),
    title: course.title?.slice(0, 120),
    section: course.section?.slice(0, 20),
    instructor: course.instructor?.slice(0, 80),
    color: /^#[0-9A-Fa-f]{6}$/.test(course.color) ? course.color : undefined,
    units: course.units,
    meetings: course.meetings.slice(0, 10).map(({ days, start, end, room }) => ({ days, start, end, room: room?.slice(0, 60) })),
  };
  return (await run(client().rpc("share_course", { p_course: payload }))) as string;
}

/** The course behind a code, or null if the code is wrong or was stopped. */
export async function openSharedCourse(code: string): Promise<SharedCourse | null> {
  const data = await run(client().rpc("get_shared_course", { p_code: cleanCode(code) }));
  return data ? validateSharedCourse(data) : null;
}

export type MyShare = { code: string; courseCode: string; section?: string; createdAt: string; uses: number };

export async function listMyShares(): Promise<MyShare[]> {
  const rows = (await run(
    client().from("shared_courses").select("code,course,created_at,use_count").order("created_at", { ascending: false }).limit(100)
  )) as { code: string; course: unknown; created_at: string; use_count: number }[];
  return (rows ?? []).flatMap((r) => {
    const c = validateSharedCourse(r.course);
    return c ? [{ code: r.code, courseCode: c.code, section: c.section, createdAt: r.created_at, uses: r.use_count }] : [];
  });
}

export async function stopSharing(code: string): Promise<void> {
  await run(client().rpc("revoke_shared_course", { p_code: code }));
}

// --- Class sections -----------------------------------------------------------------

export type Section = {
  id: string;
  ownerId: string;
  name: string;
  courseCode: string | null;
  inviteCode: string;
  /** Code for the public read-only deadlines page, when the owner turned it on. */
  publicCode: string | null;
  createdAt: string;
};
export type SectionMember = { sectionId: string; userId: string; displayName: string; role: "owner" | "member" };
export type SectionPost = {
  id: string;
  sectionId: string;
  authorId: string;
  title: string;
  due: string;
  dueTime: string | null;
  note: string | null;
  createdAt: string;
};

/** A member checked off a deadline ("I submitted it"). */
export type PostMark = { postId: string; userId: string };

export type SharedNotesDoc = {
  id: string;
  sectionId: string;
  ownerId: string;
  title: string;
  notes: SharedNote[];
  updatedAt: string;
};

export type SectionData = {
  sections: Section[];
  members: SectionMember[];
  posts: SectionPost[];
  marks: PostMark[];
  sharedNotes: SharedNotesDoc[];
};

/** Errors meaning a newer migration hasn't been run yet: treat the feature as empty. */
const NOT_SET_UP = new Set(["PGRST205", "PGRST204", "42P01", "42703"]);

async function optionalRows(request: PromiseLike<{ data: unknown; error: { code?: string; message: string } | null }>) {
  const { data, error } = await request;
  if (error) {
    if (NOT_SET_UP.has(error.code ?? "")) return [];
    throw new CloudError(friendlyCloudError(error));
  }
  return (Array.isArray(data) ? data : []) as Record<string, unknown>[];
}

export async function fetchSectionData(): Promise<SectionData> {
  const db = client();
  const selectSections = (cols: string) => db.from("sections").select(cols).order("created_at");
  let sectionRes: { data: unknown; error: { code?: string; message: string } | null } = await selectSections(
    "id,owner_id,name,course_code,invite_code,public_code,created_at"
  );
  if (sectionRes.error?.code === "42703") sectionRes = await selectSections("id,owner_id,name,course_code,invite_code,created_at");
  if (sectionRes.error) throw new CloudError(friendlyCloudError(sectionRes.error));
  const sectionRows = (Array.isArray(sectionRes.data) ? sectionRes.data : []) as Record<string, unknown>[];
  const sections: Section[] = sectionRows.flatMap((r) =>
    typeof r.id === "string" && typeof r.name === "string" && typeof r.invite_code === "string"
      ? [
          {
            id: r.id,
            ownerId: String(r.owner_id),
            name: r.name.slice(0, LIMITS.sectionName),
            courseCode: typeof r.course_code === "string" ? r.course_code.slice(0, LIMITS.courseCode) : null,
            inviteCode: r.invite_code,
            publicCode: typeof r.public_code === "string" ? r.public_code : null,
            createdAt: String(r.created_at),
          },
        ]
      : []
  );
  if (!sections.length) return { sections, members: [], posts: [], marks: [], sharedNotes: [] };
  const ids = sections.map((s) => s.id);
  const [markRows, noteRows] = await Promise.all([
    optionalRows(db.from("section_post_marks").select("post_id,user_id").in("section_id", ids).limit(20000)),
    optionalRows(
      db.from("section_shared_notes").select("id,section_id,owner_id,title,notes,updated_at").in("section_id", ids).order("updated_at", { ascending: false }).limit(200)
    ),
  ]);
  const marks: PostMark[] = markRows.map((r) => ({ postId: String(r.post_id), userId: String(r.user_id) }));
  const sharedNotes: SharedNotesDoc[] = noteRows.flatMap((r) =>
    typeof r.title === "string"
      ? [
          {
            id: String(r.id),
            sectionId: String(r.section_id),
            ownerId: String(r.owner_id),
            title: r.title.slice(0, 80),
            notes: validateSharedNotes(r.notes),
            updatedAt: String(r.updated_at),
          },
        ]
      : []
  );
  const [memberRows, postRows] = await Promise.all([
    run(db.from("section_members").select("section_id,user_id,display_name,role").in("section_id", ids).order("joined_at").limit(5000)),
    run(
      db
        .from("section_posts")
        .select("id,section_id,author_id,title,due,due_time,note,created_at")
        .in("section_id", ids)
        .order("due")
        .limit(3000)
    ),
  ]);
  const members: SectionMember[] = ((memberRows ?? []) as Record<string, unknown>[]).map((r) => ({
    sectionId: String(r.section_id),
    userId: String(r.user_id),
    displayName: String(r.display_name ?? "").slice(0, LIMITS.displayName),
    role: r.role === "owner" ? "owner" : "member",
  }));
  const posts: SectionPost[] = ((postRows ?? []) as Record<string, unknown>[]).flatMap((r) =>
    typeof r.title === "string" && typeof r.due === "string" && ISO_DATE.test(r.due)
      ? [
          {
            id: String(r.id),
            sectionId: String(r.section_id),
            authorId: String(r.author_id),
            title: r.title.slice(0, LIMITS.postTitle),
            due: r.due,
            dueTime: typeof r.due_time === "string" && HHMM.test(r.due_time) ? r.due_time : null,
            note: typeof r.note === "string" ? r.note.slice(0, LIMITS.postNote) : null,
            createdAt: String(r.created_at),
          },
        ]
      : []
  );
  return { sections, members, posts, marks, sharedNotes };
}

const checkLength = (value: string, max: number, label: string) => {
  const v = value.trim();
  if (!v) throw new CloudError(`Enter ${label}.`);
  if (v.length > max) throw new CloudError(`${label[0].toUpperCase()}${label.slice(1)} can be at most ${max} characters.`);
  return v;
};

export async function createSection(name: string, courseCode: string, displayName: string) {
  const data = (await run(
    client().rpc("create_section", {
      p_name: checkLength(name, LIMITS.sectionName, "a section name"),
      p_course_code: courseCode.trim().slice(0, LIMITS.courseCode),
      p_display_name: checkLength(displayName, LIMITS.displayName, "your display name"),
    })
  )) as { id: string; invite_code: string };
  return { id: data.id, inviteCode: data.invite_code };
}

/** The joined section's id, or null when the code is wrong. */
export async function joinSection(code: string, displayName: string): Promise<string | null> {
  const clean = cleanCode(code);
  if (!isValidCode(clean)) throw new CloudError("Invite codes are 10 letters and numbers, like ABCDE-FGH23.");
  return (await run(
    client().rpc("join_section", { p_code: clean, p_display_name: checkLength(displayName, LIMITS.displayName, "your display name") })
  )) as string | null;
}

export async function leaveSection(sectionId: string, userId: string) {
  await run(client().from("section_members").delete().eq("section_id", sectionId).eq("user_id", userId));
}

export async function deleteSection(sectionId: string) {
  await run(client().from("sections").delete().eq("id", sectionId));
}

export async function rotateInvite(sectionId: string): Promise<string> {
  return (await run(client().rpc("rotate_section_invite", { p_section: sectionId }))) as string;
}

export async function removeMember(sectionId: string, userId: string, ban: boolean) {
  await run(client().rpc("remove_section_member", { p_section: sectionId, p_user: userId, p_ban: ban }));
}

export async function setDisplayName(sectionId: string, name: string) {
  await run(client().rpc("set_section_display_name", { p_section: sectionId, p_name: checkLength(name, LIMITS.displayName, "your display name") }));
}

export type PostInput = { title: string; due: string; dueTime?: string; note?: string };

function postRow(input: PostInput) {
  if (!ISO_DATE.test(input.due)) throw new CloudError("Pick a due date.");
  if (input.dueTime && !HHMM.test(input.dueTime)) throw new CloudError("That time doesn't look right.");
  const note = input.note?.trim() ?? "";
  if (note.length > LIMITS.postNote) throw new CloudError(`Notes can be at most ${LIMITS.postNote} characters.`);
  return {
    title: checkLength(input.title, LIMITS.postTitle, "a title"),
    due: input.due,
    due_time: input.dueTime ?? null,
    note: note || null,
  };
}

export async function addPost(sectionId: string, userId: string, input: PostInput) {
  await run(client().from("section_posts").insert({ ...postRow(input), section_id: sectionId, author_id: userId }));
}

export async function updatePost(postId: string, input: PostInput) {
  await run(client().from("section_posts").update(postRow(input)).eq("id", postId));
}

export async function deletePost(postId: string) {
  await run(client().from("section_posts").delete().eq("id", postId));
}

// --- Check-offs and comments ------------------------------------------------------------

export async function setPostDone(postId: string, userId: string, done: boolean) {
  const table = client().from("section_post_marks");
  if (done) await run(table.upsert({ post_id: postId, user_id: userId }, { onConflict: "post_id,user_id", ignoreDuplicates: true }));
  else await run(table.delete().eq("post_id", postId).eq("user_id", userId));
}

export type PostComment = { id: string; postId: string; authorId: string; body: string; createdAt: string };

export async function listComments(postId: string): Promise<PostComment[]> {
  const rows = await optionalRows(
    client().from("section_post_comments").select("id,post_id,author_id,body,created_at").eq("post_id", postId).order("created_at").limit(200)
  );
  return rows.flatMap((r) =>
    typeof r.body === "string"
      ? [{ id: String(r.id), postId: String(r.post_id), authorId: String(r.author_id), body: r.body.slice(0, 300), createdAt: String(r.created_at) }]
      : []
  );
}

export async function addComment(postId: string, userId: string, body: string) {
  await run(client().from("section_post_comments").insert({ post_id: postId, author_id: userId, body: checkLength(body, 300, "a comment") }));
}

export async function deleteComment(commentId: string) {
  await run(client().from("section_post_comments").delete().eq("id", commentId));
}

// --- Shared free times ---------------------------------------------------------------------

export async function fetchBusyTimes(sectionId: string): Promise<{ userId: string; busy: BusyBlock[]; updatedAt: string }[]> {
  const rows = await optionalRows(client().from("section_busy_times").select("user_id,busy,updated_at").eq("section_id", sectionId).limit(400));
  return rows.map((r) => ({ userId: String(r.user_id), busy: validBusy(r.busy), updatedAt: String(r.updated_at) }));
}

export async function shareBusyTimes(sectionId: string, userId: string, busy: BusyBlock[]) {
  await run(
    client()
      .from("section_busy_times")
      .upsert({ section_id: sectionId, user_id: userId, busy: busy.slice(0, MAX_BUSY_BLOCKS) }, { onConflict: "section_id,user_id" })
  );
}

export async function stopSharingBusyTimes(sectionId: string, userId: string) {
  await run(client().from("section_busy_times").delete().eq("section_id", sectionId).eq("user_id", userId));
}

// --- Friend activity -------------------------------------------------------------------------

/** Activity from people in your sections and people you've shared courses with (the database decides who). */
export async function fetchFriendActivity(me: string): Promise<FriendActivity[]> {
  const rows = await optionalRows(
    client().from("user_activity").select("user_id,display_name,status,title,course_code,since").neq("user_id", me).order("since", { ascending: false }).limit(300)
  );
  return rows.flatMap((r) => {
    const f = validateActivityRow(r);
    return f ? [f] : [];
  });
}

export async function publishActivity(userId: string, name: string, activity: MyActivity) {
  const displayName = checkLength(name, LIMITS.displayName, "your name");
  await run(
    client()
      .from("user_activity")
      .upsert(
        {
          user_id: userId,
          display_name: displayName,
          status: activity.status,
          title: activity.title.slice(0, LIMITS.postTitle),
          course_code: activity.courseCode?.slice(0, LIMITS.courseCode) ?? null,
          since: new Date(activity.since).toISOString(),
        },
        { onConflict: "user_id" }
      )
  );
}

export async function clearActivity(userId: string) {
  await run(client().from("user_activity").delete().eq("user_id", userId));
}

// --- Shared notes ----------------------------------------------------------------------------

export async function publishNotes(input: { sectionId: string; userId: string; title: string; notes: SharedNote[]; id?: string }) {
  const title = checkLength(input.title, 80, "a title");
  if (!input.notes.length) throw new CloudError("There are no text notes or to-do lists there to share.");
  const table = client().from("section_shared_notes");
  if (input.id) await run(table.update({ title, notes: input.notes }).eq("id", input.id));
  else await run(table.insert({ section_id: input.sectionId, owner_id: input.userId, title, notes: input.notes }));
}

export async function deleteSharedNotes(id: string) {
  await run(client().from("section_shared_notes").delete().eq("id", id));
}

// --- Public deadlines page -------------------------------------------------------------------

export async function setSectionPublic(sectionId: string, enabled: boolean): Promise<string | null> {
  return (await run(client().rpc("set_section_public", { p_section: sectionId, p_enabled: enabled }))) as string | null;
}

export type PublicSection = { name: string; courseCode: string | null; posts: { title: string; due: string; dueTime: string | null }[] };

/** Works signed out: anyone with the public code sees titles and due dates. */
export async function fetchPublicSection(code: string): Promise<PublicSection | null> {
  const clean = cleanCode(code);
  if (!isValidCode(clean)) return null;
  const data = await run(client().rpc("get_public_section", { p_code: clean }));
  if (!data || typeof data !== "object") return null;
  const o = data as Record<string, unknown>;
  const name = str(o.name, LIMITS.sectionName);
  if (!name) return null;
  const posts = (Array.isArray(o.posts) ? o.posts : []).slice(0, 100).flatMap((p) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const title = str(r.title, LIMITS.postTitle);
    return title && typeof r.due === "string" && ISO_DATE.test(r.due)
      ? [{ title, due: r.due, dueTime: typeof r.due_time === "string" && HHMM.test(r.due_time) ? r.due_time : null }]
      : [];
  });
  return { name, courseCode: str(o.course_code, LIMITS.courseCode) ?? null, posts };
}

// --- Calendar links kept in sync by the server -------------------------------------------

export type CalendarFeed = {
  id: string;
  url: string;
  label: string | null;
  lastCheckedAt: string | null;
  lastStatus: "ok" | "error" | null;
  lastError: string | null;
  importedCount: number;
};

export async function listFeeds(): Promise<CalendarFeed[]> {
  const rows = await optionalRows(
    client().from("calendar_feeds").select("id,url,label,last_checked_at,last_status,last_error,imported_count").order("created_at").limit(10)
  );
  return rows.map((r) => ({
    id: String(r.id),
    url: String(r.url),
    label: typeof r.label === "string" ? r.label : null,
    lastCheckedAt: typeof r.last_checked_at === "string" ? r.last_checked_at : null,
    lastStatus: r.last_status === "ok" || r.last_status === "error" ? r.last_status : null,
    lastError: typeof r.last_error === "string" ? r.last_error : null,
    importedCount: typeof r.imported_count === "number" ? r.imported_count : 0,
  }));
}

/** Normalizes webcal:// to https:// and rejects anything that isn't a plain https link. */
export function cleanFeedUrl(raw: string): string {
  const url = raw.trim().replace(/^webcal:\/\//i, "https://");
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new CloudError("Paste the full calendar link, starting with https:// or webcal://.");
  }
  if (parsed.protocol !== "https:") throw new CloudError("Only https:// (or webcal://) calendar links can be kept in sync.");
  if ((parsed.port && parsed.port !== "443") || parsed.username || parsed.password) throw new CloudError("That link can't be used.");
  if (url.length > 2000) throw new CloudError("That link is too long.");
  return url;
}

export async function addFeed(userId: string, rawUrl: string, label: string) {
  const url = cleanFeedUrl(rawUrl);
  const clean = label.trim().slice(0, 80);
  const { error } = await client().from("calendar_feeds").insert({ user_id: userId, url, label: clean || null });
  if (error?.code === "23505") throw new CloudError("That link is already kept in sync.");
  if (error) throw new CloudError(friendlyCloudError(error));
}

export async function removeFeed(id: string) {
  await run(client().from("calendar_feeds").delete().eq("id", id));
}

/** Calendar links carry a private token: show only the site. */
export function describeFeedUrl(url: string): string {
  try {
    return new URL(url).hostname;
  } catch {
    return "Calendar link";
  }
}

// --- Delete account ------------------------------------------------------------------

/**
 * Re-checks the password (the database also requires a sign-in within the
 * last 10 minutes), deletes the user's files, then the account and all rows.
 */
export async function deleteAccount(email: string, password: string, userId: string): Promise<void> {
  const db = client();
  const { error: authError } = await db.auth.signInWithPassword({ email, password });
  if (authError) {
    throw new CloudError(/invalid login/i.test(authError.message) ? "That password isn't right." : friendlyCloudError(authError));
  }
  try {
    await removeAllFiles(userId);
  } catch (e) {
    throw new CloudError(`Couldn't delete your files: ${friendlyCloudError(e)}`);
  }
  await run(db.rpc("delete_my_account"));
  await db.auth.signOut({ scope: "local" });
}
