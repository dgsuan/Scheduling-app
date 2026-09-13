import { Platform } from "react-native";

import type { Course, Meeting, Weekday } from "@/context/store";
import { removeAllFiles } from "@/lib/cloudFiles";
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
  if (["PGRST202", "PGRST205", "42883", "42P01"].includes(code) || /could not find the (function|table)/i.test(message))
    return "This needs a database update: run supabase/migrations/0002 in the Supabase SQL Editor.";
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

export function inviteLink(kind: "course" | "section", code: string): string | null {
  const base = appBaseUrl();
  if (!base) return null;
  return kind === "course" ? `${base}courses?course=${code}` : `${base}tasks?join=${code}`;
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

export type Section = { id: string; ownerId: string; name: string; courseCode: string | null; inviteCode: string; createdAt: string };
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

export type SectionData = { sections: Section[]; members: SectionMember[]; posts: SectionPost[] };

export async function fetchSectionData(): Promise<SectionData> {
  const db = client();
  const sectionRows = (await run(db.from("sections").select("id,owner_id,name,course_code,invite_code,created_at").order("created_at"))) as Record<
    string,
    unknown
  >[];
  const sections: Section[] = (sectionRows ?? []).flatMap((r) =>
    typeof r.id === "string" && typeof r.name === "string" && typeof r.invite_code === "string"
      ? [
          {
            id: r.id,
            ownerId: String(r.owner_id),
            name: r.name.slice(0, LIMITS.sectionName),
            courseCode: typeof r.course_code === "string" ? r.course_code.slice(0, LIMITS.courseCode) : null,
            inviteCode: r.invite_code,
            createdAt: String(r.created_at),
          },
        ]
      : []
  );
  if (!sections.length) return { sections, members: [], posts: [] };
  const ids = sections.map((s) => s.id);
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
  return { sections, members, posts };
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
