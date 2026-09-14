import AsyncStorage from "@react-native-async-storage/async-storage";
import { ArrowLeft, LogOut, RefreshCw, Trash2, Users } from "lucide-react-native";
import { useEffect, useState } from "react";
import { Pressable, ScrollView, useWindowDimensions, View } from "react-native";

import { CodeBox, SignInFirst } from "@/components/courses/CourseSharing";
import { FreeTimesPanel, PostSocial, PublicPagePanel, SharedNotesPanel } from "@/components/sections/SectionExtras";
import { DueDateButton } from "@/components/DueDateButton";
import { TimePickerField } from "@/components/TimePickerField";
import { useToast } from "@/components/Toaster";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Icon } from "@/components/ui/icon";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/ui/text";
import { Textarea } from "@/components/ui/textarea";
import { useAuth } from "@/context/auth";
import { useSections } from "@/context/sections";
import { useCourses } from "@/context/store";
import { formatShortDate } from "@/lib/calendar";
import {
  LIMITS,
  addPost,
  createSection,
  deletePost,
  deleteSection,
  joinSection,
  leaveSection,
  removeMember,
  rotateInvite,
  setDisplayName,
  type SectionPost,
} from "@/lib/cloud";
import { display12h } from "@/lib/schedule";
import { todayIso } from "@/lib/tasks";
import { cn } from "@/lib/utils";

// Class sections: a group (your block, a class) with an invite code. Any
// member can post a deadline; it appears in every member's Tasks. The
// owner can remove or ban members and delete any post. The database
// enforces all of this (and the spam limits) — the UI just follows along.

const NAME_KEY = "campus-schedule-cache:section-display-name";

type Screen = { kind: "list" } | { kind: "create" } | { kind: "join" } | { kind: "section"; id: string };

function useAction() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return { busy, error, run };
}

function useDisplayName() {
  const [name, setName] = useState("");
  useEffect(() => {
    AsyncStorage.getItem(NAME_KEY)
      .then((v) => v && setName((cur) => cur || v))
      .catch(() => {});
  }, []);
  const remember = (v: string) => AsyncStorage.setItem(NAME_KEY, v.trim()).catch(() => {});
  return [name, setName, remember] as const;
}

function ErrorText({ error }: { error: string | null }) {
  return error ? (
    <Text className="text-destructive text-sm" role="alert">
      {error}
    </Text>
  ) : null;
}

function InlineConfirm({
  text,
  label,
  busy,
  onConfirm,
  onCancel,
}: {
  text: string;
  label: string;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <View className="border-destructive/40 bg-destructive/10 gap-2 rounded-lg border p-3" role="alert">
      <Text className="text-sm leading-5">{text}</Text>
      <View className="flex-row flex-wrap gap-2">
        <Button size="sm" variant="destructive" onPress={onConfirm} disabled={busy}>
          <Text>{busy ? "Working…" : label}</Text>
        </Button>
        <Button size="sm" variant="ghost" onPress={onCancel}>
          <Text>Cancel</Text>
        </Button>
      </View>
    </View>
  );
}

function BackHeader({ title, description, onBack }: { title: string; description?: string; onBack: () => void }) {
  return (
    <DialogHeader>
      <View className="flex-row items-center gap-1">
        <Button variant="ghost" size="icon" onPress={onBack} accessibilityLabel="Back to sections" className="-ml-2">
          <Icon as={ArrowLeft} size={18} className="text-foreground" />
        </Button>
        <DialogTitle className="flex-1">{title}</DialogTitle>
      </View>
      {description ? <DialogDescription>{description}</DialogDescription> : null}
    </DialogHeader>
  );
}

export function SectionsDialog({
  open,
  onOpenChange,
  joinCode,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  joinCode?: string;
}) {
  const [screen, setScreen] = useState<Screen>({ kind: "list" });
  const { height } = useWindowDimensions();
  const { available } = useSections();

  useEffect(() => {
    if (open) setScreen(joinCode ? { kind: "join" } : { kind: "list" });
  }, [open, joinCode]);

  const close = () => onOpenChange(false);
  const toList = () => setScreen({ kind: "list" });
  const openSection = (id: string) => setScreen({ kind: "section", id });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="p-5 sm:max-w-lg">
        <ScrollView style={{ maxHeight: height * 0.8 }} contentContainerClassName="gap-4" keyboardShouldPersistTaps="handled">
          {!available ? (
            <>
              <DialogHeader>
                <DialogTitle>Class sections</DialogTitle>
                <DialogDescription>Share deadlines with your class. Everyone who joins sees them in their Tasks.</DialogDescription>
              </DialogHeader>
              <SignInFirst what="joining a class section" onClose={close} />
            </>
          ) : screen.kind === "create" ? (
            <CreateSection onBack={toList} onCreated={openSection} />
          ) : screen.kind === "join" ? (
            <JoinSection initialCode={joinCode} onBack={toList} onJoined={openSection} />
          ) : screen.kind === "section" ? (
            <SectionDetail id={screen.id} onBack={toList} />
          ) : (
            <SectionList onOpen={openSection} onCreate={() => setScreen({ kind: "create" })} onJoin={() => setScreen({ kind: "join" })} />
          )}
        </ScrollView>
      </DialogContent>
    </Dialog>
  );
}

