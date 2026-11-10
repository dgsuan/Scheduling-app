// Isolated PostgreSQL tests. No network, real accounts, or project data.
// Install test runtime only: npm install --prefix tests/.output/habit-db --no-save --package-lock=false @electric-sql/pglite
import { PGlite } from './.output/habit-db/node_modules/@electric-sql/pglite/dist/index.js';
import fs from 'node:fs';
import assert from 'node:assert/strict';
const db = new PGlite();
const userA = '00000000-0000-0000-0000-000000000001';
const userB = '00000000-0000-0000-0000-000000000002';
const sql = fs.readFileSync(new URL('../supabase/migrations/0002_items_sharing_safety.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const migration = fs.readFileSync(new URL('../supabase/migrations/0007_habit_sync_foundation.sql', import.meta.url), 'utf8').replaceAll('\r\n', '\n');
try {
  await db.exec(`create role authenticated; create role anon; create schema auth;
    create table auth.users (id uuid primary key);
    insert into auth.users values ('${userA}'), ('${userB}');
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
    create table public.user_data (id text);
    grant usage on schema auth to authenticated, anon;`);
  await db.exec(sql.slice(sql.indexOf('create table if not exists public.rate_limits'), sql.indexOf('-- =========================================================================\n-- File storage')));
  await db.exec(migration);
  await db.exec(migration); // Re-running must be safe.
  const casMigration = fs.readFileSync(new URL('../supabase/migrations/0008_habit_sync_compare_and_swap.sql', import.meta.url), 'utf8');
  await db.exec(casMigration);
  await db.exec(casMigration);
  const growth = fs.readFileSync(new URL('../supabase/migrations/0009_habit_growth.sql', import.meta.url), 'utf8');
  await db.exec(growth);
  await db.exec(growth);
  await db.exec('grant select, insert, update, delete on public.items to authenticated;');
  const asUser = async id => { await db.exec('reset role;'); await db.query("select set_config('test.uid', $1, false)", [id]); await db.exec('set role authenticated;'); };
  const habit = { id: 'h1', title: 'Read', type: 'binary', category: 'Learning', notes: '', createdAt: 1, reminder: false,
    schedules: [{ id: 's1', from: '2026-11-08', timezone: 'Asia/Manila', frequency: 'daily', weekdays: [1], interval: 1, quota: 3, weekStart: 1, slots: ['00:00'], target: 1, unit: 'times', state: 'active' }] };
  const log = { id: 'l1', habitId: 'h1', occurrenceKey: 'h1:s1:2026-11-08:00:00', date: '2026-11-08', at: 1, amount: 1, confirmed: false, sourceId: 'focus1' };
  const put = async (collection, id, data, parent = null, deleted = false, owner = userA) => {
    if (collection === 'habit' || collection === 'habit_log') {
      const old = await db.query('select updated_at::text as stamp from public.items where user_id=$1 and collection=$2 and id=$3', [owner, collection, id]);
      return db.query('select public.write_habit_item($1,$2,$3,$4,$5,$6,$7)', [owner, collection, id, parent, JSON.stringify(data), deleted, old.rows[0]?.stamp ?? null]);
    }
    return db.query(`insert into public.items(user_id,collection,id,data,parent,deleted) values ($1,$2,$3,$4,$5,$6)
      on conflict(user_id,collection,id) do update set data=excluded.data,parent=excluded.parent,deleted=excluded.deleted`, [owner, collection, id, JSON.stringify(data), parent, deleted]);
  };
  await asUser(userA);
  const circle = async (action, id = null, code = null, name = null, title = null) => (await db.query('select public.habit_circle_action($1,$2,$3,$4,$5,$6) as result', [action,id,code,name,title,'Asia/Manila'])).rows[0].result;
  const created = await circle('create', null, null, 'Alice', 'Study buddies');
  assert.equal(created.members.length, 1);
  assert.ok(created.invite);
  await assert.rejects(db.query('select * from public.habit_circles'), /permission denied/);
  await asUser(userB);
  await assert.rejects(circle('detail', created.id), /unavailable/);
  await assert.rejects(circle('join', null, 'wrong', 'Bob'), /unavailable/);
  const joined = await circle('join', null, created.invite, 'Bob');
  assert.equal(joined.invite, null);
  assert.equal(joined.members.length, 2);
  await assert.rejects(circle('rotate', created.id), /creator/);
  let shared = await circle('check', created.id);
  assert.equal(shared.members.find(m => m.me).days, 1);
  shared = await circle('check', created.id);
  assert.equal(shared.members.find(m => m.me).days, 1, 'check-in is idempotent');
  shared = await circle('undo', created.id);
  assert.equal(shared.members.find(m => m.me).days, 0);
  await circle('leave', created.id);
  await assert.rejects(circle('detail', created.id), /unavailable/);
  await asUser(userA);
  const rotated = await circle('rotate', created.id);
  assert.notEqual(rotated.invite, created.invite);
  await db.query('select public.consume_habit_coach()');
  await db.query('select public.consume_habit_coach()');
  await assert.rejects(db.query('select public.consume_habit_coach()'), /wait a minute/);
  await circle('leave', created.id);
  assert.deepEqual(await circle('list'), []);
  assert.equal((await db.query('select public.habit_sync_version() as v')).rows[0].v, 2);
  await assert.rejects(put('habit_log', 'l1', log, 'h1')); // Parent first.
  await assert.rejects(put('habit', 'h1', habit, null, false, userB));
  await put('habit', 'h1', habit);
  await assert.rejects(put('habit', 'h1', { ...habit, focusMinutes: 0 }));
  await assert.rejects(put('habit', 'h1', { ...habit, reminderStart: '21:00', reminderEnd: '09:00' }));
  await put('habit', 'h1', { ...habit, pomodoroEnabled: false, focusMinutes: 30, breakMinutes: 10, reminderEveryMinutes: 120 });
  await assert.rejects(db.query("update public.items set deleted=true where id='h1'"), /versioned habit API/);
  const stamp = (await db.query("select updated_at::text as stamp from public.items where id='h1'")).rows[0].stamp;
  const cas = (data, expected) => db.query("select (public.write_habit_item($3,'habit','h1',null,$1,false,$2)).*", [JSON.stringify(data), expected, userA]);
  await cas({ ...habit, title: 'Changed elsewhere' }, stamp);
  await assert.rejects(cas({ ...habit, title: 'Stale device' }, stamp));
  await cas({ ...habit, title: 'Changed elsewhere' }, stamp); // Lost-ack replay.
  assert.equal((await db.query('select public.read_habit_items() as snapshot')).rows[0].snapshot.length, 1);
  await put('habit_log', 'l1', log, 'h1');
  await put('habit', 'h1', { ...habit, goals: [{ from: '2026-11-08', target: 13, unit: 'glasses' }], anytimeFrom: { [habit.schedules[0].id]: '2026-11-08' } });
  const goalSnapshot = (await db.query('select public.read_habit_items() as snapshot')).rows[0].snapshot;
  assert.equal(goalSnapshot.find(row => row.collection === 'habit').data.goals[0].target, 13, 'goal updates round-trip without changing used schedules');
  assert.equal(goalSnapshot.find(row => row.collection === 'habit').data.anytimeFrom[habit.schedules[0].id], '2026-11-08', 'Any time unlock round-trips alongside immutable logged schedules');
  await put('habit_log', 'l1', log, 'h1'); // Idempotent retry.
  await assert.rejects(put('habit_log', 'l2', { ...log, id: 'l2' }, 'h1')); // Source uniqueness.
  await assert.rejects(put('habit_log', 'l1', { ...log, amount: 8 }, 'h1'));
  await assert.rejects(put('habit', 'h1', { ...habit, schedules: [{ ...habit.schedules[0], target: 8 }] }));
  await put('habit', 'h1', { ...habit, title: 'Read books' });
  await put('habit_log', 'undo1', { ...log, id: 'undo1', sourceId: undefined, retracts: 'l1', amount: 0 }, 'h1');
  await assert.rejects(put('habit_log', 'undo2', { ...log, id: 'undo2', sourceId: undefined, retracts: 'missing' }, 'h1'));
  await assert.rejects(put('habit', 'bad', { ...habit, id: 'bad', schedules: [{ ...habit.schedules[0], timezone: 'invalid' }] }));
  await asUser(userB);
  await assert.rejects(cas(habit, null));
  assert.equal((await db.query('select public.read_habit_items() as snapshot')).rows[0].snapshot.length, 0);
  assert.equal((await db.query("select * from public.items where collection = 'habit'")).rows.length, 0);
  await assert.rejects(put('habit_log', 'stolen', { ...log, id: 'stolen' }, 'h1', false, userB));
  assert.equal((await db.query("update public.items set deleted=true where id='h1' returning id")).rows.length, 0);
  await asUser(userA);
  assert.equal((await db.query("delete from public.items where id='h1' returning id")).rows.length, 0);
  await put('habit', 'h1', {}, null, true);
  assert.equal((await db.query("select * from public.items where collection='habit_log' and not deleted")).rows.length, 0);
  await assert.rejects(put('habit', 'h1', habit));
  await assert.rejects(put('habit_log', 'late', { ...log, id: 'late' }, 'h1'));
  await put('task', 'existing', { title: 'Existing task' });
  assert.equal((await db.query("delete from public.items where id='existing' returning id")).rows.length, 1);
  await db.exec('reset role; set role anon;');
  await assert.rejects(db.query('select public.habit_sync_version()'));
  await assert.rejects(db.query('select public.read_habit_items()'));
  await assert.rejects(db.query("select public.habit_circle_action('list')"));
  await assert.rejects(db.query('select public.consume_habit_coach()'));
  await db.exec(`reset role; delete from auth.users where id='${userA}';`);
  assert.equal((await db.query('select * from public.items')).rows.length, 0);
  console.log('PASS migration/re-run, ownership, validation, immutable history, idempotency, tombstones, deletion cascade, existing items, signed-out access');
} finally { await db.close(); }
