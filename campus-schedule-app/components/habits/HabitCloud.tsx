import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { AppState, Platform, View } from 'react-native';
import { useAuth } from '@/context/auth';
import { useHabitCloudStore } from '@/context/store';
import { Button } from '@/components/ui/button';
import { Text } from '@/components/ui/text';
import { supabase } from '@/lib/supabase';
import { onLocalWrite } from '@/lib/syncEvents';
import { acceptCloudHabit, habitRowKey, planHabitSync, sameHabitValue, type HabitCloudConflict, type HabitCloudRow } from '@/lib/habitSync';

type Status = { owner: string | null; message: string; busy: boolean; conflicts: HabitCloudConflict[] };
let status: Status = { owner: null, message: '', busy: false, conflicts: [] };
const listeners = new Set<() => void>();
const update = (patch: Partial<Status>) => { status = { ...status, ...patch }; listeners.forEach(fn => fn()); };
let request: (() => void) | undefined;
let resolveConflict: ((id: string, choice: 'local' | 'cloud') => Promise<void>) | undefined;
const useStatus = () => useSyncExternalStore(cb => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => status, () => status);
const message = (error: unknown) => {
  const e = error as { message?: string; code?: string };
  if (e.code === '40001') return 'Changed on another device. Sync again to review the latest version.';
  return e.message || 'Could not reach habit cloud storage. Your saved changes stay on this device; retry when online.';
};
const offline = () => Platform.OS === 'web' && typeof navigator !== 'undefined' && !navigator.onLine;
const OFFLINE_MESSAGE = 'Offline · Saved on this device. Will sync when you reconnect.';
async function capability() {
  if (!supabase) throw new Error('Sign in to enable habit sync.');
  const { data, error } = await supabase.rpc('habit_sync_version');
  if (error) throw error;
  if (data !== 2) throw new Error('Habit sync needs database update 0008. Your habits remain saved on this device.');
}

/** Habit adapter over the existing account, item table and local-write events.
 * Separate reconciliation rules preserve immutable log sets and require CAS for
 * definitions. The ordinary item engine deliberately excludes these collections.
 */