function SectionList({ onOpen, onCreate, onJoin }: { onOpen: (id: string) => void; onCreate: () => void; onJoin: () => void }) {
  const s = useSections();
  const { user } = useAuth();
  const today = todayIso();
  return (
    <>
      <DialogHeader>
        <DialogTitle>Class sections</DialogTitle>
        <DialogDescription>
          Share deadlines with your block or class. A deadline posted in a section shows up in every member&apos;s Tasks.
        </DialogDescription>
      </DialogHeader>
      <View className="flex-row flex-wrap gap-2">
        <Button onPress={onJoin}>
          <Text>Join with a code</Text>
        </Button>
        <Button variant="outline" onPress={onCreate}>
          <Text>Create a section</Text>
        </Button>
      </View>
      <ErrorText error={s.error} />
      {!s.loaded ? (
        <Text className="text-muted-foreground text-sm">{s.loading ? "Loading your sections…" : ""}</Text>
      ) : s.sections.length === 0 ? (
        <Text className="text-muted-foreground text-sm">You&apos;re not in any sections yet.</Text>
      ) : (
        <View className="border-border rounded-xl border">
          {s.sections.map((sec, i) => {
            const members = s.members.filter((m) => m.sectionId === sec.id).length;
            const upcoming = s.posts.filter((p) => p.sectionId === sec.id && p.due >= today).length;
            return (
              <Pressable
                key={sec.id}
                onPress={() => onOpen(sec.id)}
                accessibilityRole="button"
                accessibilityLabel={`Open ${sec.name}`}
                className={cn("flex-row items-center gap-3 px-4 py-3 web:transition-colors web:hover:bg-accent/40", i > 0 && "border-border/60 border-t")}
              >
                <Icon as={Users} size={16} className="text-muted-foreground" />
                <View className="flex-1 gap-0.5">
                  <Text className="text-[15px] font-medium">{sec.name}</Text>
                  <Text className="text-muted-foreground text-[13px]">
                    {[sec.courseCode, `${members} member${members === 1 ? "" : "s"}`, `${upcoming} upcoming`].filter(Boolean).join(" · ")}
                  </Text>
                </View>
                {sec.ownerId === user?.id ? (
                  <Badge variant="outline">
                    <Text>Owner</Text>
                  </Badge>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      )}
    </>
  );
}

function DisplayNameField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <View className="gap-1">
      <Input value={value} onChangeText={onChange} placeholder="Your name in this section" maxLength={LIMITS.displayName} accessibilityLabel="Your display name" />
      <Text className="text-muted-foreground text-xs">Classmates see this name — never your email.</Text>
    </View>
  );
}

function CreateSection({ onBack, onCreated }: { onBack: () => void; onCreated: (id: string) => void }) {
  const { courses } = useCourses();
  const { refresh } = useSections();
  const [name, setName] = useState("");
  const [courseCode, setCourseCode] = useState("");
  const [displayName, setDisplay, remember] = useDisplayName();
  const a = useAction();

  const submit = () =>
    a.run(async () => {
      const created = await createSection(name, courseCode, displayName);
      remember(displayName);
      await refresh();
      onCreated(created.id);
    });

  return (
    <>
      <BackHeader
        title="Create a section"
        description="You'll get an invite code to share. Only people with the code can join, and you can change it anytime."
        onBack={onBack}
      />
      {courses.length ? (
        <View className="flex-row flex-wrap gap-1.5">
          {courses.slice(0, 10).map((c) => (
            <Pressable
              key={c.id}
              onPress={() => {
                setCourseCode(c.code);
                setName((cur) => cur || `${c.code}${c.section ? ` ${c.section}` : ""}`);
              }}
              accessibilityRole="button"
              className={cn(
                "flex-row items-center gap-1.5 rounded-full border border-border px-3 py-1 web:hover:bg-accent",
                courseCode === c.code && "border-primary bg-primary/10"
              )}
            >
              <View className="size-2 rounded-full" style={{ backgroundColor: c.color }} />
              <Text className="text-xs font-medium">{c.code}</Text>
            </Pressable>
          ))}
        </View>
      ) : null}
      <Input value={name} onChangeText={setName} placeholder="Section name, e.g. CMSC 21 T-3L" maxLength={LIMITS.sectionName} accessibilityLabel="Section name" />
      <Input
        value={courseCode}
        onChangeText={setCourseCode}
        placeholder="Course code (optional)"
        maxLength={LIMITS.courseCode}
        accessibilityLabel="Course code"
      />
      <DisplayNameField value={displayName} onChange={setDisplay} />
      <ErrorText error={a.error} />
      <Button onPress={submit} disabled={a.busy || !name.trim() || !displayName.trim()} className="self-start">
        <Text>{a.busy ? "Creating…" : "Create section"}</Text>
      </Button>
    </>
  );
}

function JoinSection({ initialCode, onBack, onJoined }: { initialCode?: string; onBack: () => void; onJoined: (id: string) => void }) {
  const { refresh } = useSections();
  const { toast } = useToast();
  const [code, setCode] = useState(initialCode ?? "");
  const [displayName, setDisplay, remember] = useDisplayName();
  const a = useAction();

  const submit = () =>
    a.run(async () => {
      const id = await joinSection(code, displayName);
      if (!id) throw new Error("That invite code isn't valid. Check it with whoever shared it.");
      remember(displayName);
      await refresh();
      toast({ message: "You joined the section", description: "Its deadlines will show in your Tasks." });
      onJoined(id);
    });

  return (
    <>
      <BackHeader title="Join a section" description="Enter the invite code a classmate shared." onBack={onBack} />
      <Input
        value={code}
        onChangeText={setCode}
        placeholder="ABCDE-FGH23"
        autoCapitalize="characters"
        autoCorrect={false}
        maxLength={16}
        accessibilityLabel="Invite code"
      />
      <DisplayNameField value={displayName} onChange={setDisplay} />
      <ErrorText error={a.error} />
      <Button onPress={submit} disabled={a.busy || !code.trim() || !displayName.trim()} className="self-start">
        <Text>{a.busy ? "Joining…" : "Join section"}</Text>
      </Button>
    </>
  );
}

function PostRow({
  post,
  author,
  canDelete,
  confirming,
  busy,
  onAskDelete,
  onDelete,
  onCancel,
  first,
  children,
}: {
  post: SectionPost;
  author: string;
  canDelete: boolean;
  confirming: boolean;
  busy: boolean;
  onAskDelete: () => void;
  onDelete: () => void;
  onCancel: () => void;
  first: boolean;
  children?: React.ReactNode;
}) {
  return (
    <View className={cn("gap-2 px-4 py-3", !first && "border-border/60 border-t")}>
      <View className="flex-row items-start gap-2">
        <View className="flex-1 gap-0.5">
          <Text className="text-[15px]">{post.title}</Text>
          <Text className="text-muted-foreground text-[13px]">
            Due {formatShortDate(post.due)}
            {post.dueTime ? ` · ${display12h(post.dueTime)}` : ""} · by {author}
          </Text>
          {post.note ? <Text className="mt-1 text-sm leading-5">{post.note}</Text> : null}
        </View>
        {canDelete ? (
          <Button variant="ghost" size="icon" onPress={onAskDelete} accessibilityLabel={`Delete ${post.title}`}>
            <Icon as={Trash2} size={15} className="text-muted-foreground" />
          </Button>
        ) : null}
      </View>
      {confirming ? (
        <InlineConfirm text="Delete this deadline for everyone in the section?" label="Delete" busy={busy} onConfirm={onDelete} onCancel={onCancel} />
      ) : null}
      {children}
    </View>
  );
}

function SectionDetail({ id, onBack }: { id: string; onBack: () => void }) {
  const s = useSections();
  const { user } = useAuth();
  const { toast } = useToast();
  const a = useAction();
  const [confirm, setConfirm] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [due, setDue] = useState<string | undefined>(undefined);
  const [dueTime, setDueTime] = useState<string | undefined>(undefined);
  const [note, setNote] = useState("");
  const [showNote, setShowNote] = useState(false);
  const [showPast, setShowPast] = useState(false);
  const [renaming, setRenaming] = useState<string | null>(null);

  const section = s.sections.find((x) => x.id === id);
  if (!section) {
    return (
      <>
        <BackHeader title="Section" onBack={onBack} />
        <Text className="text-muted-foreground text-sm">
          {s.loading ? "Loading…" : "This section isn't available — it was deleted, or you're no longer a member."}
        </Text>
      </>
    );
  }

  const me = user?.id ?? "";
  const isOwner = section.ownerId === me;
  const members = s.members.filter((m) => m.sectionId === id);
  const myName = members.find((m) => m.userId === me)?.displayName ?? "";
  const nameOf = (userId: string) => (userId === me ? "you" : members.find((m) => m.userId === userId)?.displayName ?? "a former member");
  const today = todayIso();
  const posts = s.posts.filter((p) => p.sectionId === id);
  const upcoming = posts.filter((p) => p.due >= today);
  const past = posts.filter((p) => p.due < today).reverse();

  const post = () =>
    a.run(async () => {
      if (!due) throw new Error("Pick a due date.");
      await addPost(id, me, { title, due, dueTime, note });
      setTitle("");
      setNote("");
      setDueTime(undefined);
      setShowNote(false);
      await s.refresh();
      toast({ message: "Deadline posted", description: "Everyone in the section will see it in Tasks." });
    });

  const act = (fn: () => Promise<void>) =>
    a.run(async () => {
      await fn();
      setConfirm(null);
      await s.refresh();
    });

  const renderPosts = (list: SectionPost[]) =>
    list.map((p, i) => (
      <PostRow
        key={p.id}
        post={p}
        first={i === 0}
        author={nameOf(p.authorId)}
        canDelete={p.authorId === me || isOwner}
        confirming={confirm === `post:${p.id}`}
        busy={a.busy}
        onAskDelete={() => setConfirm(`post:${p.id}`)}
        onCancel={() => setConfirm(null)}
        onDelete={() => act(() => deletePost(p.id))}
      >
        <PostSocial post={p} nameOf={nameOf} canModerate={isOwner} />
      </PostRow>
    ));

  return (
    <>
      <BackHeader title={section.name} description={section.courseCode ?? undefined} onBack={onBack} />

      <View className="gap-2">
        <CodeBox code={section.inviteCode} kind="section" label="Invite code" />
        <View className="flex-row flex-wrap items-center justify-between gap-2 px-1">
          <Text className="text-muted-foreground flex-1 text-xs leading-4">Anyone with the code can join — share it only with your class.</Text>
          {isOwner ? (
            <Button size="sm" variant="ghost" onPress={() => setConfirm("rotate")}>
              <Icon as={RefreshCw} size={14} className="text-muted-foreground" />
              <Text className="text-muted-foreground">New code</Text>
            </Button>
          ) : null}
        </View>
        {confirm === "rotate" ? (
          <InlineConfirm
            text="The old code and link stop working. People already in the section stay."
            label="Make a new code"
            busy={a.busy}
            onConfirm={() => act(async () => void (await rotateInvite(id)))}
            onCancel={() => setConfirm(null)}
          />
        ) : null}
      </View>

      <View className="border-border gap-2 rounded-xl border p-3">
        <Text className="text-[15px] font-semibold">Post a deadline</Text>
        <Input value={title} onChangeText={setTitle} placeholder="e.g. Lab report 3" maxLength={LIMITS.postTitle} accessibilityLabel="Deadline title" />
        <View className="flex-row flex-wrap items-center gap-1">
          <DueDateButton value={due} onChange={setDue} />
          <TimePickerField value={dueTime} onChange={setDueTime} variant="ghost" accessibilityLabel="Due time" />
          {!showNote ? (
            <Button size="sm" variant="ghost" onPress={() => setShowNote(true)}>
              <Text className="text-muted-foreground">Add details</Text>
            </Button>
          ) : null}
        </View>
        {showNote ? (
          <Textarea value={note} onChangeText={setNote} placeholder="Details (optional)" maxLength={LIMITS.postNote} accessibilityLabel="Details" />
        ) : null}
        <ErrorText error={a.error} />
        <Button onPress={post} disabled={a.busy || !title.trim() || !due} className="self-start">
          <Text>{a.busy ? "Posting…" : "Post to section"}</Text>
        </Button>
      </View>

      <View className="gap-2">
        <Text className="px-1 text-[15px] font-semibold">Upcoming</Text>
        {upcoming.length ? (
          <View className="border-border rounded-xl border">{renderPosts(upcoming)}</View>
        ) : (
          <Text className="text-muted-foreground px-1 text-sm">No upcoming deadlines.</Text>
        )}
        {past.length ? (
          <Button variant="ghost" size="sm" className="self-start" onPress={() => setShowPast((v) => !v)}>
            <Text className="text-muted-foreground">{showPast ? "Hide past deadlines" : `Show ${past.length} past`}</Text>
          </Button>
        ) : null}
        {showPast && past.length ? <View className="border-border rounded-xl border opacity-80">{renderPosts(past)}</View> : null}
      </View>

      <FreeTimesPanel sectionId={id} />
      <SharedNotesPanel sectionId={id} isOwner={isOwner} nameOf={nameOf} />
      <PublicPagePanel section={section} isOwner={isOwner} />

      <View className="gap-2">
        <Text className="px-1 text-[15px] font-semibold">Members · {members.length}</Text>
        <View className="border-border rounded-xl border">
          {members.map((m, i) => (
            <View key={m.userId} className={cn("gap-2 px-4 py-2.5", i > 0 && "border-border/60 border-t")}>
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm">
                  {m.displayName}
                  {m.userId === me ? " (you)" : ""}
                </Text>
                {m.role === "owner" ? (
                  <Badge variant="outline">
                    <Text>Owner</Text>
                  </Badge>
                ) : isOwner ? (
                  <View className="flex-row">
                    <Button size="sm" variant="ghost" onPress={() => setConfirm(`remove:${m.userId}`)}>
                      <Text className="text-muted-foreground">Remove</Text>
                    </Button>
                    <Button size="sm" variant="ghost" onPress={() => setConfirm(`ban:${m.userId}`)}>
                      <Text className="text-destructive">Ban</Text>
                    </Button>
                  </View>
                ) : null}
              </View>
              {confirm === `remove:${m.userId}` || confirm === `ban:${m.userId}` ? (
                <InlineConfirm
                  text={
                    confirm.startsWith("ban")
                      ? `Remove ${m.displayName} and stop them from rejoining, even with a new code?`
                      : `Remove ${m.displayName}? They can rejoin with the invite code — make a new code if you don't want that.`
                  }
                  label={confirm.startsWith("ban") ? "Ban" : "Remove"}
                  busy={a.busy}
                  onConfirm={() => act(() => removeMember(id, m.userId, confirm.startsWith("ban")))}
                  onCancel={() => setConfirm(null)}
                />
              ) : null}
            </View>
          ))}
        </View>
      </View>

      {renaming !== null ? (
        <View className="flex-row items-center gap-2">
          <Input value={renaming} onChangeText={setRenaming} maxLength={LIMITS.displayName} accessibilityLabel="Your display name" className="flex-1" />
          <Button
            size="sm"
            disabled={a.busy || !renaming.trim()}
            onPress={() =>
              act(async () => {
                await setDisplayName(id, renaming);
                setRenaming(null);
              })
            }
          >
            <Text>Save</Text>
          </Button>
          <Button size="sm" variant="ghost" onPress={() => setRenaming(null)}>
            <Text>Cancel</Text>
          </Button>
        </View>
      ) : null}

      <View className="flex-row flex-wrap gap-1">
        {renaming === null ? (
          <Button size="sm" variant="ghost" onPress={() => setRenaming(myName)}>
            <Text className="text-muted-foreground">Change my name</Text>
          </Button>
        ) : null}
        {isOwner ? (
          <Button size="sm" variant="ghost" onPress={() => setConfirm("delete")}>
            <Icon as={Trash2} size={14} className="text-destructive" />
            <Text className="text-destructive">Delete section</Text>
          </Button>
        ) : (
          <Button size="sm" variant="ghost" onPress={() => setConfirm("leave")}>
            <Icon as={LogOut} size={14} className="text-muted-foreground" />
            <Text className="text-muted-foreground">Leave section</Text>
          </Button>
        )}
      </View>
      {confirm === "delete" ? (
        <InlineConfirm
          text="Delete this section and all its deadlines for everyone? Deadlines people already finished stay in their history."
          label="Delete section"
          busy={a.busy}
          onConfirm={() =>
            act(async () => {
              await deleteSection(id);
              onBack();
            })
          }
          onCancel={() => setConfirm(null)}
        />
      ) : confirm === "leave" ? (
        <InlineConfirm
          text="Its unfinished deadlines leave your Tasks. You can rejoin with the invite code."
          label="Leave"
          busy={a.busy}
          onConfirm={() =>
            act(async () => {
              await leaveSection(id, me);
              onBack();
            })
          }
          onCancel={() => setConfirm(null)}
        />
      ) : null}
    </>
  );
}
