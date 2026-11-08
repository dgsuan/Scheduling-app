import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { ConfirmDialog } from "@/components/ConfirmDialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { currentZone, type HabitData } from "@/lib/habits";
import { habitReport } from "@/lib/habitReports";
import { supabase } from "@/lib/supabase";

export function HabitGrowth({ data }: { data: HabitData }) {
  const { user } = useAuth();
  const [tool, setTool] = useState<"coach" | "circles" | null>(null);
  return <View className="gap-3">
    <Text className="font-semibold">A little extra support</Text>
    <Text className="text-muted-foreground text-sm">Optional tools. Your personal habit history stays private unless you choose to share a summary.</Text>
    <View className="flex-row flex-wrap gap-2"><Button variant="outline" accessibilityState={{ expanded: tool === "coach" }} onPress={() => setTool(tool === "coach" ? null : "coach")}><Text>Coaching</Text></Button><Button variant="outline" accessibilityState={{ expanded: tool === "circles" }} onPress={() => setTool(tool === "circles" ? null : "circles")}><Text>Accountability circle</Text></Button></View>
    {tool && !user && <Text>Sign in through Settings → Account & sync to use {tool === "coach" ? "coaching" : "circles"}.</Text>}
    {user && tool === "coach" && <Coach key={`coach:${user.id}`} data={data} />}
    {user && tool === "circles" && <Circles key={`circles:${user.id}`} />}
  </View>;
}