export function HabitSyncEngine() {
  const auth = useAuth();
  const store = useHabitCloudStore();
  const live = useRef({ auth, store }); live.current = { auth, store };
  const owner = store.data.cloud?.ownerId;
  useEffect(() => {
    if (!auth.ready || !store.ready || store.locked || !owner || owner !== auth.user?.id || !supabase) {
      update({ owner: null, message: '', busy: false, conflicts: [] });
      request = undefined; resolveConflict = undefined;
      return;
    }
    const db = supabase;
    let disposed = false, running = false, again = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const active = () => !disposed && live.current.auth.user?.id === owner && live.current.store.data.cloud?.ownerId === owner && !live.current.store.locked;
    const write = async (row: HabitCloudRow, expected: string | null) => {
      if (!active()) throw new Error('Account changed; habit sync stopped.');
      const { data, error } = await db.rpc('write_habit_item', {
        p_owner: owner, p_collection: row.collection, p_id: row.id, p_parent: row.parent,
        p_data: row.deleted ? {} : row.data, p_deleted: row.deleted, p_expected: expected,
      });
      if (error) throw error;
      return data as HabitCloudRow;
    };
    const sync = async () => {
      if (!active()) return;
      if (offline()) { update({ owner, busy: false, message: OFFLINE_MESSAGE }); return; }
      if (running) { again = true; return; }
      running = true; again = false;
      update({ owner, busy: true, message: 'Syncing habits…' });
      try {
        if (live.current.store.error) throw new Error('Save your local habit changes successfully before syncing.');
        await capability();
        const { data, error } = await db.rpc('read_habit_items');
        if (error) throw error;
        if (!active()) return;
        const before = live.current.store.data;
        const plan = planHabitSync(before, data as HabitCloudRow[]);
        if (plan.conflicts.length) {
          update({ owner, message: 'A habit was edited on two devices. Choose which definition to keep; check-in history is retained.', conflicts: plan.conflicts });
          return;
        }
        update({ conflicts: [] });
        if (!sameHabitValue(before, plan.data)) {
          let applied = false;
          const saved = await live.current.store.change(current => {
            if (!sameHabitValue(current, before)) return current;
            applied = true; return plan.data;
          });
          if (!saved) throw new Error('Cloud changes could not be saved on this device. Retry saving first.');
          if (!applied) { again = true; return; }
        }
        for (const item of plan.uploads) {
          if (!active()) return;
          const acknowledged = await write(item.row, item.expected);
          if (!active()) return;
          const saved = await live.current.store.change(current => {
            if (current.cloud?.ownerId !== owner) return current;
            const base = { ...current.cloud.base }, key = habitRowKey(item.row);
            if (acknowledged.deleted) delete base[key];
            else base[key] = { data: acknowledged.data, updated_at: acknowledged.updated_at };
            return { ...current, cloud: { ...current.cloud, base } };
          });
          if (!saved) throw new Error('Upload succeeded, but its acknowledgement could not be saved. Retry saving; the upload is safe to replay.');
        }
        if (active()) update({ message: again ? 'Checking remaining habit changes…' : 'Habits synced', conflicts: [] });
      } catch (e) { if (active()) update({ message: live.current.store.error ? message(e) : offline() ? OFFLINE_MESSAGE : `${message(e)} Your changes are saved locally; sync will retry automatically.` }); again = false; }
      finally {
        running = false;
        if (active()) { update({ busy: false }); if (again) timer = setTimeout(() => void sync(), 500); }
      }
    };
    request = () => { void sync(); };
    resolveConflict = async (id, choice) => {
      if (running || !active()) return;
      running = true; update({ busy: true });
      try {
        const { data, error } = await db.rpc('read_habit_items');
        if (error) throw error;
        if (!active()) return;
        const row = (data as HabitCloudRow[]).find(r => r.collection === 'habit' && r.id === id && !r.deleted);
        const local = live.current.store.data.habits.find(h => h.id === id);
        if (!row || !local) throw new Error('Habit changed or was deleted. Sync again.');
        if (choice === 'local') {
          const acknowledged = await write({ ...row, data: local }, row.updated_at);
          if (!active()) return;
          await live.current.store.change(current => ({ ...current, cloud: { ...current.cloud!, base: { ...current.cloud!.base, [habitRowKey(row)]: { data: acknowledged.data, updated_at: acknowledged.updated_at } } } }));
        } else {
          await live.current.store.change(current => {
            const next = acceptCloudHabit(current, row.data as typeof local);
            return { ...next, cloud: { ...next.cloud!, base: { ...next.cloud!.base, [habitRowKey(row)]: { data: row.data, updated_at: row.updated_at } } } };
          });
        }
        update({ conflicts: [], message: 'Definition selected. Syncing check-ins…' });
        again = true;
      } catch (e) { if (active()) update({ message: message(e) }); }
      finally { running = false; if (active()) { update({ busy: false }); if (again) void sync(); } }
    };
    const unsubscribe = onLocalWrite(key => {
      if (key !== 'campus-schedule:habits:v1') return;
      if (running) { again = true; return; }
      update({ message: offline() ? OFFLINE_MESSAGE : 'Saved on this device · Waiting to sync' });
      clearTimeout(timer); timer = setTimeout(() => void sync(), 1200);
    });
    const interval = setInterval(() => void sync(), 60000);
    const app = AppState.addEventListener('change', state => { if (state === 'active') void sync(); });
    const reconnect = () => { clearTimeout(timer); void sync(); };
    const disconnect = () => { if (active()) update({ owner, message: OFFLINE_MESSAGE }); };
    if (Platform.OS === 'web') { window.addEventListener('online', reconnect); window.addEventListener('offline', disconnect); }
    void sync();
    return () => { disposed = true; clearTimeout(timer); clearInterval(interval); app.remove(); unsubscribe(); if (Platform.OS === 'web') { window.removeEventListener('online', reconnect); window.removeEventListener('offline', disconnect); } request = undefined; resolveConflict = undefined; };
  }, [auth.ready, auth.user?.id, store.ready, store.locked, owner]);
  return null;
}

