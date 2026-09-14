import { CircleCheck, Globe, Link2, MessageSquare, Trash2 } from "lucide-react-native";
import { useEffect, useMemo, useState } from "react";
import { View } from "react-native";

import { ChoicePopover, type Choice } from "@/components/ChoicePopover";
import { SegmentedControl } from "@/components/SegmentedControl";
import { useToast } from "@/components/Toaster";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { useSections } from "@/context/sections";
import { useAllCanvases, useCourses, type Weekday } from "@/context/store";
import {
  addComment,
  copyText,
  deleteComment,
  deleteSharedNotes,
  fetchBusyTimes,
  inviteLink,
  listComments,
  publishNotes,
  setSectionPublic,
  shareBusyTimes,
  stopSharingBusyTimes,
  type PostComment,
  type Section,
  type SectionPost,
} from "@/lib/cloud";
import { busyFromCourses, commonFreeTimes, minutesToHhmm, type BusyBlock, type FreeSlot } from "@/lib/freeTime";
import { canvasOptions } from "@/lib/noteLinks";
import { display12h, WEEKDAY_SHORT } from "@/lib/schedule";
import { snapshotNotes } from "@/lib/sharedNotes";
import { relativeTime } from "@/lib/sync";
import { cn } from "@/lib/utils";

// The social side of a class section: check-offs and comments on each
// deadline, shared free times, read-only shared notes, and the public
// deadlines link. Everything is enforced by supabase/migrations/0003.

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

function ErrorLine({ error }: { error: string | null }) {
  return error ? (
    <Text className="text-destructive text-xs leading-4" role="alert">
      {error}
    </Text>
  ) : null;
}

function PanelTitle({ children }: { children: string }) {
  return <Text className="px-1 text-[15px] font-semibold">{children}</Text>;
}

// --- Per deadline: "I submitted it" + comments ---------------------------------------

