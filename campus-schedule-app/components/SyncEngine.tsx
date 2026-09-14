import type { RealtimeChannel } from "@supabase/supabase-js";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState, Platform, View } from "react-native";

import { useToast } from "@/components/Toaster";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/ui/text";
import { useAuth } from "@/context/auth";
import { useStoreSync, type StoreSliceName } from "@/context/store";
import { useAppearance } from "@/context/theme";
import type { CollectionName } from "@/lib/backup";
import {
  FILE_FIELDS,
  isCloudRef,
  refName,
  removeUnreferencedFiles,
  resolveRefs,
  toCloudForm,
  uploadFile,
} from "@/lib/cloudFiles";
import { supabase } from "@/lib/supabase";
import {
  SLICES,
  appendSyncLog,
  getDeviceId,
  hasMeaningfulData,
  hashString,
  loadMeta,
  loadSyncMeta,
  registerSyncNow,
  saveSyncMeta,
  setSyncState,
  sliceForKey,
  type SyncMetaV2,
} from "@/lib/sync";
import {
  applyToSlice,
  baseFromItems,
  baseFromRemote,
  describeSyncItem,
  itemHash,
  itemKey,
  planSync,
  sliceOfItem,
  sliceOfKey,
  sliceToItems,
  stableStringify,
  type PushItem,
  type RemoteItem,
  type SyncItem,
} from "@/lib/syncItems";
import { onLocalWrite } from "@/lib/syncEvents";

// Cloud sync, local-first, one row per item (course, task, note, …).
//  • Local saves upload shortly after they happen — only the items that changed.
//  • Other devices' changes arrive live (Realtime) and on app focus.
//  • Deletions sync as tombstones; when both sides changed the same item,
//    the newer change wins. Planning lives in lib/syncItems.ts (unit-tested).
//  • Note images/files go to Storage (lib/cloudFiles.ts), not into the rows.
//  • The first sign-in on a device that already has data asks what to keep;
//    devices that synced before per-item sync migrate without asking.
// Signing out stops syncing; the data stays on the device.

const TABLE = "items";
const PAGE = 1000;
const PUSH_CHUNK = 200;
const UPLOAD_DEBOUNCE_MS = 1500;
const REMOTE_DEBOUNCE_MS = 800;
const PERIODIC_MS = 5 * 60_000;
/** Re-read a little before the cursor, in case a slow write committed late. */
const OVERLAP_MS = 5000;
/** Keep in step with the 1 MB check in supabase/migrations/0002. */
const MAX_ITEM_CHARS = 1_000_000;
const GC_INTERVAL_MS = 24 * 3600 * 1000;
const MAX_REPAIRS = 20;

type Choice = "cloud" | "device" | "merge";
type Slices = Partial<Record<CollectionName, unknown>>;

const never = () => false;
const always = () => true;

function errorText(e: unknown): string {
  const raw =
    e instanceof Error ? e.message : e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);
  const code = e && typeof e === "object" && "code" in e ? String((e as { code: unknown }).code) : "";
  if (/failed to fetch|network|offline|load failed/i.test(raw)) return "You're offline — changes will sync when you're back.";
  if (["42P01", "PGRST205"].includes(code) || /does not exist|could not find the table/i.test(raw))
    return "Sync needs a database update: run supabase/migrations/0002 in the Supabase SQL Editor.";
  if (/JWT|refresh token/i.test(raw)) return "Your session expired — sign in again.";
  return raw;
}

const emptyValue = (name: CollectionName): unknown =>
  name === "grades" || name === "canvases" ? {} : name === "settings" || name === "appearance" ? undefined : [];

const maxUpdated = (rows: RemoteItem[], current: string | null) =>
  rows.reduce<string | null>((m, r) => (r.updated_at && (!m || r.updated_at > m) ? r.updated_at : m), current);

const fileRefs = (item: SyncItem) =>
  FILE_FIELDS.map((f) => (item.data as Record<string, unknown> | null)?.[f]).filter(isCloudRef).map(refName);

