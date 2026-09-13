import AsyncStorage from "@react-native-async-storage/async-storage";
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
import { useStoreApply } from "@/context/store";
import { useAppearance } from "@/context/theme";
import { BACKUP_KEYS, createBackup, plannedData, type BackupFile, type CollectionName } from "@/lib/backup";
import { supabase } from "@/lib/supabase";
import {
  SLICES,
  getDeviceId,
  hasMeaningfulData,
  hashString,
  loadMeta,
  registerSyncNow,
  saveMeta,
  setSyncState,
  sliceForKey,
  type SyncMeta,
} from "@/lib/sync";
import { onLocalWrite } from "@/lib/syncEvents";

// Cloud sync, local-first. Each data slice (courses, tasks, notes, …) is
// one row per user; the newest write wins per slice.
//  • Local saves upload shortly after they happen (debounced).
//  • Other devices' changes arrive live (Realtime) and on app focus.
//  • The first sign-in on a device that already has data asks what to keep.
// Signing out stops syncing; the data stays on the device.

const UPLOAD_DEBOUNCE_MS = 1500;
const TABLE = "user_data";

type Row = { key: CollectionName; value: unknown; updated_at: string; device_id: string | null };
type Choice = "cloud" | "device" | "merge";

export function SyncEngine() {
  const { user } = useAuth();
  const { ready, applyStored } = useStoreApply();
  const { replaceAppearance } = useAppearance();
  const { toast } = useToast();
  const [choice, setChoice] = useState<{ resolve: (c: Choice) => void } | null>(null);

  const applyRef = useRef({ applyStored, replaceAppearance, toast });
  applyRef.current = { applyStored, replaceAppearance, toast };

  const userId = user?.id ?? null;

  useEffect(() => {
    if (!supabase || !userId || !ready) {
      setSyncState({ phase: "off", error: null });
      return;
    }
    const db = supabase;
    let disposed = false;
    let deviceId = "";
    let meta: SyncMeta;
    let channel: RealtimeChannel | null = null;
    const pending = new Set<CollectionName>();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let busy: Promise<void> = Promise.resolve();
    /** JSON we just applied from the cloud, so its local save isn't uploaded back. */
    const applied = new Map<string, string>();

    const serialize = (fn: () => Promise<void>) => {
      busy = busy.then(fn, fn);
      return busy;
    };

    const fail = (e: unknown) => {
      const message = e instanceof Error ? e.message : typeof e === "object" && e && "message" in e ? String((e as { message: unknown }).message) : String(e);
      const offline = /fetch|network|offline/i.test(message);
      setSyncState({ phase: "error", error: offline ? "You're offline — changes will sync when you're back." : message });
    };

    const readLocal = async (): Promise<Partial<Record<CollectionName, string>>> => {
      const pairs = await AsyncStorage.multiGet(SLICES.map((n) => BACKUP_KEYS[n]));
      const out: Partial<Record<CollectionName, string>> = {};
      for (const [k, v] of pairs) {
        const name = sliceForKey(k);
        if (name && v != null) out[name] = v;
      }
      return out;
    };

    const apply = (name: CollectionName, value: unknown) => {
      const json = JSON.stringify(value);
      applied.set(BACKUP_KEYS[name], json);
      meta.syncedHash[name] = hashString(json);
      if (name === "appearance") applyRef.current.replaceAppearance(value);
      else applyRef.current.applyStored(BACKUP_KEYS[name], value);
    };

    const upload = async (names: CollectionName[]) => {
      if (!names.length) return;
      const local = await readLocal();
      const rows = names
        .filter((n) => local[n] != null)
        .map((n) => ({ user_id: userId, key: n, value: JSON.parse(local[n]!), device_id: deviceId }));
      if (!rows.length) return;
      setSyncState({ phase: "syncing" });
      const { data, error } = await db.from(TABLE).upsert(rows, { onConflict: "user_id,key" }).select("key,updated_at");
      if (error) throw error;
      for (const r of (data ?? []) as { key: CollectionName; updated_at: string }[]) {
        meta.remoteUpdatedAt[r.key] = r.updated_at;
        meta.syncedHash[r.key] = hashString(local[r.key]!);
      }
      await saveMeta(userId, meta);
      setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
    };

    const fetchRemote = async (): Promise<Row[]> => {
      const { data, error } = await db.from(TABLE).select("key,value,updated_at,device_id");
      if (error) throw error;
      return (data ?? []) as Row[];
    };

    /** Bring this device and the account up to date (both directions). */
    const reconcile = async () => {
      setSyncState({ phase: "syncing" });
      const [remote, local] = await Promise.all([fetchRemote(), readLocal()]);
      const byName = new Map(remote.map((r) => [r.key, r]));
      const toUpload: CollectionName[] = [];
      for (const name of SLICES) {
        const row = byName.get(name);
        const localJson = local[name];
        const localChanged = localJson != null && hashString(localJson) !== meta.syncedHash[name];
        const remoteChanged = !!row && row.updated_at !== meta.remoteUpdatedAt[name];
        if (remoteChanged && localChanged) {
          // Both sides changed since the last sync: the newer change wins.
          const localAt = meta.localChangedAt[name] ?? 0;
          if (Date.parse(row!.updated_at) >= localAt) {
            apply(name, row!.value);
            meta.remoteUpdatedAt[name] = row!.updated_at;
          } else toUpload.push(name);
        } else if (remoteChanged) {
          apply(name, row!.value);
          meta.remoteUpdatedAt[name] = row!.updated_at;
        } else if (localChanged || (!row && localJson != null)) {
          toUpload.push(name);
        }
      }
      await saveMeta(userId, meta);
      if (toUpload.length) await upload(toUpload);
      else setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
    };

    /** First sync of this device with this account. */
    const firstSync = async () => {
      setSyncState({ phase: "syncing" });
      const [remote, localBackup] = await Promise.all([fetchRemote(), createBackup()]);
      const remoteData: BackupFile["data"] = Object.fromEntries(remote.map((r) => [r.key, r.value]));
      const localHas = hasMeaningfulData(localBackup.data);
      const remoteHas = remote.length > 0 && hasMeaningfulData(remoteData);

      let decision: Choice;
      if (!remoteHas) decision = "device";
      else if (!localHas) decision = "cloud";
      else {
        setSyncState({ phase: "choice" });
        decision = await new Promise<Choice>((resolve) => setChoice({ resolve }));
        setChoice(null);
        if (disposed) return;
      }

      if (decision === "cloud") {
        for (const r of remote) {
          apply(r.key, r.value);
          meta.remoteUpdatedAt[r.key] = r.updated_at;
        }
      } else if (decision === "merge") {
        const merged = plannedData(localBackup, { ...localBackup, data: remoteData }, "merge");
        for (const name of SLICES) if (merged[name] !== undefined) apply(name, merged[name]);
        // Let the merged slices save locally before uploading them.
        await new Promise((r) => setTimeout(r, 400));
      }
      meta.firstSyncDone = true;
      await saveMeta(userId, meta);
      if (decision !== "cloud") await upload(SLICES);
      else setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
      if (decision !== "device" || remote.length) {
        applyRef.current.toast({
          message: decision === "cloud" ? "Your account's data is on this device" : decision === "merge" ? "Merged and synced" : "This device's data is synced",
        });
      }
    };

    const flush = () =>
      serialize(async () => {
        if (!meta.firstSyncDone || !pending.size) return;
        const names = [...pending];
        pending.clear();
        try {
          await upload(names);
        } catch (e) {
          names.forEach((n) => pending.add(n));
          fail(e);
        }
      });

    const stopLocal = onLocalWrite((storageKey, json) => {
      const name = sliceForKey(storageKey);
      if (!name || !meta) return;
      if (applied.get(storageKey) === json) {
        applied.delete(storageKey);
        return;
      }
      meta.localChangedAt[name] = Date.now();
      pending.add(name);
      clearTimeout(timer);
      timer = setTimeout(flush, UPLOAD_DEBOUNCE_MS);
    });

    const syncNow = () =>
      serialize(async () => {
        try {
          await (meta.firstSyncDone ? reconcile() : firstSync());
        } catch (e) {
          fail(e);
        }
      });

    (async () => {
      setSyncState({ phase: "connecting", error: null });
      deviceId = await getDeviceId();
      meta = await loadMeta(userId);
      if (disposed) return;
      registerSyncNow(syncNow);
      await syncNow();
      if (disposed) return;

      channel = db
        .channel(`user_data:${userId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: TABLE, filter: `user_id=eq.${userId}` }, (payload) => {
          const row = payload.new as Row | undefined;
          if (!row?.key || row.device_id === deviceId || !meta.firstSyncDone) return;
          if (row.updated_at === meta.remoteUpdatedAt[row.key]) return;
          serialize(async () => {
            apply(row.key, row.value);
            meta.remoteUpdatedAt[row.key] = row.updated_at;
            await saveMeta(userId, meta);
            setSyncState({ phase: "synced", lastSyncedAt: Date.now(), error: null });
          });
        })
        .subscribe();
    })();

    const appSub = AppState.addEventListener("change", (s) => s === "active" && syncNow());
    const onOnline = () => syncNow();
    if (Platform.OS === "web") window.addEventListener("online", onOnline);

    return () => {
      disposed = true;
      clearTimeout(timer);
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