function Coach({ data }: { data: HabitData }) {
  const [answer, setAnswer] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const alive = useRef(true), running = useRef(false);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);
  const summary = habitReport(data, 30, Date.now()).slice(0, 50).map(({ opportunities, completed }) => ({ opportunities, completed }));
  const ask = async () => {
    if (!supabase || running.current) return;
    running.current = true; setBusy(true); setError(""); setAnswer("");
    try {
      const result = await supabase.functions.invoke("habit-coach", { body: { consent: true, summary } });
      if (!alive.current) return;
      if (result.error || typeof result.data?.answer !== "string") {
        let message = result.data?.error;
        try { message = message ?? (await result.error?.context?.json())?.error; } catch { /* Network errors may have no response. */ }
        throw new Error(typeof message === "string" ? message : "Coaching isn't available right now. It may still need setup, or your connection may be offline.");
      }
      setAnswer(result.data.answer);
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Please try again later."); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  return <View className="bg-card border-border gap-3 rounded-xl border p-5">
    <Text className="font-semibold">A small next step</Text>
    <Text className="text-muted-foreground text-sm">When you ask, completion counts from the last 30 days for up to 50 habits are sent to OpenAI. Names, notes, moods, dates of individual entries and account details are excluded. Suggestions never change your habits automatically.</Text>
    <Text className="text-sm">Summary to share: {summary.length} habits · {summary.reduce((n, r) => n + r.completed, 0)} completed out of {summary.reduce((n, r) => n + r.opportunities, 0)} closed goals.</Text>
    <Button className="self-start" disabled={busy || !summary.some(r => r.opportunities > 0)} onPress={() => void ask()}><Text>{busy ? "Thinking…" : "Share these counts & ask"}</Text></Button>
    {!summary.some(r => r.opportunities > 0) && <Text className="text-muted-foreground text-sm">Come back after a few scheduled days to give the coach something to work with.</Text>}
    {!!error && <Text accessibilityLiveRegion="polite" className="text-destructive">{error}</Text>}
    {!!answer && <><Text accessibilityLiveRegion="polite">{answer}</Text><Text className="text-muted-foreground text-xs">AI suggestion · Choose what fits your life. Nothing has been changed.</Text></>}
  </View>;
}

type CircleSummary = { id: string; title: string; owner: boolean };
type Circle = CircleSummary & { invite: string | null; day: string; members: { name: string; me: boolean; today: boolean; days: number }[] };
function Circles() {
  const [list, setList] = useState<CircleSummary[]>([]);
  const [circle, setCircle] = useState<Circle | null>(null);
  const [mode, setMode] = useState<"list" | "create" | "join">("list");
  const [name, setName] = useState("");
  const [title, setTitle] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [leave, setLeave] = useState(false);
  const alive = useRef(true), running = useRef(false);
  const act = async (action: string, id?: string) => {
    if (!supabase || running.current) return;
    running.current = true; setBusy(true); setError("");
    try {
      const { data, error: failure } = await supabase.rpc("habit_circle_action", { p_action: action, p_id: id ?? circle?.id ?? null, p_code: code.trim(), p_name: name.trim(), p_title: title.trim(), p_zone: currentZone() });
      if (!alive.current) return;
      if (failure) throw new Error(failure.code === "PGRST202" ? "Circles aren't enabled yet. The app owner needs to finish setup." : failure.message);
      if (action === "list") { setList(data ?? []); setCircle(null); }
      else if (action === "leave") { setCircle(null); setList(items => items.filter(c => c.id !== id)); }
      else { setCircle(data); setMode("list"); }
    } catch (e) { if (alive.current) setError(e instanceof Error ? e.message : "Couldn't connect. Please try again."); }
    finally { running.current = false; if (alive.current) setBusy(false); }
  };
  useEffect(() => { alive.current = true; void act("list"); return () => { alive.current = false; }; }, []);
  const me = circle?.members.find(m => m.me);
  return <View className="bg-card border-border gap-3 rounded-xl border p-5">
    <Text className="font-semibold">{circle?.title ?? "Your accountability circles"}</Text>
    <Text className="text-muted-foreground text-sm">A small invitation-only space to encourage each other. Members see your chosen display name and the check-ins you explicitly share here. Personal habits, notes and moods are never included.</Text>
    {!!error && <Text className="text-destructive" accessibilityLiveRegion="polite">{error}</Text>}
    {busy && <Text accessibilityLiveRegion="polite">Connecting…</Text>}
    {circle ? <>
      <Text className="text-muted-foreground text-sm">Today: {circle.day} · {circle.members.filter(m => m.today).length} of {circle.members.length} people checked in</Text>
      <Button disabled={busy} onPress={() => void act(me?.today ? "undo" : "check")}><Text>{me?.today ? "Undo my shared check-in" : "Share that I showed up today"}</Text></Button>
      {circle.members.map((m, i) => <View key={i} className="flex-row justify-between gap-2"><Text className="flex-1">{m.name}{m.me ? " (you)" : ""}</Text><Text>{m.today ? "✓ Here today" : `${m.days} days shared`}</Text></View>)}
      {circle.invite && <><Text className="text-sm">Invite code · Share only with people you want in this circle.</Text><Text selectable className="text-sm">{circle.invite}</Text><Button size="sm" variant="ghost" className="self-start" disabled={busy} onPress={() => void act("rotate")}><Text>Replace invite code</Text></Button></>}
      <View className="flex-row flex-wrap gap-2"><Button variant="outline" disabled={busy} onPress={() => void act("detail")}><Text>Refresh</Text></Button><Button variant="ghost" disabled={busy} onPress={() => void act("list")}><Text>All circles</Text></Button><Button variant="ghost" disabled={busy} onPress={() => setLeave(true)}><Text>{circle.owner ? "Delete circle" : "Leave circle"}</Text></Button></View>
    </> : mode === "list" ? <>
      {list.map(c => <Button key={c.id} variant="outline" disabled={busy} onPress={() => void act("detail", c.id)}><Text>{c.title}</Text></Button>)}
      {!list.length && !busy && !error && <Text>No circles yet. Invite someone when you're ready.</Text>}
      <View className="flex-row flex-wrap gap-2"><Button variant="outline" disabled={busy} onPress={() => setMode("create")}><Text>Create circle</Text></Button><Button variant="outline" disabled={busy} onPress={() => setMode("join")}><Text>Join with code</Text></Button>{!!error && <Button variant="ghost" disabled={busy} onPress={() => void act("list")}><Text>Retry</Text></Button>}</View>
    </> : <>
      <Input accessibilityLabel="Display name for circle members" maxLength={40} placeholder="Display name for circle members" value={name} onChangeText={setName} />
      {mode === "create" ? <Input accessibilityLabel="Circle name" maxLength={100} placeholder="e.g. Small steps together" value={title} onChangeText={setTitle} /> : <Input accessibilityLabel="Invite code" autoCapitalize="none" placeholder="Paste an invite code" value={code} onChangeText={setCode} />}
      <Button disabled={busy || !name.trim() || !(mode === "create" ? title.trim() : code.trim())} onPress={() => void act(mode)}><Text>{mode === "create" ? "Create with this display name" : "Join & share this display name"}</Text></Button><Button variant="ghost" disabled={busy} onPress={() => setMode("list")}><Text>Cancel</Text></Button>
    </>}
    <ConfirmDialog open={leave} onOpenChange={setLeave} title={circle?.owner ? "Delete this circle?" : "Leave this circle?"} description={circle?.owner ? "This removes the circle and its shared check-ins for everyone. Personal habit records are kept." : "Your shared check-ins will be removed from this circle. Personal habit records are kept."} onConfirm={() => { setLeave(false); void act("leave", circle?.id); }} />
  </View>;
}
