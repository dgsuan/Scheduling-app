// Edge Function: refresh saved calendar links (e.g. UVLE's export link) and
// add new or changed deadlines and events to each person's synced data, the
// same way Import does in the app. Called every 30 minutes by pg_cron with
// the shared x-cron-secret header; anything else gets 403.
//
// Secrets: CRON_SECRET. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided.

import { createClient } from "npm:@supabase/supabase-js@2";

import { safeEqual, safeFetchText, serviceKey } from "../_shared/http.ts";
import { planFeedImport, type ItemRow } from "../_shared/jobs.ts";

const env = (name: string) => Deno.env.get(name) ?? "";

/** Feeds per run, and how recently a feed may have been checked to be skipped. */
const BATCH = 40;
const MIN_AGE_MS = 25 * 60_000;

type Feed = { id: string; user_id: string; url: string };

Deno.serve(async (req) => {
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const db = createClient(env("SUPABASE_URL"), serviceKey((n) => Deno.env.get(n)), { auth: { persistSession: false } });

  const cutoff = new Date(Date.now() - MIN_AGE_MS).toISOString();
  const { data: feeds, error } = await db
    .from("calendar_feeds")
    .select("id,user_id,url")
    .or(`last_checked_at.is.null,last_checked_at.lt.${cutoff}`)
    .order("last_checked_at", { ascending: true, nullsFirst: true })
    .limit(BATCH);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  let ok = 0;
  let failed = 0;
  for (const feed of (feeds ?? []) as Feed[]) {
    try {
      const text = await safeFetchText(feed.url);
      const { data: rows, error: rowsError } = await db
        .from("items")
        .select("collection,id,data")
        .eq("user_id", feed.user_id)
        .eq("deleted", false)
        .in("collection", ["task", "event", "course"])
        .limit(20000);
      if (rowsError) throw new Error(rowsError.message);

      const changes = planFeedImport(text, (rows ?? []) as ItemRow[], Date.now());
      if (changes.error) throw new Error(changes.error);

      const upserts = [
        ...changes.tasks.map((t) => ({ collection: "task", id: t.id, data: t })),
        ...changes.events.map((e) => ({ collection: "event", id: e.id, data: e })),
      ].map((r) => ({ ...r, user_id: feed.user_id, parent: null, deleted: false, device_id: "server:calendar-feed" }));
      for (let i = 0; i < upserts.length; i += 200) {
        const { error: writeError } = await db.from("items").upsert(upserts.slice(i, i + 200), { onConflict: "user_id,collection,id" });
        if (writeError) throw new Error(writeError.message);
      }

      await db
        .from("calendar_feeds")
        .update({ last_checked_at: new Date().toISOString(), last_status: "ok", last_error: null, imported_count: upserts.length })
        .eq("id", feed.id);
      ok++;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      await db
        .from("calendar_feeds")
        .update({ last_checked_at: new Date().toISOString(), last_status: "error", last_error: message.slice(0, 300) })
        .eq("id", feed.id);
      failed++;
    }
  }
  return Response.json({ checked: (feeds ?? []).length, ok, failed });
});