export function PostSocial({ post, nameOf, canModerate }: { post: SectionPost; nameOf: (userId: string) => string; canModerate: boolean }) {
  const s = useSections();
  const { user } = useAuth();
  const me = user?.id ?? "";
  const marks = s.marks.filter((m) => m.postId === post.id);
  const mine = marks.some((m) => m.userId === me);
  const memberCount = s.members.filter((m) => m.sectionId === post.sectionId).length;
  const [open, setOpen] = useState(false);
  const [comments, setComments] = useState<PostComment[] | null>(null);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setComments(await listComments(post.id));
    } catch (e) {
      setComments([]);
      setError(message(e));
    }
  };
  useEffect(() => {
    if (open && comments === null) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const send = async () => {
    if (!body.trim()) return;
    setBusy(true);
    setError(null);
    try {
      await addComment(post.id, me, body);
      setBody("");
      await load();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <View className="flex-row flex-wrap items-center gap-1.5">
        <Button
          size="sm"
          variant={mine ? "secondary" : "outline"}
          onPress={() => s.setSubmitted(post.id, !mine)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: mine }}
          accessibilityLabel={`I submitted ${post.title}`}
        >
          <Icon as={CircleCheck} size={14} className={mine ? "text-success" : "text-muted-foreground"} />
          <Text>{mine ? "Submitted" : "I submitted it"}</Text>
        </Button>
        <Text className="text-muted-foreground text-xs tabular-nums">
          {marks.length} of {memberCount} submitted
        </Text>
        <Button size="sm" variant="ghost" onPress={() => setOpen((v) => !v)} accessibilityState={{ expanded: open }}>
          <Icon as={MessageSquare} size={14} className="text-muted-foreground" />
          <Text className="text-muted-foreground">{open ? "Hide comments" : "Comments"}</Text>
        </Button>
      </View>
      {open ? (
        <View className="gap-2">
          {comments === null ? (
            <Text className="text-muted-foreground text-xs">Loading…</Text>
          ) : comments.length === 0 ? (
            <Text className="text-muted-foreground text-xs">No comments yet. Ask here if something&apos;s unclear.</Text>
          ) : (
            comments.map((c) => (
              <View key={c.id} className="flex-row items-start gap-2">
                <View className="flex-1 gap-0.5">
                  <Text className="text-[13px] leading-[18px]">
                    <Text className="text-[13px] font-semibold">{nameOf(c.authorId)}</Text>
                    {`  ${c.body}`}
                  </Text>
                  <Text className="text-muted-foreground text-[11px]">{relativeTime(Date.parse(c.createdAt))}</Text>
                </View>
                {c.authorId === me || canModerate ? (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    accessibilityLabel="Delete comment"
                    onPress={async () => {
                      try {
                        await deleteComment(c.id);
                        await load();
                      } catch (e) {
                        setError(message(e));
                      }
                    }}
                  >
                    <Icon as={Trash2} size={13} className="text-muted-foreground" />
                  </Button>
                ) : null}
              </View>
            ))
          )}
          <View className="flex-row items-center gap-2">
            <Input
              value={body}
              onChangeText={setBody}
              onSubmitEditing={send}
              placeholder="Add a comment"
              maxLength={300}
              accessibilityLabel={`Comment on ${post.title}`}
              className="h-9 flex-1 text-sm"
            />
            <Button size="sm" onPress={send} disabled={busy || !body.trim()}>
              <Text>Send</Text>
            </Button>
          </View>
          <ErrorLine error={error} />
        </View>
      ) : null}
    </View>
  );
}

// --- Free times ---------------------------------------------------------------------

type MinGap = "60" | "90" | "120";

export function FreeTimesPanel({ sectionId }: { sectionId: string }) {
  const { user } = useAuth();
  const me = user?.id ?? "";
  const { courses } = useCourses();
  const s = useSections();
  const { toast } = useToast();
  const [rows, setRows] = useState<{ userId: string; busy: BusyBlock[] }[] | null>(null);
  const [minGap, setMinGap] = useState<MinGap>("60");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setRows(await fetchBusyTimes(sectionId));
    } catch (e) {
      setRows([]);
      setError(message(e));
    }
  };
  useEffect(() => {
    setRows(null);
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId]);

  const memberCount = s.members.filter((m) => m.sectionId === sectionId).length;
  const sharing = rows?.some((r) => r.userId === me) ?? false;
  const byDay = useMemo(() => {
    const free = rows?.length ? commonFreeTimes(rows.map((r) => r.busy), { minMinutes: Number(minGap) }) : [];
    const map = new Map<Weekday, FreeSlot[]>();
    for (const slot of free) map.set(slot.d, [...(map.get(slot.d) ?? []), slot]);
    return map;
  }, [rows, minGap]);

  const act = async (fn: () => Promise<void>, done?: string) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
      if (done) toast({ message: done });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <PanelTitle>Free times</PanelTitle>
      <View className="border-border gap-3 rounded-xl border p-3">
        <Text className="text-muted-foreground text-[13px] leading-[18px]">
          {rows === null
            ? "Loading…"
            : rows.length
              ? `When everyone who shared is free — ${rows.length} of ${memberCount} members shared.`
              : "No one has shared their class times yet. Share yours to start finding a time for group work."}
        </Text>
        {rows?.length ? (
          <>
            <SegmentedControl
              value={minGap}
              onChange={setMinGap}
              options={[
                { value: "60", label: "1 hr+" },
                { value: "90", label: "1½ hr+" },
                { value: "120", label: "2 hr+" },
              ]}
              accessibilityLabel="Shortest free time to show"
            />
            {byDay.size ? (
              <View className="gap-1">
                {[...byDay.entries()].map(([d, slots]) => (
                  <View key={d} className="flex-row gap-3">
                    <Text className="w-10 text-[13px] font-semibold">{WEEKDAY_SHORT[d]}</Text>
                    <Text className="flex-1 text-[13px] leading-[18px] tabular-nums">
                      {slots.map((x) => `${display12h(minutesToHhmm(x.s))}–${display12h(minutesToHhmm(x.e))}`).join(",  ")}
                    </Text>
                  </View>
                ))}
              </View>
            ) : (
              <Text className="text-[13px]">No shared free time that long between 7 AM and 9 PM, Monday to Saturday.</Text>
            )}
          </>
        ) : null}
        <View className="flex-row flex-wrap gap-2">
          {sharing ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !courses.length}
                onPress={() => act(() => shareBusyTimes(sectionId, me, busyFromCourses(courses)), "Your class times are updated")}
              >
                <Text>Update my times</Text>
              </Button>
              <Button size="sm" variant="ghost" disabled={busy} onPress={() => act(() => stopSharingBusyTimes(sectionId, me), "You stopped sharing your class times")}>
                <Text className="text-muted-foreground">Stop sharing</Text>
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              disabled={busy || !courses.length}
              onPress={() => act(() => shareBusyTimes(sectionId, me, busyFromCourses(courses)), "Your class times are shared")}
            >
              <Text>Share my class times</Text>
            </Button>
          )}
        </View>
        <Text className="text-muted-foreground text-xs leading-4">
          {courses.length
            ? "Only the hours you're in class are shared — not which classes or rooms."
            : "Add your courses first: free times come from your class schedule."}
        </Text>
        <ErrorLine error={error} />
      </View>
    </View>
  );
}

