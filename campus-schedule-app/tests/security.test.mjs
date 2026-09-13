// Attacks the live Supabase project the way a malicious signed-in user
// could (straight API calls, no app), and checks the database refuses.
// Uses two EXISTING, confirmed accounts you control — it never signs up.
//
//   $env:SEC_A_EMAIL="you@example.com"; $env:SEC_A_PASSWORD="..."
//   $env:SEC_B_EMAIL="your-second@example.com"; $env:SEC_B_PASSWORD="..."
//   node tests/security.test.mjs
//
// URL and publishable key come from .env.local (or EXPO_PUBLIC_* env vars).
// Everything it creates is cleaned up at the end.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const env = { ...process.env };
const envFile = path.join(ROOT, ".env.local");
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, "utf8").split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
    if (m && !env[m[1]]) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
const URL = env.EXPO_PUBLIC_SUPABASE_URL;
const KEY = env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const need = ["SEC_A_EMAIL", "SEC_A_PASSWORD", "SEC_B_EMAIL", "SEC_B_PASSWORD"].filter((k) => !env[k]);
if (!URL || !KEY || need.length) {
  console.error(`Missing ${[!URL && "EXPO_PUBLIC_SUPABASE_URL", !KEY && "EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY", ...need].filter(Boolean).join(", ")}.`);
  process.exit(1);
}

const results = [];
const check = (name, ok, extra = "") => results.push(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  — ${extra}` : ""}`);
const refused = (r) => !!r.error || (Array.isArray(r.data) && r.data.length === 0) || r.data == null;
const newClient = () => createClient(URL, KEY, { auth: { persistSession: false, autoRefreshToken: false } });

const anon = newClient();
const A = newClient();
const B = newClient();
const stamp = Date.now().toString(36);
const cleanup = [];