export function SyncEngine() {
  const { user } = useAuth();
  const { ready, snapshot, applySliceChanges } = useStoreSync();
  const { appearance, replaceAppearance } = useAppearance();
  const { toast } = useToast();
  const [choice, setChoice] = useState<{ resolve: (c: Choice) => void } | null>(null);

  const appearanceRef = useRef<unknown>(appearance);
  appearanceRef.current = appearance;
  const live = useRef({ snapshot, applySliceChanges, replaceAppearance, toast });
  live.current = { snapshot, applySliceChanges, replaceAppearance, toast };

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!supabase || !userId || !ready) {
      setSyncState({ phase: "off", error: null, notice: null, waiting: false });
      return;
    }
    const db = supabase;
    const uid = userId;
    let disposed = false;
    let deviceId = "";
    let meta: SyncMetaV2 | null = null;
    let channel: RealtimeChannel | null = null;
    const pending = new Set<CollectionName>();
    /** Saves caused by applying cloud changes shouldn't count as local edits. */
    const suppressUntil: Partial<Record<CollectionName, number>> = {};
    let localTimer: ReturnType<typeof setTimeout> | undefined;
    let remoteTimer: ReturnType<typeof setTimeout> | undefined;
    let queue: Promise<void> = Promise.resolve();

    const serialize = (fn: () => Promise<void>) => {
      queue = queue.then(fn, fn);
      return queue;
    };

    const fail = (e: unknown) => setSyncState({ phase: "error", error: errorText(e) });

    const readSlices = (): Slices => ({ ...live.current.snapshot(), appearance: appearanceRef.current });

    const localItems = (slices: Slices, names: readonly CollectionName[], files: Map<string, string>) =>
      names.flatMap((n) => sliceToItems(n, slices[n]).map((i) => toCloudForm(i, files)));

    /** Apply remote rows to the local store (files resolved to data: URLs first). */
    const applyLocally = async (rows: RemoteItem[], files: Map<string, string>) => {
      if (!rows.length) return;
      const bySlice = new Map<CollectionName, RemoteItem[]>();
      for (const r of rows) {
        const name = sliceOfItem(r.collection, r.id);
        if (!name) continue;
        let row = r;
        if (r.collection === "note_item" && !r.deleted) {
          const resolved = await resolveRefs(uid, r.data, files);
          if (resolved.changed) row = { ...r, data: resolved.data };
        }
        if (!bySlice.has(name)) bySlice.set(name, []);
        bySlice.get(name)!.push(row);
      }
      if (disposed) return;
      for (const [name, list] of bySlice) {
        suppressUntil[name] = Date.now() + 1500;
        if (name === "appearance") {
          const next = applyToSlice("appearance", appearanceRef.current, list);
          appearanceRef.current = next;
          live.current.replaceAppearance(next);
        } else {
          live.current.applySliceChanges(name as StoreSliceName, list);
        }
      }
    };

    /** Upsert rows, isolating any the database rejects so the rest still sync. */
    const upsertRows = async (items: PushItem[]): Promise<number> => {
      const m = meta!;
      let rejected = 0;
      const toRow = (i: PushItem) => ({
        user_id: uid,
        collection: i.collection,
        id: i.id,
        parent: i.deleted ? null : i.parent,
        data: i.deleted ? {} : i.data,
        deleted: i.deleted,
        device_id: deviceId,
      });
      const send = async (chunk: PushItem[]): Promise<void> => {
        const { error } = await db.from(TABLE).upsert(chunk.map(toRow), { onConflict: "user_id,collection,id" });
        if (!error) {
          for (const i of chunk) {
            const key = itemKey(i.collection, i.id);
            if (i.deleted) delete m.base[key];
            else m.base[key] = itemHash(i);
          }
          return;
        }
        // 22xxx/23xxx: this data broke a rule (size, format). Other errors (offline, quota, rate limit) stop the sync.
        if (!/^2[23]/.test(error.code ?? "")) throw error;
        if (chunk.length === 1) {
          rejected++;
          return;
        }
        for (const one of chunk) await send([one]);
      };
      for (let i = 0; i < items.length; i += PUSH_CHUNK) await send(items.slice(i, i + PUSH_CHUNK));
      return rejected;
    };

    const push = async (items: PushItem[], files: Map<string, string>) => {
      if (!items.length) return;
      const m = meta!;
      setSyncState({ phase: "syncing" });
      const notices = new Set<string>();
      const ready: PushItem[] = [];
      for (const item of items) {
        if (!item.deleted) {
          if (stableStringify(item.data).length > MAX_ITEM_CHARS) {
            notices.add("A note or drawing is too large to sync (over 1 MB), so it stays on this device.");
            continue;
          }
          let ok = true;
          for (const name of fileRefs(item)) {
            if (m.uploaded[name]) continue;
            const dataUrl = files.get(name);
            if (!dataUrl) continue; // Came from another device, which uploaded it.
            const result = await uploadFile(uid, name, dataUrl);
            if (result === "ok") m.uploaded[name] = 1;
            else {
              ok = false;
              notices.add(
                result === "too-large"
                  ? "A file is over 5 MB, so it stays on this device only."
                  : "A file's type can't sync (images, PDF, Word, PowerPoint, Excel and text files can), so it stays on this device."
              );
              break;
            }
          }
          if (!ok) continue;
        }
        ready.push(item);
      }
      const rejected = await upsertRows(ready);
      if (rejected) notices.add(`${rejected} item${rejected === 1 ? "" : "s"} couldn't be synced.`);
      await saveSyncMeta(uid, m);
      if (notices.size) setSyncState({ notice: [...notices].join(" ") });
    };

    const fetchItems = async (since: string | null): Promise<RemoteItem[]> => {
      const out: RemoteItem[] = [];
      for (let from = 0; ; from += PAGE) {
        let q = db.from(TABLE).select("collection,id,parent,data,deleted,updated_at");
        if (since) q = q.gt("updated_at", since);
        const { data, error } = await q.order("updated_at").order("collection").order("id").range(from, from + PAGE - 1);
        if (error) throw error;
        out.push(...((data ?? []) as RemoteItem[]));
        if (!data || data.length < PAGE) return out;
      }
    };

    /** Whole-slice rows from before per-item sync, as items. */
    const fetchLegacy = async (files: Map<string, string>): Promise<RemoteItem[]> => {
      const { data, error } = await db.from("user_data").select("key,value,updated_at");
      if (error) return [];
      return ((data ?? []) as { key: string; value: unknown; updated_at: string }[]).flatMap((row) =>
        SLICES.includes(row.key as CollectionName)
          ? sliceToItems(row.key as CollectionName, row.value).map((i) => ({ ...toCloudForm(i, files), deleted: false, updated_at: row.updated_at }))
          : []
      );
    };

    /** First sync of this device with this account. */
    const firstSync = async () => {
      const m = meta!;
      setSyncState({ phase: "syncing", notice: null });
      const files = new Map<string, string>();
      let remote = await fetchItems(null);
      let fromLegacy = false;
      if (!remote.some((r) => !r.deleted)) {
        const legacy = await fetchLegacy(files);
        if (legacy.length) {
          remote = legacy;
          fromLegacy = true;
        }
      }
      const slices = readSlices();
      const local = localItems(slices, SLICES, files);
      const remoteData: Slices = Object.fromEntries(
        SLICES.map((n) => [n, applyToSlice(n, emptyValue(n), remote.filter((r) => sliceOfItem(r.collection, r.id) === n))])
      );
      const localHas = hasMeaningfulData(slices);
      const remoteHas = remote.some((r) => !r.deleted) && hasMeaningfulData(remoteData);
      const before = await loadMeta(uid);

      let base: Record<string, string>;
      let preferLocal: (key: string) => boolean = never;
      let announce: string | null = null;
      if (!remoteHas) {
        base = baseFromRemote(remote);
        preferLocal = always;
        announce = remote.length ? "This device's data is synced" : null;
      } else if (!localHas) {
        base = baseFromItems(local);
        announce = "Your account's data is on this device";
      } else if (before.firstSyncDone) {
        // Synced before per-item sync: keep what changed here since then, take the rest from the account.
        const changed = new Set(SLICES.filter((n) => slices[n] !== undefined && hashString(JSON.stringify(slices[n])) !== before.syncedHash[n]));
        base = baseFromItems(local.filter((i) => !changed.has(sliceOfItem(i.collection, i.id)!)));
        preferLocal = (key) => changed.has(sliceOfKey(key)!);
      } else {
        setSyncState({ phase: "choice" });
        const decision = await new Promise<Choice>((resolve) => setChoice({ resolve }));
        setChoice(null);
        if (disposed) return;
        setSyncState({ phase: "syncing" });
        if (decision === "cloud") {
          base = baseFromItems(local);
          announce = "Your account's data is on this device";
        } else if (decision === "device") {
          base = baseFromRemote(remote);
          preferLocal = always;
          announce = "This device's data is synced";
        } else {
          base = {};
          announce = "Merged and synced";
        }
      }

      const plan = planSync({ local, base, remote, fullSnapshot: true, preferLocal });
      await applyLocally(plan.apply, files);
      if (disposed) return;
      let toPush = plan.push;
      m.base = plan.base;
      if (fromLegacy) {
        // Nothing is in the per-item table yet: upload the combined result.
        const after = new Map<string, SyncItem>(local.map((i) => [itemKey(i.collection, i.id), i]));
        for (const r of plan.apply) {
          if (r.deleted) after.delete(itemKey(r.collection, r.id));
          else after.set(itemKey(r.collection, r.id), r);
        }
        m.base = {};
        toPush = [...after.values()].map((i) => ({ collection: i.collection, id: i.id, parent: i.parent, data: i.data, deleted: false }));
      } else {
        m.cursor = maxUpdated(remote, null);
      }
      m.firstSyncDone = true;
      await saveSyncMeta(uid, m);
      await push(toPush, files);
      setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
      if (announce) live.current.toast({ message: announce });
    };

    /** Bring this device and the account up to date (both directions). */
    const reconcile = async () => {
      const m = meta!;
      setSyncState({ phase: "syncing" });
      const files = new Map<string, string>();
      const since = m.cursor ? new Date(Date.parse(m.cursor) - OVERLAP_MS).toISOString() : null;
      const remote = await fetchItems(since);
      const local = localItems(readSlices(), SLICES, files);
      const plan = planSync({
        local,
        base: m.base,
        remote,
        fullSnapshot: false,
        preferLocal: (key, r) => (m.localChangedAt[sliceOfKey(key) ?? "tasks"] ?? 0) > Date.parse(r.updated_at),
      });
      await applyLocally(plan.apply, files);
      if (disposed) return;
      // Remember local edits that lost to a newer change elsewhere, for Settings → Sync.
      await appendSyncLog(
        uid,
        plan.overwritten.map(({ local, remote: r }) => {
          const described = describeSyncItem(local ?? r);
          return { at: Date.now(), kind: described.kind, title: described.title, removed: r.deleted };
        })
      );
      m.base = plan.base;
      m.cursor = maxUpdated(remote, m.cursor);
      await saveSyncMeta(uid, m);
      setSyncState({ notice: null });
      await push(plan.push, files);
      setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
      void serialize(maintenance);
    };

    /** Upload just the changed items of the slices saved locally. */
    const pushLocal = async (names: CollectionName[]) => {
      const m = meta!;
      const files = new Map<string, string>();
      const scope = new Set(names);
      const local = localItems(readSlices(), names, files);
      const base = Object.fromEntries(Object.entries(m.base).filter(([key]) => scope.has(sliceOfKey(key)!)));
      const plan = planSync({ local, base, remote: [], fullSnapshot: false, preferLocal: never });
      if (!plan.push.length) return;
      await push(plan.push, files);
      setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
    };

    /** Retry images that failed to download; once a day, delete files no note uses. */
    const maintenance = async () => {
      if (disposed || !meta) return;
      const m = meta;
      try {
        const slices = readSlices();
        const notes = sliceToItems("canvases", slices.canvases);
        const broken = notes.filter((i) => fileRefs(i).length).slice(0, MAX_REPAIRS);
        const fixed: RemoteItem[] = [];
        for (const i of broken) {
          const resolved = await resolveRefs(uid, i.data);
          if (resolved.changed) fixed.push({ ...i, data: resolved.data, deleted: false, updated_at: "" });
        }
        if (fixed.length && !disposed) {
          suppressUntil.canvases = Date.now() + 1500;
          live.current.applySliceChanges("canvases", fixed);
        }
        if (Date.now() - (m.lastGcAt ?? 0) > GC_INTERVAL_MS) {
          const referenced = new Set(localItems(slices, ["canvases"], new Map()).flatMap(fileRefs));
          await removeUnreferencedFiles(uid, referenced);
          m.lastGcAt = Date.now();
          m.uploaded = Object.fromEntries(Object.keys(m.uploaded).filter((n) => referenced.has(n)).map((n) => [n, 1 as const]));
          await saveSyncMeta(uid, m);
        }
      } catch {
        // Best effort; tried again next sync.
      }
    };

    const flush = () =>
      serialize(async () => {
        if (!meta?.firstSyncDone || !pending.size) return;
        const names = [...pending];
        pending.clear();
        try {
          await pushLocal(names);
          if (!pending.size) setSyncState({ waiting: false });
        } catch (e) {
          names.forEach((n) => pending.add(n));
          fail(e);
        }
      });

    const stopLocal = onLocalWrite((storageKey) => {
      const name = sliceForKey(storageKey);
      if (!name) return;
      if (meta && (suppressUntil[name] ?? 0) < Date.now()) meta.localChangedAt[name] = Date.now();
      pending.add(name);
      setSyncState({ waiting: true });
      clearTimeout(localTimer);
      localTimer = setTimeout(flush, UPLOAD_DEBOUNCE_MS);
    });

    const syncNow = () =>
      serialize(async () => {
        if (disposed || !meta) return;
        try {
          await (meta.firstSyncDone ? reconcile() : firstSync());
          // A full sync uploads every local change, including ones still queued.
          if (meta.firstSyncDone) {
            pending.clear();
            setSyncState({ waiting: false });
          }
        } catch (e) {
          fail(e);
        }
      }).then(() => {
        if (pending.size) void flush();
      });

    (async () => {
      setSyncState({ phase: "connecting", error: null, notice: null });
      deviceId = await getDeviceId();
      meta = await loadSyncMeta(uid);
      if (disposed) return;
      registerSyncNow(syncNow);
      await syncNow();
      if (disposed) return;
      channel = db
        .channel(`items:${uid}`)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: `user_id=eq.${uid}` }, (payload) => {
          const row = (payload.new ?? {}) as { device_id?: string | null };
          if (row.device_id && row.device_id === deviceId) return;
          clearTimeout(remoteTimer);
          remoteTimer = setTimeout(syncNow, REMOTE_DEBOUNCE_MS);
        })
        .subscribe();
    })();

    const interval = setInterval(syncNow, PERIODIC_MS);
    const appSub = AppState.addEventListener("change", (s) => s === "active" && syncNow());
    const onOnline = () => syncNow();
    if (Platform.OS === "web") window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      clearTimeout(localTimer);
      clearTimeout(remoteTimer);
      clearInterval(interval);
      stopLocal();
      appSub.remove();
      if (Platform.OS === "web") window.removeEventListener("online", onOnline);
      if (channel) db.removeChannel(channel);
      registerSyncNow(null);
      setChoice((c) => {
        c?.resolve("cloud");
        return null;
      });
    };
  }, [userId, ready]);

  const decide = useCallback((c: Choice) => choice?.resolve(c), [choice]);

  return (
    <AlertDialog open={!!choice}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <AlertDialogTitle>You have data here and in your account</AlertDialogTitle>
          <AlertDialogDescription>
            This device already has courses, tasks or notes, and so does your account. What should we keep?
          </AlertDialogDescription>
        </AlertDialogHeader>
        <View className="gap-2">
          <Button onPress={() => decide("merge")}>
            <Text>Merge both (recommended)</Text>
          </Button>
          <Text className="text-muted-foreground px-1 text-xs">Keeps everything from both; nothing is deleted.</Text>
          <Button variant="outline" onPress={() => decide("cloud")}>
            <Text>Use my account&apos;s data</Text>
          </Button>
          <Text className="text-muted-foreground px-1 text-xs">Replaces what&apos;s on this device. Export a backup first if unsure.</Text>
          <Button variant="outline" onPress={() => decide("device")}>
            <Text>Use this device&apos;s data</Text>
          </Button>
          <Text className="text-muted-foreground px-1 text-xs">Replaces what&apos;s saved in your account.</Text>
        </View>
        <AlertDialogFooter />
      </AlertDialogContent>
    </AlertDialog>
  );
}
