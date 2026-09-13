import { router } from "expo-router";
import { Copy, Link2 } from "lucide-react-native";
import { useEffect, useState } from "react";
import { View } from "react-native";

import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { colors } from "@/constants/theme";
import { useAuth } from "@/context/auth";
import { useCourses, type Course, type Meeting } from "@/context/store";
import {
  cleanCode,
  copyText,
  formatCode,
  inviteLink,
  isValidCode,
  listMyShares,
  openSharedCourse,
  shareCourse,
  stopSharing,
  type MyShare,
  type SharedCourse,
} from "@/lib/cloud";
import { formatRange, WEEKDAY_SHORT } from "@/lib/schedule";

// Share a course by code or link, and add one a classmate shared. Only the
// course details and meeting times travel; notes, tasks and grades never do.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));
const sameCourse = (a: { code: string; section?: string }, b: { code: string; section?: string }) =>
  a.code.replace(/\s+/g, " ").trim().toUpperCase() === b.code.replace(/\s+/g, " ").trim().toUpperCase() &&
  (a.section ?? "").trim().toUpperCase() === (b.section ?? "").trim().toUpperCase();

export function meetingLine(m: Meeting): string {
  const days = [...m.days]
    .sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7))
    .map((d) => WEEKDAY_SHORT[d])
    .join(" / ");
  return `${days} · ${formatRange(m.start, m.end)}${m.room ? ` · ${m.room}` : ""}`;
}

export function SignInFirst({ what, onClose }: { what: string; onClose: () => void }) {
  return (
    <View className="bg-muted/60 gap-3 rounded-xl p-4">
      <Text className="text-sm leading-5">Sign in first — {what} needs an account.</Text>
      <Button
        className="self-start"
        onPress={() => {
          onClose();
          router.navigate("/settings");
        }}
      >
        <Text>Go to Settings</Text>
      </Button>
    </View>
  );
}

export function CodeBox({ code, kind, label }: { code: string; kind: "course" | "section"; label: string }) {
  const { toast } = useToast();
  const link = inviteLink(kind, code);
  return (
    <View className="bg-muted/60 gap-2 rounded-xl p-3">
      <Text className="text-muted-foreground text-xs">{label}</Text>
      <Text selectable className="font-display text-2xl font-semibold tracking-widest">
        {formatCode(code)}
      </Text>
      <View className="flex-row flex-wrap gap-1.5">
        <Button
          size="sm"
          variant="outline"
          onPress={async () => toast({ message: (await copyText(formatCode(code))) ? "Code copied" : "Couldn't copy — select the code instead" })}
        >
          <Icon as={Copy} size={14} className="text-foreground" />
          <Text>Copy code</Text>
        </Button>
        {link ? (
          <Button
            size="sm"
            variant="outline"
            onPress={async () => toast({ message: (await copyText(link)) ? "Link copied" : "Couldn't copy the link" })}
          >
            <Icon as={Link2} size={14} className="text-foreground" />
            <Text>Copy link</Text>
          </Button>
        ) : null}
      </View>
    </View>
  );
}