// --- Shared notes -----------------------------------------------------------------------

export function SharedNotesPanel({ sectionId, isOwner, nameOf }: { sectionId: string; isOwner: boolean; nameOf: (userId: string) => string }) {
  const s = useSections();
  const { user } = useAuth();
  const me = user?.id ?? "";
  const canvases = useAllCanvases();
  const { courses } = useCourses();
  const { toast } = useToast();
  const docs = s.sharedNotes.filter((d) => d.sectionId === sectionId);
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [form, setForm] = useState<{ replaceId?: string; canvasId?: string; title: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const options = canvasOptions(canvases, courses);
  const choices: Choice<string | undefined>[] = [
    { value: undefined, label: "Pick a notebook or folder" },
    ...options.map((o) => ({ value: o.id as string | undefined, label: o.label })),
  ];
  const preview = form?.canvasId ? snapshotNotes(canvases[form.canvasId]) : null;

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await s.refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const publish = () =>
    act(async () => {
      if (!form?.canvasId || !preview) throw new Error("Pick a notebook or folder to share.");
      await publishNotes({ sectionId, userId: me, title: form.title, notes: preview.notes, id: form.replaceId });
      toast({ message: form.replaceId ? "Shared notes updated" : "Notes shared", description: "Members can read them but not change them." });
      setForm(null);
    });

  return (
    <View className="gap-2">
      <PanelTitle>Shared notes</PanelTitle>
      <View className="border-border gap-3 rounded-xl border p-3">
        {docs.length ? (
          docs.map((doc) => {
            const open = openId === doc.id;
            const mine = doc.ownerId === me;
            return (
              <View key={doc.id} className="gap-2">
                <View className="flex-row flex-wrap items-center gap-2">
                  <View className="min-w-[160px] flex-1 gap-0.5">
                    <Text className="text-sm font-medium">{doc.title}</Text>
                    <Text className="text-muted-foreground text-xs">
                      by {nameOf(doc.ownerId)} · updated {relativeTime(Date.parse(doc.updatedAt))} · {doc.notes.length} note
                      {doc.notes.length === 1 ? "" : "s"}
                    </Text>
                  </View>
                  <Button size="sm" variant="ghost" onPress={() => setOpenId(open ? null : doc.id)} accessibilityState={{ expanded: open }}>
                    <Text className="text-primary">{open ? "Hide" : "Read"}</Text>
                  </Button>
                  {mine ? (
                    <Button size="sm" variant="ghost" onPress={() => setForm({ replaceId: doc.id, title: doc.title })}>
                      <Text className="text-muted-foreground">Update</Text>
                    </Button>
                  ) : null}
                  {mine || isOwner ? (
                    <Button size="sm" variant="ghost" onPress={() => setConfirmDelete(confirmDelete === doc.id ? null : doc.id)}>
                      <Text className="text-muted-foreground">Remove</Text>
                    </Button>
                  ) : null}
                </View>
                {confirmDelete === doc.id ? (
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="text-sm">Stop sharing “{doc.title}” with the section?</Text>
                    <Button
                      size="sm"
                      variant="destructive"
                      disabled={busy}
                      onPress={() =>
                        act(async () => {
                          await deleteSharedNotes(doc.id);
                          setConfirmDelete(null);
                        })
                      }
                    >
                      <Text>Remove</Text>
                    </Button>
                  </View>
                ) : null}
                {open ? (
                  <View className="bg-muted/50 gap-2 rounded-lg p-3">
                    {doc.notes.map((n, i) =>
                      n.kind === "text" ? (
                        <Text key={i} selectable className="text-sm leading-5">
                          {n.text}
                        </Text>
                      ) : (
                        <View key={i} className="gap-0.5">
                          {n.title ? <Text className="text-sm font-semibold">{n.title}</Text> : null}
                          {n.entries.map((e, j) => (
                            <Text key={j} className={cn("text-sm leading-5", e.done && "text-muted-foreground line-through")}>
                              {e.done ? "☑" : "☐"} {e.text}
                            </Text>
                          ))}
                        </View>
                      )
                    )}
                  </View>
                ) : null}
              </View>
            );
          })
        ) : (
          <Text className="text-muted-foreground text-[13px] leading-[18px]">
            Share a notebook or folder so the section can read your reviewers and to-do lists.
          </Text>
        )}

        {form ? (
          <View className="border-border gap-2 rounded-lg border p-3">
            <Text className="text-sm font-medium">{form.replaceId ? "Update shared notes" : "Share notes"}</Text>
            <ChoicePopover<string | undefined>
              value={form.canvasId}
              options={choices}
              onChange={(canvasId) =>
                setForm((f) => (f ? { ...f, canvasId, title: f.title || options.find((o) => o.id === canvasId)?.label || "" } : f))
              }
              accessibilityLabel="Notes to share"
              triggerClassName="border-border self-start border"
            />
            <Input
              value={form.title}
              onChangeText={(title) => setForm((f) => (f ? { ...f, title } : f))}
              placeholder="Title, e.g. Midterm reviewer"
              maxLength={80}
              accessibilityLabel="Shared notes title"
            />
            {preview ? (
              <Text className="text-muted-foreground text-xs leading-4">
                {preview.notes.length} note{preview.notes.length === 1 ? "" : "s"} will be shared
                {preview.skipped ? ` · ${preview.skipped} image${preview.skipped === 1 ? "" : "s"}, file${preview.skipped === 1 ? "" : "s"} or drawing${preview.skipped === 1 ? "" : "s"} stay private` : ""}. It&apos;s a
                copy — later edits aren&apos;t sent until you update it.
              </Text>
            ) : null}
            <View className="flex-row flex-wrap gap-2">
              <Button size="sm" onPress={publish} disabled={busy || !form.canvasId || !form.title.trim()}>
                <Text>{busy ? "Sharing…" : form.replaceId ? "Update" : "Share"}</Text>
              </Button>
              <Button size="sm" variant="ghost" onPress={() => setForm(null)}>
                <Text>Cancel</Text>
              </Button>
            </View>
          </View>
        ) : (
          <Button size="sm" variant="outline" className="self-start" onPress={() => setForm({ title: "" })}>
            <Text>Share notes…</Text>
          </Button>
        )}
        <ErrorLine error={error} />
      </View>
    </View>
  );
}

// --- Public deadlines page -----------------------------------------------------------

export function PublicPagePanel({ section, isOwner }: { section: Section; isOwner: boolean }) {
  const s = useSections();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!isOwner && !section.publicCode) return null;
  const link = section.publicCode ? inviteLink("deadlines", section.publicCode) : null;

  const toggle = async (enabled: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await setSectionPublic(section.id, enabled);
      await s.refresh();
      toast({ message: enabled ? "Public page is on" : "Public page is off", description: enabled ? "Anyone with the link can see deadline titles and dates." : "The old link no longer works." });
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View className="gap-2">
      <PanelTitle>Public deadlines page</PanelTitle>
      <View className="border-border gap-2 rounded-xl border p-3">
        <Text className="text-muted-foreground text-[13px] leading-[18px]">
          A read-only page for the group chat: upcoming deadline titles and due dates, no sign-in needed. It never shows notes, names or
          the invite code.
        </Text>
        {section.publicCode ? (
          <>
            <View className="flex-row items-center gap-2">
              <Icon as={Globe} size={14} className="text-primary" />
              <Text selectable className="flex-1 text-[13px]" numberOfLines={1}>
                {link ?? section.publicCode}
              </Text>
            </View>
            <View className="flex-row flex-wrap gap-2">
              <Button size="sm" variant="outline" onPress={async () => toast({ message: (await copyText(link ?? section.publicCode!)) ? "Link copied" : "Select the link to copy it" })}>
                <Icon as={Link2} size={14} className="text-foreground" />
                <Text>Copy link</Text>
              </Button>
              {isOwner ? (
                <Button size="sm" variant="ghost" disabled={busy} onPress={() => toggle(false)}>
                  <Text className="text-muted-foreground">Turn off</Text>
                </Button>
              ) : null}
            </View>
          </>
        ) : (
          <Button size="sm" className="self-start" disabled={busy} onPress={() => toggle(true)}>
            <Text>{busy ? "Creating…" : "Create public link"}</Text>
          </Button>
        )}
        <ErrorLine error={error} />
      </View>
    </View>
  );
}