try {
  // --- Signed out ---------------------------------------------------------------
  check("Anon can call ping", !(await anon.rpc("ping")).error);
  check("Anon can't read items", refused(await anon.from("items").select("id").limit(1)));
  check("Anon can't read old user_data", refused(await anon.from("user_data").select("key").limit(1)));
  check("Anon can't share a course", !!(await anon.rpc("share_course", { p_course: { code: "X 1", meetings: [] } })).error);
  check("Anon can't delete an account", !!(await anon.rpc("delete_my_account")).error);

  const a = await A.auth.signInWithPassword({ email: env.SEC_A_EMAIL, password: env.SEC_A_PASSWORD });
  const b = await B.auth.signInWithPassword({ email: env.SEC_B_EMAIL, password: env.SEC_B_PASSWORD });
  if (a.error || b.error) throw new Error(`Sign-in failed: ${(a.error ?? b.error).message}`);
  const aId = a.data.user.id;
  const bId = b.data.user.id;

  // --- Items -----------------------------------------------------------------------
  const itemId = `sec-test-${stamp}`;
  cleanup.push(() => A.from("items").delete().eq("id", itemId));
  const own = await A.from("items").insert({ user_id: aId, collection: "task", id: itemId, data: { title: "mine" }, updated_at: "2099-01-01T00:00:00Z" }).select("updated_at");
  check("User can write their own item", !own.error, own.error?.message);
  check("Server sets updated_at (can't fake the future)", !!own.data?.[0] && own.data[0].updated_at < "2099", own.data?.[0]?.updated_at);
  check("Can't write an item as someone else", !!(await A.from("items").insert({ user_id: bId, collection: "task", id: `${itemId}-x`, data: {} })).error);
  check("Can't read someone else's items", refused(await B.from("items").select("id").eq("user_id", aId)));
  const tamper = await B.from("items").update({ data: { title: "hacked" } }).eq("user_id", aId).eq("id", itemId).select("id");
  check("Can't change someone else's item", refused(tamper));
  check("Can't delete someone else's item", refused(await B.from("items").delete().eq("user_id", aId).eq("id", itemId).select("id")));
  const big = await A.from("items").upsert({ user_id: aId, collection: "task", id: itemId, data: { blob: "x".repeat(1_100_000) } });
  check("Oversized item (>1 MB) is rejected", !!big.error, big.error?.message);
  check("Unknown collection is rejected", !!(await A.from("items").insert({ user_id: aId, collection: "evil", id: `${itemId}-c`, data: {} })).error);
  const steal = await A.from("items").update({ user_id: bId }).eq("user_id", aId).eq("id", itemId).select("id");
  check("Can't move an item to another user", refused(steal));
  const tomb = await A.from("items").upsert({ user_id: aId, collection: "task", id: itemId, data: { secret: "x" }, deleted: true }).select("data");
  check("Tombstones can't carry data", !tomb.error && JSON.stringify(tomb.data?.[0]?.data) === "{}");
  check("Old user_data is read-only", !!(await A.from("user_data").insert({ key: "tasks", value: [] })).error);
  check("Can't read usage counters", refused(await A.from("user_usage").select("*")));
  check("Can't read or reset rate limits", refused(await A.from("rate_limits").select("*")) && refused(await A.from("rate_limits").delete().eq("user_id", aId).select("*")));
  check("Can't call internal helpers", !!(await A.rpc("hit_rate_limit", { p_user: bId, p_action: "x", p_max: 1, p_window: "1 minute", p_message: "x" })).error);

  // --- Shared courses ------------------------------------------------------------
  const share = await A.rpc("share_course", {
    p_course: { code: "SEC 101", section: "T", color: "#112233", meetings: [{ days: [1, 3], start: "10:00", end: "11:30", room: "R1" }], extra: "dropped" },
  });
  check("User can share a course", !share.error && /^[A-Z2-9]{10}$/.test(share.data ?? ""), share.error?.message);
  if (share.data) cleanup.push(() => A.rpc("revoke_shared_course", { p_code: share.data }));
  const opened = await B.rpc("get_shared_course", { p_code: share.data });
  check("Classmate can open it with the code", opened.data?.code === "SEC 101");
  check("Unknown fields are stripped", opened.data && !("extra" in opened.data));
  check("Wrong code reveals nothing", (await B.rpc("get_shared_course", { p_code: "AAAAAAAAAA" })).data === null);
  check("Can't list other people's share codes", refused(await B.from("shared_courses").select("code")));
  check("Can't stop someone else's share", (await B.rpc("revoke_shared_course", { p_code: share.data })).data === false);
  const bad = await A.rpc("share_course", { p_course: { code: "X 1", title: "t".repeat(500), meetings: [] } });
  check("Oversized course fields are rejected", !!bad.error);
  const badTime = await A.rpc("share_course", { p_course: { code: "X 1", meetings: [{ days: [9], start: "25:00", end: "x" }] } });
  check("Invalid meeting times are rejected", !!badTime.error);

  // --- Sections --------------------------------------------------------------------
  const created = await A.rpc("create_section", { p_name: `Security test ${stamp}`, p_course_code: "SEC 101", p_display_name: "Tester A" });
  check("User can create a section", !created.error, created.error?.message);
  const sectionId = created.data?.id;
  const invite = created.data?.invite_code;
  if (sectionId) cleanup.push(() => A.from("sections").delete().eq("id", sectionId));
  check("Outsiders can't see the section", refused(await B.from("sections").select("id").eq("id", sectionId)));
  check("Outsiders can't read its posts", refused(await B.from("section_posts").select("id").eq("section_id", sectionId)));
  check("Outsiders can't post to it", !!(await B.from("section_posts").insert({ section_id: sectionId, author_id: bId, title: "spam", due: "2026-12-01" })).error);
  check("Outsiders can't add themselves as members", !!(await B.from("section_members").insert({ section_id: sectionId, user_id: bId, display_name: "x" })).error);
  check("Wrong invite code doesn't join", (await B.rpc("join_section", { p_code: "AAAAAAAAAA", p_display_name: "B" })).data === null);
  const joined = await B.rpc("join_section", { p_code: invite, p_display_name: "Tester B" });
  check("Classmate can join with the code", joined.data === sectionId, joined.error?.message);
  const post = await B.from("section_posts").insert({ section_id: sectionId, author_id: bId, title: "Lab 1", due: "2026-12-01" }).select("id,author_id");
  check("Members can post", !post.error, post.error?.message);
  const forged = await B.from("section_posts").insert({ section_id: sectionId, author_id: aId, title: "forged", due: "2026-12-01" });
  check("Members can't post as someone else", !!forged.error);
  const aPost = await A.from("section_posts").insert({ section_id: sectionId, author_id: aId, title: "Owner post", due: "2026-12-02" }).select("id");
  check("Members can't edit others' posts", refused(await B.from("section_posts").update({ title: "edited" }).eq("id", aPost.data?.[0]?.id).select("id")));
  check("Members can't delete others' posts", refused(await B.from("section_posts").delete().eq("id", aPost.data?.[0]?.id).select("id")));
  check("Members can't delete the section", refused(await B.from("sections").delete().eq("id", sectionId).select("id")));
  check("Members can't kick people", !!(await B.rpc("remove_section_member", { p_section: sectionId, p_user: aId, p_ban: false })).error);
  check("Members can't change the invite code", !!(await B.rpc("rotate_section_invite", { p_section: sectionId })).error);
  check("Members can't make themselves owner", !!(await B.from("section_members").update({ role: "owner" }).eq("section_id", sectionId).eq("user_id", bId)).error || refused(await B.from("section_members").select("role").eq("user_id", bId).eq("role", "owner")));
  check("Owner can delete a member's post", !refused(await A.from("section_posts").delete().eq("id", post.data?.[0]?.id).select("id")));
  check("Too-long post title is rejected", !!(await A.from("section_posts").insert({ section_id: sectionId, author_id: aId, title: "t".repeat(200), due: "2026-12-01" })).error);
  const ban = await A.rpc("remove_section_member", { p_section: sectionId, p_user: bId, p_ban: true });
  check("Owner can ban a member", !ban.error, ban.error?.message);
  check("Banned member loses access", refused(await B.from("section_posts").select("id").eq("section_id", sectionId)));
  check("Banned member can't rejoin", (await B.rpc("join_section", { p_code: invite, p_display_name: "Tester B" })).data === null);

  // --- Storage -----------------------------------------------------------------------
  const txt = new TextEncoder().encode("hello");
  const ownFile = `${aId}/sec-test-${stamp}.txt`;
  const up = await A.storage.from("user-files").upload(ownFile, txt, { contentType: "text/plain" });
  check("User can upload to their own folder", !up.error, up.error?.message);
  cleanup.push(() => A.storage.from("user-files").remove([ownFile]));
  check("Can't upload into someone else's folder", !!(await A.storage.from("user-files").upload(`${bId}/evil-${stamp}.txt`, txt, { contentType: "text/plain" })).error);
  check("Can't download someone else's file", !!(await B.storage.from("user-files").download(ownFile)).error);
  check("Disallowed file types are rejected", !!(await A.storage.from("user-files").upload(`${aId}/evil-${stamp}.html`, txt, { contentType: "text/html" })).error);
  check("Files over 5 MB are rejected", !!(await A.storage.from("user-files").upload(`${aId}/big-${stamp}.txt`, new Uint8Array(5_300_000), { contentType: "text/plain" })).error);
  check("Bucket isn't public", !!(await anon.storage.from("user-files").download(ownFile)).error);
} catch (e) {
  results.push(`ERROR ${e?.stack ?? e}`);
} finally {
  for (const fn of cleanup.reverse()) await Promise.resolve(fn()).catch(() => {});
  await Promise.all([A.auth.signOut(), B.auth.signOut()]).catch(() => {});
  console.log(results.join("\n"));
  if (results.some((r) => !r.startsWith("PASS"))) process.exitCode = 1;
}