export function ShareCourseDialog({ course, onClose }: { course: Course | null; onClose: () => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const [shares, setShares] = useState<MyShare[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!course || !user) return;
    let cancelled = false;
    setShares(null);
    setError(null);
    listMyShares()
      .then((all) => !cancelled && setShares(all.filter((s) => sameCourse({ code: s.courseCode, section: s.section }, course))))
      .catch((e) => {
        if (cancelled) return;
        setShares([]);
        setError(message(e));
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [course?.id, user?.id]);

  const create = async () => {
    if (!course) return;
    setBusy(true);
    setError(null);
    try {
      const code = await shareCourse(course);
      setShares((prev) => [{ code, courseCode: course.code, section: course.section, createdAt: new Date().toISOString(), uses: 0 }, ...(prev ?? [])]);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const stop = async (code: string) => {
    setError(null);
    try {
      await stopSharing(code);
      setShares((prev) => prev?.filter((s) => s.code !== code) ?? null);
      toast({ message: "That code no longer works" });
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <Dialog open={!!course} onOpenChange={(o) => !o && onClose()}>
      {course ? (
        <DialogContent className="gap-4 p-5 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Share {course.code}</DialogTitle>
            <DialogDescription>
              Classmates enter the code (or open the link) to add this course with its section, instructor, rooms and meeting times.
              Your notes, tasks and grades are never shared.
            </DialogDescription>
          </DialogHeader>
          {!user ? (
            <SignInFirst what="sharing a course" onClose={onClose} />
          ) : shares === null ? (
            <Text className="text-muted-foreground text-sm">Loading…</Text>
          ) : shares.length ? (
            shares.slice(0, 3).map((s) => (
              <View key={s.code} className="gap-1">
                <CodeBox code={s.code} kind="course" label="Share code" />
                <View className="flex-row items-center justify-between px-1">
                  <Text className="text-muted-foreground text-xs">
                    {s.uses ? `Opened ${s.uses} time${s.uses === 1 ? "" : "s"}` : "Not used yet"}
                  </Text>
                  <Button size="sm" variant="ghost" onPress={() => stop(s.code)}>
                    <Text className="text-destructive">Stop sharing</Text>
                  </Button>
                </View>
              </View>
            ))
          ) : (
            <Button onPress={create} disabled={busy} className="self-start">
              <Text>{busy ? "Creating…" : "Create share code"}</Text>
            </Button>
          )}
          {error ? (
            <Text className="text-destructive text-sm" role="alert">
              {error}
            </Text>
          ) : null}
          <Text className="text-muted-foreground text-xs leading-4">
            A code shares the course as it is right now — later edits aren&apos;t sent. Stop sharing whenever you like.
          </Text>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function AddSharedCourseDialog({
  open,
  initialCode,
  onClose,
}: {
  open: boolean;
  initialCode?: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const { courses, addCourse, updateCourse } = useCourses();
  const { toast } = useToast();
  const [code, setCode] = useState("");
  const [found, setFound] = useState<SharedCourse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lookup = async (raw: string) => {
    const clean = cleanCode(raw);
    setError(null);
    setFound(null);
    if (!isValidCode(clean)) {
      setError("Share codes are 10 letters and numbers, like ABCDE-FGH23.");
      return;
    }
    setBusy(true);
    try {
      const course = await openSharedCourse(clean);
      if (course) setFound(course);
      else setError("No course found for that code. It may have been stopped — ask for a new one.");
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    setCode(initialCode ?? "");
    setFound(null);
    setError(null);
    if (initialCode && user) void lookup(initialCode);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialCode, user?.id]);

  const match = found ? courses.find((c) => sameCourse(c, found)) : undefined;

  const add = () => {
    if (!found) return;
    addCourse({ ...found, color: found.color ?? colors.courseColors[courses.length % colors.courseColors.length] });
    toast({ message: `${found.code} added`, description: `${found.meetings.length} meeting time${found.meetings.length === 1 ? "" : "s"}` });
    onClose();
  };

  const update = () => {
    if (!found || !match) return;
    updateCourse(match.id, {
      meetings: found.meetings,
      title: found.title ?? match.title,
      instructor: found.instructor ?? match.instructor,
      units: found.units ?? match.units,
    });
    toast({ message: `${match.code} updated`, description: "Meeting times now match the shared course." });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="gap-4 p-5 sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add a shared course</DialogTitle>
          <DialogDescription>Enter the code a classmate shared to add their course and meeting times.</DialogDescription>
        </DialogHeader>
        {!user ? (
          <SignInFirst what="adding a shared course" onClose={onClose} />
        ) : (
          <>
            <View className="flex-row items-center gap-2">
              <Input
                value={code}
                onChangeText={setCode}
                onSubmitEditing={() => lookup(code)}
                placeholder="ABCDE-FGH23"
                autoCapitalize="characters"
                autoCorrect={false}
                maxLength={16}
                accessibilityLabel="Share code"
                className="flex-1"
              />
              <Button variant="outline" onPress={() => lookup(code)} disabled={busy || !code.trim()}>
                <Text>{busy ? "Looking…" : "Find"}</Text>
              </Button>
            </View>
            {error ? (
              <Text className="text-destructive text-sm" role="alert">
                {error}
              </Text>
            ) : null}
            {found ? (
              <View className="border-border gap-1 rounded-xl border p-3">
                <Text className="text-[15px] font-semibold">
                  {found.code}
                  {found.section ? ` (${found.section})` : ""}
                </Text>
                {found.title ? <Text className="text-sm">{found.title}</Text> : null}
                {found.instructor ? <Text className="text-muted-foreground text-sm">{found.instructor}</Text> : null}
                {found.meetings.length ? (
                  found.meetings.map((m, i) => (
                    <Text key={i} className="text-muted-foreground text-[13px]">
                      {meetingLine(m)}
                    </Text>
                  ))
                ) : (
                  <Text className="text-muted-foreground text-[13px]">No meeting times</Text>
                )}
              </View>
            ) : null}
            {found && match ? (
              <View className="gap-2">
                <Text className="text-sm leading-5">
                  You already have {match.code}
                  {match.section ? ` (${match.section})` : ""}. Update its meeting times, or add this as a separate course?
                </Text>
                <View className="flex-row flex-wrap gap-2">
                  <Button onPress={update}>
                    <Text>Update times</Text>
                  </Button>
                  <Button variant="outline" onPress={add}>
                    <Text>Add as new</Text>
                  </Button>
                </View>
              </View>
            ) : found ? (
              <Button onPress={add} className="self-start">
                <Text>Add course</Text>
              </Button>
            ) : null}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
