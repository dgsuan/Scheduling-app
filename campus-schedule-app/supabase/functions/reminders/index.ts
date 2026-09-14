// Edge Function: send due class and task reminders as web push
// notifications, so they arrive even when the app is closed.
// Called every minute by pg_cron (supabase/setup/schedule_jobs.sql) with the
// shared x-cron-secret header; anything else gets 403.
//
// Secrets (npx supabase secrets set …): CRON_SECRET, VAPID_PUBLIC_KEY,
// VAPID_PRIVATE_KEY, VAPID_SUBJECT (e.g. mailto:you@example.com).
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "npm:@supabase/supabase-js@2";
import webpush from "npm:web-push@3.6.7";

import { safeEqual, serviceKey } from "../_shared/http.ts";
import { remindersForUser, type ItemRow } from "../_shared/jobs.ts";

const env = (name: string) => Deno.env.get(name) ?? "";

webpush.setVapidDetails(env("VAPID_SUBJECT") || "mailto:admin@example.com", env("VAPID_PUBLIC_KEY"), env("VAPID_PRIVATE_KEY"));

type Subscription = { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; tz_offset_min: number };

Deno.serve(async (req) => {
  if (req.method !== "POST" || !safeEqual(req.headers.get("x-cron-secret") ?? "", env("CRON_SECRET"))) {
    return new Response("Forbidden", { status: 403 });
  }
  const db = createClient(env("SUPABASE_URL"), serviceKey((n) => Deno.env.get(n)), { auth: { persistSession: false } });

  const { data: subs, error } = await db.from("push_subscriptions").select("id,user_id,endpoint,p256dh,auth,tz_offset_min").limit(5000);
  if (error) return Response.json({ error: error.message }, { status: 500 });

  const byUser = new Map<string, Subscription[]>();
  for (const s of (subs ?? []) as Subscription[]) byUser.set(s.user_id, [...(byUser.get(s.user_id) ?? []), s]);

  let sent = 0;
  let removed = 0;
  for (const [userId, devices] of byUser) {
    const { data: rows } = await db
      .from("items")
      .select("collection,id,data")
      .eq("user_id", userId)
      .eq("deleted", false)
      .in("collection", ["course", "task", "cancellation", "setting"])
      .limit(20000);
    const due = remindersForUser((rows ?? []) as ItemRow[], Date.now(), devices[0].tz_offset_min);

    for (const reminder of due) {
      // Claim the reminder first, so overlapping runs never send it twice.
      const { data: claimed } = await db
        .from("sent_reminders")
        .insert({ user_id: userId, reminder_id: reminder.id.slice(0, 200) })
        .select("reminder_id");
      if (!claimed?.length) continue;

      const payload = JSON.stringify({
        title: reminder.title,
        body: reminder.body,
        tag: reminder.id,
        path: reminder.kind === "task" ? "tasks" : "",
      });
      await Promise.all(
        devices.map(async (device) => {
          try {
            await webpush.sendNotification({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } }, payload, { TTL: 600 });
            sent++;
          } catch (e) {
            const status = (e as { statusCode?: number }).statusCode;
            // The browser unsubscribed or the subscription expired.
            if (status === 404 || status === 410) {
              await db.from("push_subscriptions").delete().eq("id", device.id);
              removed++;
            }
          }
        })
      );
    }
  }

  await db
    .from("sent_reminders")
    .delete()
    .lt("sent_at", new Date(Date.now() - 3 * 86_400_000).toISOString());

  return Response.json({ users: byUser.size, sent, removed });
});