export function HabitCloudControls() {
  const { user, ready: authReady } = useAuth();
  const store = useHabitCloudStore();
  const cloud = useStatus();
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const connect = async (merge: boolean) => {
    setBusy(true); setError('');
    try { await capability(); await store.open(user!.id, merge); setConfirm(false); }
    catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  };
  const connected = !!user && !store.locked && store.data.cloud?.ownerId === user.id;
  const needsAttention = store.locked || !!error || !!store.error || (connected && cloud.owner === user.id && cloud.conflicts.length > 0);
  return <View className="bg-card border-border mb-5 gap-3 rounded-xl border p-4">
    <View className="flex-row items-center justify-between gap-2"><Text className="text-muted-foreground flex-1 text-sm" accessibilityLiveRegion="polite">{connected && cloud.owner === user.id ? cloud.message : store.locked ? 'Account access needed' : 'Saved on this device'}</Text><Button size="sm" variant="ghost" accessibilityState={{ expanded: expanded || needsAttention }} onPress={() => setExpanded(!expanded)}><Text>{expanded ? 'Close' : 'Sync settings'}</Text></Button></View>
    {(expanded || needsAttention) && <View className="gap-3">
    {!authReady || !store.ready ? <Text>Loading account…</Text> : connected ? <>
      <Text className="text-muted-foreground text-sm">{cloud.owner === user.id ? cloud.message : 'Connecting habits…'} · {user.email}</Text>
      <Button variant="outline" disabled={cloud.busy} onPress={() => request?.()}><Text>{cloud.busy ? 'Syncing…' : 'Sync habits now'}</Text></Button>
      {cloud.owner === user.id && cloud.conflicts.map(c => <View key={c.id} className="gap-2"><Text>{c.title}: local “{c.local.title}” / cloud “{c.remote.title}”</Text><Text className="text-muted-foreground text-xs">Local schedule starts {c.local.schedules.at(-1)?.from}; cloud schedule starts {c.remote.schedules.at(-1)?.from}. Keeping a definition replaces the other definition, not check-ins.</Text><View className="flex-row flex-wrap gap-2"><Button disabled={cloud.busy} variant="outline" onPress={() => void resolveConflict?.(c.id, 'local')}><Text>Keep this device's definition</Text></Button><Button disabled={cloud.busy} variant="outline" onPress={() => void resolveConflict?.(c.id, 'cloud')}><Text>Keep cloud definition</Text></Button></View></View>)}
    </> : <>
      <Text className="text-muted-foreground text-sm">{store.locked ? 'The habits saved here belong to another account. They are hidden and will not be uploaded to this account.' : 'Habits are saved on this device. Enable sync to keep them with your signed-in account.'}</Text>
      {user ? <Button disabled={busy} onPress={() => setConfirm(true)}><Text>{store.locked ? 'Open my account habits' : 'Enable habit sync'}</Text></Button> : <Text className="text-muted-foreground text-sm">Sign in through Settings → Account & sync to connect habits.</Text>}
      {store.locked && !user && <Button variant="outline" onPress={() => void store.open()}><Text>Open guest habits</Text></Button>}
      {confirm && <View className="border-border gap-3 border-t pt-3"><Text>Connect to {user?.email}. Your existing guest habits will only be uploaded if you choose to include them. Other saved account profiles stay on this device.</Text>{!store.locked && !store.data.cloud && <Button disabled={busy} onPress={() => void connect(true)}><Text>Include my guest habits</Text></Button>}<Button variant="outline" disabled={busy} onPress={() => void connect(false)}><Text>Open account without guest habits</Text></Button><Button variant="ghost" onPress={() => setConfirm(false)}><Text>Cancel</Text></Button></View>}
    </>}
    {!!error && <Text className="text-destructive">{error}</Text>}
    {!!store.error && <Text className="text-destructive">{store.error}</Text>}
    </View>}
  </View>;
}
