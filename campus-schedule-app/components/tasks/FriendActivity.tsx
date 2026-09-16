import type { RealtimeChannel } from "@supabase/supabase-js";
import { Activity, BookOpen, Users } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { Pressable, View } from "react-native";

import { activityName } from "@/components/ActivityEngine";
import { Checkbox } from "@/components/ui/checkbox";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { useSections } from "@/context/sections";
import { useCourses, useSettings, useTasks } from "@/context/store";
import { currentActivity, initials, timeAgo, visibleFriends, type FriendActivity as Friend } from "@/lib/activity";
import { LIMITS, fetchFriendActivity, friendlyCloudError } from "@/lib/cloud";
import { isSupabaseConfigured, supabase } from "@/lib/supabase";
import { useNow } from "@/lib/useNow";
import { cn } from "@/lib/utils";

// Spotify-style Friend activity: what classmates in your sections, and
// people you've shared a course with, are working on right now.

const REFRESH_MS = 2 * 60_000;
const AVATAR_COLORS = ["#2F7D6E", "#D0603F", "#4E6FC7", "#B7791F", "#8A5CB0", "#C45A83", "#4E8F4A", "#5A6475"];

function colorFor(id: string) {
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return AVATAR_COLORS[h % AVATAR_COLORS.length];
}

function ActivityRow({ friend, now, you }: { friend: Friend; now: number; you?: boolean }) {
  const doing = friend.status === "doing";
  const ago = timeAgo(friend.since, now);
  return (
    <View
      className="flex-row gap-3 py-2"
      accessible
      accessibilityLabel={`${friend.name}${you ? " (you)" : ""}: ${doing ? "doing" : `finished ${ago === "now" ? "just now" : `${ago} ago`}`} ${friend.title}${friend.courseCode ? `, ${friend.courseCode}` : ""}`}
    >
      <View>
        <View className="size-10 items-center justify-center rounded-full" style={{ backgroundColor: colorFor(friend.userId) }}>
          <Text className="text-[13px] font-semibold text-white">{initials(friend.name)}</Text>
        </View>
        {doing ? <View className="bg-primary border-background absolute -right-0.5 -top-0.5 size-3.5 rounded-full border-2" /> : null}
      </View>
      <View className="min-w-0 flex-1 gap-0.5">
        <View className="flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-[14px] font-semibold" numberOfLines={1}>
            {friend.name}
            {you ? <Text className="text-muted-foreground text-[12px] font-normal"> (you)</Text> : null}
          </Text>
          {doing ? (
            <Icon as={Activity} size={14} className="text-primary" />
          ) : (
            <Text className="text-muted-foreground text-[12px] tabular-nums">{ago}</Text>
          )}
        </View>
        <Text className="text-foreground/80 text-[13px]" numberOfLines={2}>
          {doing ? "" : "Finished · "}
          {friend.title}
        </Text>
        {friend.courseCode || (doing && ago !== "now") ? (
          <View className="flex-row items-center gap-1.5">
            {friend.courseCode ? <Icon as={BookOpen} size={12} className="text-muted-foreground" /> : null}
            <Text className="text-muted-foreground text-[12px]" numberOfLines={1}>
              {[friend.courseCode, doing && ago !== "now" ? `for ${ago}` : null].filter(Boolean).join(" · ")}
            </Text>
          </View>
        ) : null}
      </View>
    </View>
  );
}

