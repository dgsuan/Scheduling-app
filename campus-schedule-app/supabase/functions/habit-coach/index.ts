import { createClient } from "npm:@supabase/supabase-js@2";
import { serviceKey } from "../_shared/http.ts";

const headers = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info", "Access-Control-Allow-Methods": "POST, OPTIONS", "Cache-Control": "no-store" };
const reply = (body: unknown, status = 200) => Response.json(body, { status, headers });

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response(null, { headers });
  if (req.method !== "POST") return reply({ error: "Use POST." }, 405);
  try {
    const authorization = req.headers.get("authorization") ?? "";
    const token = authorization.replace(/^Bearer\s+/i, "");
    const url = Deno.env.get("SUPABASE_URL") ?? "";
    const key = serviceKey(n => Deno.env.get(n));
    const auth = createClient(url, key, { auth: { persistSession: false } });
    const { data: { user }, error: authError } = await auth.auth.getUser(token);
    if (authError || !user) return reply({ error: "Please sign in again." }, 401);
    const apiKey = Deno.env.get("OPENAI_API_KEY");
    const model = Deno.env.get("HABIT_COACH_MODEL");
    if (!apiKey || !model) return reply({ error: "Coaching isn't enabled yet. Your habits still work normally." }, 503);
    // Bounded body read, including requests without a Content-Length header.
    const reader = req.body?.getReader();
    if (!reader) return reply({ error: "Missing summary." }, 400);
    const decoder = new TextDecoder(); let text = "", size = 0;
    while (true) {
      const { value, done } = await reader.read(); if (done) break;
      size += value.byteLength;
      if (size > 8000) { await reader.cancel(); return reply({ error: "Summary is too large." }, 413); }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    const body = JSON.parse(text);
    if (body.consent !== true || !Array.isArray(body.summary) || body.summary.length > 50) return reply({ error: "Choose whether to share your summary first." }, 400);
    // Allowlist numeric summaries. Names, notes, moods, IDs and raw logs never leave this service.
    const summary = body.summary.map((row: { opportunities?: unknown; completed?: unknown }, index: number) => {
      if (!Number.isInteger(row.opportunities) || !Number.isInteger(row.completed) || Number(row.opportunities) < 0 || Number(row.opportunities) > 10000 || Number(row.completed) < 0 || Number(row.completed) > Number(row.opportunities)) throw new Error("Invalid summary");
      return { habit: index + 1, opportunities: row.opportunities, completed: row.completed };
    });
    const scoped = createClient(url, key, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } });
    const { error: limit } = await scoped.rpc("consume_habit_coach");
    if (limit) return reply({ error: "Coaching is unavailable or you've reached the request limit. Try again later." }, 429);
    const response = await fetch("https://api.openai.com/v1/responses", {
      method: "POST", signal: AbortSignal.timeout(30000),
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, store: false, max_output_tokens: 600,
        instructions: "You are a gentle habit coach. The input is anonymous counts of closed habit opportunities over 30 days. Give at most 3 short, practical suggestions in plain text, under 150 words. Never infer causes, diagnoses, personal traits or habit types from counts. When data is sparse say so. Encourage rest and small achievable steps, never shame. Do not prescribe medical, diet or exercise advice. You cannot change anything in the app. Do not claim an action was taken. Avoid invented patterns or certainty.",
        input: JSON.stringify({ days: 30, summary }) }),
    });
    if (!response.ok) { await response.body?.cancel(); return reply({ error: "The coach couldn't respond. Please try again later." }, 502); }
    const result = await response.json();
    const answer = (result.output ?? []).flatMap((item: { content?: { type: string; text?: string }[] }) => item.content ?? []).filter((part: { type: string }) => part.type === "output_text").map((part: { text?: string }) => part.text ?? "").join("\n").trim();
    if (!answer) return reply({ error: "No suggestion was returned. Please try again later." }, 502);
    return reply({ answer: answer.slice(0, 6000) });
  } catch {
    return reply({ error: "Couldn't complete that request. Please try again later." }, 400);
  }
});