export function FriendActivity({ className }: { className?: string }) {
  const { user } = useAuth();
  const { members } = useSections();
  const { settings, updateSettings } = useSettings();
  const { tasks } = useTasks();
  const { courses } = useCourses();
  const now = useNow().getTime();
  const userId = user?.id;

  const [friends, setFriends] = useState<Friend[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [nameDraft, setNameDraft] = useState(settings.activityName ?? "");
  useEffect(() => setNameDraft(settings.activityName ?? ""), [settings.activityName]);

  // Reload when your sections change: that changes whose activity you can see.
  const circleKey = members.map((m) => m.userId).sort().join(",");
  useEffect(() => {
    setFriends([]);
    setLoaded(false);
    setError(null);
    if (!supabase || !userId) return;
    const db = supabase;
    let disposed = false;
    let soonTimer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      try {
        const list = await fetchFriendActivity(userId);
        if (disposed) return;
        setFriends(list);
        setError(null);
      } catch (e) {
        if (!disposed) setError(friendlyCloudError(e));
      } finally {
        if (!disposed) setLoaded(true);
      }
    };
    void load();
    const soon = () => {
      clearTimeout(soonTimer);
      soonTimer = setTimeout(() => void load(), 600);
    };
    const channel: RealtimeChannel = db
      .channel(`activity:${userId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "user_activity" }, soon)
      .subscribe();
    const interval = setInterval(() => void load(), REFRESH_MS);
    return () => {
      disposed = true;
      clearTimeout(soonTimer);
      clearInterval(interval);
      db.removeChannel(channel);
    };
  }, [userId, circleKey]);

  const sectionName = activityName(undefined, members, userId);
  const name = activityName(settings.activityName, members, userId);
  const mine = settings.shareActivity && name ? currentActivity(tasks, courses, now) : null;
  const list = useMemo(() => visibleFriends(friends, now), [friends, now]);

  if (!isSupabaseConfigured) return null;

  return (
    <View className={cn("gap-3", className)} role="region" aria-label="Friend activity">
      <View className="flex-row items-center gap-2">
        <Icon as={Users} size={16} className="text-muted-foreground" />
        <Text className="flex-1 text-[15px] font-semibold">Friend activity</Text>
      </View>

      {!userId ? (
        <Text className="text-muted-foreground text-[13px] leading-5">
          Sign in to see what classmates are working on, and to share what you're doing.
        </Text>
      ) : (
        <>
          <Pressable
            onPress={() => updateSettings({ shareActivity: !settings.shareActivity })}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !!settings.shareActivity }}
            accessibilityLabel="Share what I'm doing"
            className="flex-row items-start gap-2.5 rounded-lg web:transition-opacity web:hover:opacity-90"
          >
            <View className="pt-0.5" pointerEvents="none">
              <Checkbox checked={!!settings.shareActivity} onCheckedChange={() => {}} className="size-4 rounded" />
            </View>
            <View className="flex-1 gap-0.5">
              <Text className="text-[13px] font-medium">Share what I'm doing</Text>
              <Text className="text-muted-foreground text-[12px] leading-4">
                Your task in Doing (or one you just finished) and its course. Seen by people in your class sections and people you've
                shared a course with. Lock a task on the board to keep it to yourself.
              </Text>
            </View>
          </Pressable>

          {settings.shareActivity ? (
            <View className="gap-1">
              <Input
                value={nameDraft}
                onChangeText={setNameDraft}
                onBlur={() => updateSettings({ activityName: nameDraft.trim().slice(0, LIMITS.displayName) || undefined })}
                onSubmitEditing={() => updateSettings({ activityName: nameDraft.trim().slice(0, LIMITS.displayName) || undefined })}
                placeholder={sectionName || "Your name"}
                maxLength={LIMITS.displayName}
                accessibilityLabel="Name friends see"
                className="h-9 text-sm"
              />
              {!name ? <Text className="text-warning text-[12px]">Add a name so friends know it's you.</Text> : null}
            </View>
          ) : null}

          {mine ? <ActivityRow friend={{ ...mine, userId, name }} now={now} you /> : null}

          {error ? <Text className="text-destructive text-[12px]">{error}</Text> : null}

          {list.length ? (
            <View>
              {list.map((f) => (
                <ActivityRow key={f.userId} friend={f} now={now} />
              ))}
            </View>
          ) : loaded && !error ? (
            <Text className="text-muted-foreground text-[13px] leading-5">
              No one's sharing yet. When classmates move a task to Doing, it shows up here.
            </Text>
          ) : null}
        </>
      )}
    </View>
  );
}
