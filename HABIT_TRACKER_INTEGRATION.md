# Momentum Habit Tracker Integration

Implementation specification for the existing Scheduling App (Isked)

Prepared: 7 November 2026. Status: planning document; no application code or database has been changed.

## 1. Purpose and source

Extend the existing Scheduling App into an integrated scheduling, productivity, and habit system. Preserve classes, tasks, calendars, notes, imports, grades, sharing, settings, and existing user data. Momentum is the habit feature concept, not a required rebrand or replacement app.

Source: the full “Habit Tracker Features” conversation, including the Momentum blueprint and earlier feature discussion (conversation ID `6aef4100-3154-83ec-ad6f-ef0ad869cfb6`). This document carries forward the described features. The conversation referred to an interactive 60-capability inventory and four-phase roadmap without exposing every item in its text; the concrete rules and release gates below are proposed implementation defaults, not claims that those details were previously agreed.

Product principles:

- One-tap tracking for ordinary check-ins; advanced features appear progressively.
- Optional Minimal, Motivational, and Intelligent presets, with independently adjustable features. Presets never delete data.
- Rest, recovery, and restarting are supported. Missed days do not harm a companion or confiscate earned cosmetics.
- Core use requires neither an account nor AI access. Cloud, AI, and social sharing are separate opt-ins.
- Personal scores describe recorded activity toward chosen goals, not personal worth or health.

## 2. Verified codebase and integration boundaries

Repository inspected: `C:/Users/i710th gen/OneDrive/Documents/GitHub/Scheduling-app`.
Application directory: `campus-schedule-app/`. Paths below are relative to that directory unless noted.

The package manifest declares React Native, React, TypeScript, Expo SDK 54, Expo Router, NativeWind, AsyncStorage, and Supabase JS. These are observations from the repository, not an instruction to replace or upgrade its stack. The README still contains scaffold/no-backend claims contradicted by the current source and Supabase migrations; use the source as the implementation baseline.

`AGENTS.md` asks implementers to consult versioned Expo 57 documentation before writing code, while the manifest declares SDK 54. Resolve that documentation/version discrepancy before dependency or native API work; do not upgrade Expo as part of habit integration by default. This document does not depend on unverified external API behavior.

| Existing area | Verified integration point | Required approach |
| --- | --- | --- |
| App state and persistence | `context/store.tsx`, `STORAGE_KEYS`, `StoreSlices`, AsyncStorage/localStorage | Add versioned habit slices, hydration, validation, persistence errors, and existing change notifications. |
| Navigation | `app/(tabs)/_layout.tsx`, `components/AppTabBar.tsx` | Preserve Schedule, Tasks, Calendar, Courses, Notes, Import, Settings routes and deep links. |
| Daily view | `app/(tabs)/index.tsx`, `components/schedule/TodayHero.tsx` | Add a compact habit card without displacing ongoing/next-class information. |
| Calendar | `lib/calendar.ts`, `components/calendar/*` | Extend the agenda union with habit occurrences and reuse month/week/day views. |
| Recurrence | `lib/recurrence.ts`, `lib/schedule.ts`, `lib/dates.ts` | Reuse date helpers and class constraints; add habit recurrence semantics separately. |
| Planning | `lib/planner.ts`, `lib/freeTime.ts`, `app/planner.tsx` | Suggest habit time blocks around commitments, then require acceptance. |
| Reminders | `lib/reminders.ts`, `components/ReminderEngine.tsx`, `lib/notify.*`, `lib/push.*` | Extend the existing reminder pipeline and delivery adapters. |
| Background reminders | `supabase/functions/reminders`, `_shared/jobs.ts`, `public/sw.js` | Extend server eligibility and deduplication as well as foreground behavior. |
| Focus | `context/focus.tsx` | Extend the existing single-session task timer to support habits. |
| Insights | `lib/insights.ts`, `tests/insights.test.ts` | Add deterministic habit calculations alongside existing academic insights. |
| Sync | `lib/syncItems.ts`, `lib/sync.ts`, `components/SyncEngine.tsx` | Extend per-item sync, its collection allowlist, and conflict handling. |
| Backup | `lib/backup.ts`, `components/settings/BackupSection.tsx` | Include habit records in validated, versioned backup and restore. |
| Auth and database | `context/auth.tsx`, `lib/supabase.ts`, `supabase/migrations/*` | Reuse accounts, ownership rules, quotas, and deletion paths. |
| Appearance | `context/theme.tsx`, `constants/theme.ts`, `components/ui/*` | Use current tokens and components. Add optional sage/ivory and charcoal/green presets. |
| Compact access | `app/sticky.tsx`, `components/sticky/*` | Add optional habit quick actions through the same store. |

Important limitations found:

- Existing task recurrence rolls a current task forward and creates completion copies. Habits need durable occurrence history; do not model each habit as a rolling task alone.
- Calendar helpers currently describe local date strings without timezone handling. Habit timezone semantics require an explicit adapter and tests, not assumed existing support.
- Native notification adapters currently report unsupported; native reminders are in-app only. Background web push has an existing optional server path. Native scheduled notifications are later platform work behind the same abstraction.
- The existing focus timer tracks one task, persists an active session, and commits elapsed time on stop/switch. It is not yet a habit Pomodoro system.
- Eka sparkles are appearance decoration, not an existing virtual companion engine.
- The compact sticky view is not a native home-screen widget. Real widgets require separate platform implementation.
- Remote deployment, live database configuration, and installed dependency health were not verified for this documentation task.

## 3. Complete feature scope

### 3.1 Habits, logs, and schedules

Support create/edit/archive/restore, temporary pause, permanent deletion with confirmation, categories, tags, icon/color, search, sorting, drag ordering with keyboard alternatives, templates, optional notes, and links to goals or courses.

Tracking types:

| Type | Input and success rule |
| --- | --- |
| Binary | Explicit done/undo for a scheduled opportunity. |
| Quantity | Add or correct measured amounts; aggregate against a positive target and unit. |
| Duration | Manual time or linked focus sessions; aggregate seconds against target. |
| Reduce/avoid | Log unwanted behavior and explicitly confirm the observation period; success means total at or below the limit. No logs alone never prove abstinence. |

Scheduling supports daily, selected weekdays, every N days from an anchor date, multiple daily slots, flexible N sessions per week, start/end dates, and optional time windows. Store the user's week-start preference. Calendar holidays and semester rules affect habits only when the user explicitly links them; a personal daily habit must not disappear during academic breaks.

Routines group ordered habits into morning/evening/custom sequences. Habit stacking supports “after X, do Y” cues and optional dependencies. Prevent cycles; let users complete a later habit independently with an explanatory override. Reordering a routine does not rewrite logs.

Every action should have immediate feedback, an undo path, and a persistence failure state. Permit historical corrections with an audit trail. Future opportunities can be planned, but cannot earn completion credit before their window begins.

### 3.2 Dashboard and navigation

Keep current top-level navigation initially. Add Habits through a Schedule card and navigation entry where space permits; place Insights and Growth inside the habit area. Settings serves the original “You” concept. Do not append five new mobile tabs or remove existing screens without a separate navigation review.

| Screen | Required contents and actions |
| --- | --- |
| Schedule / Today | Existing class hero; due habits grouped by time/routine; partial progress; one-tap check-in; focus shortcut; optional mood card; daily progress with an explicit denominator. |
| Habit library | Active/paused/archived filters, search, categories, sorting, templates, create action. |
| Habit editor | Type, target/unit, frequency, slots, timezone, reminder, routine, privacy, preview of next opportunities. |
| Habit detail | Current progress, Momentum Score with explanation, current/best streak, history calendar, log editor, notes, schedule history, journey. |
| Calendar | Habit filter, timed slots and untimed weekly progress, conflicts, reschedule and check-in actions; no duplicate task copies. |
| Insights | Weekly/monthly/yearly reports, heatmaps, completion and volume trends, time-of-day/weekday patterns, focus, optional mood associations, recommendations, optional coach. |
| Growth | XP, level, badges, quests, personal rewards, companion, skill tree, growth map, optional challenges. |
| Settings | Feature toggles, appearance/dashboard arrangement, week start/timezone, quiet hours, privacy, AI consent, sync, export/import/delete. |
| Focus overlay | Habit/task name, elapsed time or Pomodoro phase, pause/resume/stop, safe switch handling. |

Every screen needs empty, loading, offline, error, and unavailable-feature states. Onboarding: explain once, select goals, choose 1–3 templates or custom habits, adjust optional features, reach Today. Existing users get a dismissible invitation rather than mandatory onboarding. Request notification permission only when enabling the first reminder.

### 3.3 Analytics and standout functionality

- Heatmaps distinguish completed, partial, missed, excused, paused, and unscheduled dates with text/shape equivalents to color.
- Show completion percentages with numerator, denominator, period, and exclusions. Keep amounts/time separate from frequency compliance.
- Weekly/monthly/yearly views show trends, strongest/struggling weekdays, focus totals, personal bests, and comparison with the previous equivalent period.
- Habit Journey records creation, milestones, goal adjustments, pauses, and comebacks; shareable cards require a privacy preview.
- Personal Growth Map groups chosen categories such as Learning, Health, Productivity, Mindfulness, and Relationships. Default category score is the mean of eligible habit scores, with count and coverage shown; empty categories are “No data.” Do not rank people's worth.
- Goal recommendations suggest a small set of templates aligned with the user's stated goal, available time, and preferences. Never auto-enroll or auto-schedule.
- Adaptive goals suggest both easier and harder targets. Suggested initial rule: at least 14 eligible opportunities; 13/14 full successes can trigger a modest increase; persistent low completion can suggest a smaller target. Show evidence and let users accept, edit, dismiss, or snooze. These thresholds are tunable proposals.
- Mood and energy: optional daily 1–5 ratings with labels, optional note/tags, edit/delete, and separate privacy controls. Missing ratings are unknown, not zero. Reflections can ask what helped or got in the way.
- Mood associations show paired sample count and date range; initially require at least 14 paired days and sufficient variation. This is a display threshold, not statistical proof. Avoid causal or diagnostic language.

## 4. Shared domain rules

Implement one pure occurrence/progress engine consumed by Today, Calendar, reminders, scores, analytics, rewards, and sync reconciliation. UI components must not invent their own completion calculations.

### 4.1 Opportunity lifecycle and time

An opportunity is a scheduled daily slot or flexible weekly quota period. It has a stable identity, schedule version, target snapshot, timezone, start/end boundary, and projected status. Persist exceptions and history; future occurrences can be generated for bounded view ranges instead of materializing years of rows.

Proposed states: pending, partial, completed, missed, excused, paused, canceled. Distinguish state from progress ratio. A skipped reminder is not a skipped habit. An ordinary “skip this session” becomes missed after closure; an explicitly excused rest occurrence is excluded and visibly labeled. Planned pauses create no eligible opportunities. Historical changes remain auditable.

Daily and interval habits close at their configured window/day boundary. Multiple slots each count as an opportunity. For N-per-week habits, the week is one opportunity: ratio is `min(distinct completed sessions / N, 1)`, and full success requires N sessions. Default one qualifying weekly-quota session per local day; an explicit multiple-sessions setting can change that limit. Do not fabricate N missed weekdays.

Store UTC event time, local effective date, IANA timezone, and original offset. Default a habit to its creation timezone; travel does not silently move history. A user-approved timezone change creates a future-effective schedule version. For daylight-saving gaps shift a scheduled time to the next valid local time; for repeated times choose the earlier instance once. Test both rules. A repeated date/time must not create duplicate IDs or reminders.

Schedule/target edits default to future opportunities. “This occurrence” changes only an exception; “this and future” creates a version. Past target snapshots remain unchanged unless the user explicitly requests a historical correction. Rescheduling within an opportunity preserves its ID and replaces pending reminder jobs. Cross-period moves require an explicit treatment of the original opportunity and cannot earn twice.

Archive retains history and stops future reminders. Restore asks when tracking resumes and does not backfill the gap as failures. Unscheduled extra activity is visible in volume/history but does not create extra score credit or completion XP.

### 4.2 Progress, Momentum Score, and streaks

For eligible closed opportunities:

- Binary success: `p = 1` or `0`.
- Quantity/duration: `p = clamp(recorded amount / target snapshot, 0, 1)`.
- Flexible weekly quota: use the session fraction described above.
- Reduce/avoid: `p = 1` only with an explicit period confirmation and a total at/below the limit; otherwise `0`. Show unconfirmed separately from confirmed over-limit in the UI.
- Excused, paused, canceled, unscheduled, and still-open opportunities do not enter the settled score denominator. Show current open progress separately, including already-completed open periods, so calculation is order-independent.

For N in 7, 30, 90, let `C_N = 100 × mean(p)` over the most recent **up to N eligible closed opportunities**, not calendar days. Proposed original formula:

`Momentum = 0.4 × C_30 + 0.4 × C_7 + 0.2 × C_90`

Use available history in each window; normalize weights over nonempty windows. With no eligible history show “Not enough history,” not 0 or 100. With three successes and one miss all three windows use those four observations, yielding 75 with “4 opportunities; early estimate.” Round only the final displayed number. Persist a formula version in any cache. Explain that overlapping windows intentionally emphasize recent performance.

Regression example with enough history: `C_30 = 80`, `C_7 = 100`, `C_90 = 70` yields **86**. One missed opportunity changes the score gradually; it does not reset it to zero. A separate full-completion rate uses only `p = 1`, so partial-credit consistency and full success are never mislabeled as the same measure.

Current/best streaks count consecutive fully successful eligible opportunities; partial or missed closed opportunities break a strict streak. Rest/excused/paused periods neither add nor break; a pending period does not break prematurely. For a weekly quota, label the streak in weeks, not days. Optional streak freezes produce a clearly labeled protected streak without changing the strict streak or Momentum Score. Freezes are recorded exceptions, not erased failures. Comeback milestones recognize returning after a break.

## 5. Scheduling, reminder, and focus integration

### Calendar and tasks

Represent habit calendar entries as references to occurrences, not independent task/event records. Stable keys prevent duplication across agenda, planner, and export. Calendar drag/drop uses the same occurrence exception command as Habit detail.

Optional task linkage can associate a real task with one habit occurrence. Completion behavior is explicit and reversible; task completion is not automatically habit completion unless the user opted into that link. Existing recurring tasks continue working unchanged. ICS export excludes private habits by default and requires preview/selection before including them; exported UIDs remain stable.

Reuse planner availability, classes, cancellations, deadlines, and event conflicts. Show suggested slots and tradeoffs before saving. Do not silently move classes or existing commitments. Flexible weekly habits show remaining quota without pretending a suggested time is mandatory.

### Reminders

Extend the existing `Reminder.kind` and source calculation with habit references. Reuse settings, permission UX, delivery adapters, deduplication, and backend jobs. Define a logical delivery key from owner, occurrence ID, reminder slot, and schedule revision; canceled revisions must not fire.

Support advance reminders, chosen-time reminders, snooze, quiet hours, dismiss, and opt-out. Completion/pause/archive/delete cancels future sends. Maintain foreground/background deduplication and a bounded late-delivery policy so reopening after a week does not flood notifications. Generic lock-screen wording is the default for private habits.

Offline actions update local eligibility immediately. Remote cancellation cannot be guaranteed until sync reaches the server; disclose this delivery limitation in settings. Native background delivery stays marked unavailable until a compatible native adapter is implemented and tested. Do not create a second notification service just for habits.

### Focus timer

Generalize the existing task target to task or habit occurrence while preserving existing task APIs. Add a unique focus session ID and persisted segments for start/pause/resume/stop. Elapsed time derives from timestamps, not interval tick counts. Persist completion intent before committing progress and make replay idempotent by session ID.

Add optional Pomodoro work/break durations; only work time contributes to habit duration. Switching targets safely commits or prompts according to the existing flow; never run two local timers accidentally. A task linked to a habit may receive the same session attribution, but global focus analytics count that session once. Existing historical task totals must not be copied into new habit logs automatically.

Recover after reload, backgrounding, crash, and date rollover. Split analytics attribution across local dates without duplicating the total. Offer adjustment for an accidentally running timer. Concurrent timers from different devices must be surfaced for reconciliation; do not silently double-count overlaps.

## 6. AI coach and recommendations

Ship explainable local rules before conversational AI. Examples include weekday/time patterns, overloaded schedules, manageable starter habits, gentle goal reductions, and weekly plans. Each insight includes evidence range, sample size, calculation version, and an expiry/recompute condition.

The optional coach can explain a score change, compare morning/evening performance, identify recorded patterns, and propose a routine around classes. It must distinguish recorded facts from possible explanations and admit insufficient data.

AI contract:

- Explicit consent for analysis; select which habit/calendar summaries may be sent. Mood, notes, and private habit names are excluded unless separately selected.
- Send minimal aggregates through a server-side integration; never embed provider secrets in the client. Core tracking works when AI is offline, rate limited, or disabled.
- Treat imported text and user notes as data, not executable instructions.
- Return structured suggestions with evidence, affected records, and proposed changes. Validate them against current data and conflicts before presenting a preview.
- Applying a plan requires user acceptance. No silent goals, reminders, schedule edits, purchases, or sharing.
- Provide retention information, delete/history controls, revocable consent, timeouts, quotas, and a useful rule-based fallback. Do not make unverified claims about provider retention.
- No diagnoses or causal claims from correlations. Feedback stays supportive and specific.

## 7. XP, companion, and challenges

All features in this section can be hidden independently while tracking remains intact.

| Reward | Proposed baseline | Guardrail |
| --- | --- | --- |
| Scheduled full completion | 10 XP | One entitlement per eligible occurrence. |
| Meaningful partial completion | 2–8 XP | Proposed minimum 20% progress; cumulative entitlement rises toward 10, never 8 plus another 10. |
| All scheduled habits completed today | 20 XP | At least one eligible daily opportunity; once per local day after closure. Exclude flexible weekly-only quotas from this daily bonus. |
| Weekly quest | 50 XP | Once per quest instance. |
| Personal milestone | 100 XP | Once per milestone definition/version. |

Use per-habit daily caps (proposed 30 completion XP, independently configurable later), bounded quests, and source IDs to prevent repeated toggles, imports, sync retries, or trivial extra logs from farming XP. Define level thresholds in a versioned monotonic table. XP never changes Momentum Score. Purchases, if ever added, cannot buy consistency or competitive rank.

Use a reward ledger and deterministic entitlement reconciliation. Correcting a mistaken log may reverse only its attributable unearned XP; show why. Missing later days never deducts earned XP. Preserve already-earned cosmetics, and never allow a negative spendable balance after corrections.

Achievements: first completion, 7 successful opportunities, 30 sessions, personal best, comeback, balanced growth, and focus milestones. Personal rewards can be user-defined with optional cosmetic currency redemption and a confirmation. Skill trees unlock category-themed cosmetics, not claims of real-world mastery.

The optional companion has a name, appearance, growth stages, animations, and cosmetic unlocks. It remains encouraging after absences and never becomes ill or dies because of missed habits. Respect reduced motion; hiding the companion preserves its state. Reuse appearance infrastructure, but do not treat Eka decoration as a companion implementation.

Challenges include solo daily/weekly quests and optional 7-/30-day friend/group challenges. Snapshot challenge rules, timezone, eligible habits, target, start/end, and reward at enrollment. Progress remains inspectable. Social challenges require opt-in membership, invite/revoke/leave flows, blocking/reporting, visibility controls, and owner/member access checks. Share only explicitly selected aggregates; existing course/section membership does not imply access to habits or mood. Leaderboards are optional and off by default. Offline submissions need duplicate protection and a documented late-sync window before competitive rewards become final.

## 8. Data model and database plan

### 8.1 Physical strategy for this repository

The current Supabase `public.items` table is keyed by `(user_id, collection, id)` with JSONB `data`, `parent`, deletion metadata, timestamps, device metadata, ownership policies, and quotas. The collection allowlist currently contains the app's existing item kinds. Extend this transport for private habit entities first; do not immediately create a parallel database or replace existing auth/sync with the blueprint's suggested stack.

The logical entities below can be separate local slices and per-item collections. The singular collection names are proposed additions. New migrations must extend the server allowlist, payload validation, parent/owner validation, and quotas before new clients upload them. JSON references are not SQL foreign keys: enforce referential integrity deliberately in validation/mutation functions and tests.

Common fields: stable ID, schema version, created/updated timestamps, deletion state where applicable. Cloud ownership comes from authenticated `user_id`, never a trusted client payload. UTC timestamps use ISO strings; local dates use `YYYY-MM-DD`; quantities must be finite, nonnegative, and bounded; durations use integer seconds.

| Logical entity / proposed collection | Key payload fields | Relationships and constraints |
| --- | --- | --- |
| `habits` / `habit` | title, type, unit, category, tags, icon, color, lifecycle, private flag, order, goal/course references | Owned by user; type/unit changes require versioning or a new habit when incompatible. |
| `habit_schedules` / `habit_schedule` | habitId, version, effectiveFrom/To, recurrence, anchor, weekdays, quota, slots, timezone, target, pause intervals | Many versions per habit; no overlapping effective ranges; positive targets except valid avoid limit zero. |
| `habit_occurrence_exceptions` / `habit_exception` | habitId, scheduleVersionId, occurrenceKey, original date, rescheduled bounds, state, reason | Stable unique occurrence reference; cannot refer across owners. |
| `habit_logs` / `habit_log` | habitId, occurrenceKey, effective date, UTC time, timezone/offset, operation, amount, note, source, sourceId, supersedesId | Timestamped events; corrections/retractions reference original events. Deduplicate action/source IDs. |
| `routines` / `routine` | title, ordered habit IDs, cue/dependency edges | Same-owner references; reject cycles and duplicate members. |
| `personal_goals` / `personal_goal` | title, category, optional target date, linked habits | Optional goal-to-habit many-to-many relation. |
| `focus_sessions` / `focus_session` | target type/ID, occurrenceKey, segments, work/break durations, committed state | One commit per session; source for duration logs. |
| `reflections` / `reflection` | local date, timezone, mood, energy, note, tags | Optional values; explicit same-date merge/conflict handling. |
| `habit_scores` / local derived cache | habitId, score, window counts, formula version, input revision, calculatedAt | Rebuildable; not an authoritative sync counter. |
| `insights` / `habit_insight` | kind, evidence, sample size, generatedAt, expiresAt, status, proposed action | Can be dismissed; stale actions revalidated before application. |
| `reward_events` / `reward_event` | source entitlement key, reward type, delta, rule version, reversal reference | Idempotent ledger; totals derived, not merged by adding device balances. |
| `achievements` / versioned definitions | key, requirement, reward, cosmetic | Static definitions initially; unlocks reference reward ledger. |
| `user_rewards` / `reward_profile` | selected cosmetics, equipped unlocks, redemption references | XP/level derived from ledger; validate ownership of unlocks. |
| `companion` / `companion` | name, species/style, equipped cosmetics | One active profile initially; growth derived from earned milestones. |
| `quests` / `quest_instance` | definition/version, period, rule snapshot, enrolledAt | Progress derived from logs; unique reward entitlement. |
| Habit reminder preferences / `habit_reminder` | habitId, slot, offset/time, enabled, privacy wording | Reuse delivery/subscription systems; do not duplicate device tokens. |
| Feature preferences / existing `setting` | modes, feature toggles, dashboard order, AI/privacy choices | Distinguish synced preferences from device-local permissions. |

Derived occurrences use a deterministic key from habit ID, schedule version, period/slot identity. Keep keys under the existing 120-character ID limit; use a stable hash where necessary. Persist enough schedule history to regenerate the same historical key and denominator after a restart or sync.

Social challenges, memberships, shared aggregate progress, and moderation records should use dedicated relational tables when that phase ships: `habit_challenges`, `habit_challenge_members`, and `habit_challenge_progress`, with primary/foreign keys, owner/member RLS, bounded writes, unique challenge/member/period submissions, and server-validated reward issuance. Do not put private raw logs into public tables. Personal-only rewards can remain local; competitive authority cannot trust arbitrary client XP.

If log volume or query needs outgrow JSON items, introduce normalized `habit_logs`/schedules later with measured justification, indexed `(user_id, habit_id, effective_date)` and occurrence/source keys, and an idempotent migration. Maintain one authoritative representation during cutover; do not dual-write indefinitely.

### 8.2 Local/offline and sync correctness

Local creation, check-ins, editing, timers, reports, and export work without a network. Use the existing store/persistence layer initially; do not introduce SQLite merely because it appeared in the original suggested stack. Measure storage and write performance before changing persistence technology.

Extend hydration, storage keys, backup validators, slice/item mapping, remote application, change detection, account switching, clear-data, and deletion paths together. An omitted mapping must not cause a feature to appear saved while being absent from backup or sync.

Existing per-item sync uses a base and a newer-change-wins rule for simultaneous edits. That is insufficient for two devices incrementing one cumulative progress field. Store progress as independently identified events and merge event sets. Binary check-ins and focus completion have stable entitlement/source identities. Two legitimate quantity additions remain separate; a retry of one action does not.

Corrections use immutable revisions/retractions. Concurrent corrections of the same log must converge deterministically and show a resolvable conflict when intent differs. Server timestamps/order resolve ties only as a documented fallback; device wall clocks alone are not trustworthy. Schedule-definition conflicts require a visible choice when they affect future opportunities. Recompute score/streak/reward caches after convergence.

Use durable pending writes and tombstones; never clear an upload before acknowledgement. Retain deletion information long enough for offline devices, with full-resync rules for expired cursors. A deleted habit cannot be resurrected by stale logs. Sign-out/account switch must isolate local private data and queues; offer an explicit choice before merging guest data into an account.

The current server documents item count/size quotas. Habit logs can reach these much faster than courses/tasks: estimate annual volume, surface quota errors, and plan retention/archive/export. Never silently discard historical logs or disable existing protections to accommodate growth. PWA app-shell offline availability is a separate test from having locally stored records.

## 9. Privacy, portability, and accessibility

- Habits are private by default; RLS applies to every synced collection/table. Validate parent ownership, not just outer row ownership.
- Keep private names/notes out of lock screens, widgets, shared calendar exports, friend activity, crash logs, and analytics by default.
- Private mode hides content in UI; localStorage/AsyncStorage are not an encryption guarantee. Device/app lock and encrypted storage require an explicit implementation plan before advertising them.
- Provide full JSON backup, selected CSV progress export, validated restore preview, and undo/recovery where the existing restore flow supports it. Export includes schedule versions/timezones so historical scores can be reproduced.
- Delete one log, one habit, all habit data, or an account with clear scope. Account deletion extends existing cleanup to new tables, derived caches, queued jobs, and social records. Never upload deleted local data on reconnect.
- Separate operational error reporting from optional product analytics. Suggested aggregate measures: first-habit creation, first check-in, week-one return, notification opt-out, and persistence/sync failures; exclude sensitive content.
- Use accessible labels, large touch targets, keyboard navigation, visible focus, readable contrast, scalable text, reduced motion, and screen-reader equivalents for charts. Never rely on green/red alone.

## 10. Implementation phases and release gates

### Phase 1 — Reliable core in the existing app

- [ ] Inventory current state and record baseline checks; confirm Expo documentation/version mismatch before code/dependency changes.
- [ ] Implement pure habit types, schedule versions, occurrence generation, progress rules, and log correction semantics.
- [ ] Add local persistence and backup/import validation before UI writes real records.
- [ ] Ship binary, quantity, duration, and explicit avoid/reduce tracking; daily/weekdays/interval/weekly quotas; pause/archive/history.
- [ ] Add library/editor/detail, Today card, calendar filter, and shared reminder eligibility.
- [ ] Integrate basic focus attribution using the existing timer.
- [ ] Extend optional item sync and server validation; if the server migration is not deployed, clearly label habits local-only and block unsupported uploads.
- [ ] Validate guest/offline operation, migration, first check-in, restart recovery, and existing scheduling regression tests.

Gate: no lost or duplicate logs; old backups and existing screens still work; users can create and complete their first habit without assistance. Test with actual users before widening scope.

### Phase 2 — Consistency and reflection

- [ ] Momentum Score, strict/protected streaks, history heatmaps, weekly/monthly/yearly reports.
- [ ] Routine ordering, stacking/dependencies, goal templates, mood/energy/reflections.
- [ ] Journey, growth map, rule-based recommendations, adaptive target previews.
- [ ] Offline merge conflict UX, quota handling, selected CSV export, compact sticky quick actions.
- [ ] Assess native widget/background notification support separately; ship only supported capabilities with honest labels.

Gate: deterministic calculations across screens/devices; reproducible historical scores; accessible reports; suggestions explain their evidence and require acceptance.

### Phase 3 — Optional motivation

- [ ] Idempotent XP ledger, levels, achievements, daily/weekly quests, personal rewards.
- [ ] Companion, cosmetic skill tree, growth stages, optional milestone celebrations.
- [ ] Feature presets, dashboard customization, appearance presets, private share-card previews.

Gate: undo/replay/import/sync cannot inflate rewards; hidden gamification leaves core usable; missed days do not punish the user or companion.

### Phase 4 — Connected intelligence and community

- [ ] Permissioned server-side AI coach with minimal context and rule-based fallback.
- [ ] Accepted routine generation around existing commitments; revalidate stale suggestions.
- [ ] Optional friend/group challenges, moderation, shared aggregates, server-authoritative competitive rewards.
- [ ] Native widgets/notification adapters and external integrations only after platform capability validation.
- [ ] Capacity review, retention/export policy, security review, and staged feature rollout.

Gate: verified ownership/consent boundaries, revocable sharing, safe failure modes, measured performance, and no regressions to local tracking. No account/AI/social dependency introduced into the core path.

## 11. Acceptance tests

| Area | Required scenario and expected result |
| --- | --- |
| Existing behavior | Classes, cancellations, semester boundaries, task recurrence, imports, notes, grades, sharing, sticky view, settings, and current focus continue functioning. |
| Basic tracking | Binary toggle/undo, quantity increments/corrections, manual duration, and confirmed avoid limits produce the same result everywhere. |
| Recurrence | Daily, selected weekdays, N-day intervals, multiple slots, leap days, year boundary, and start/end dates produce no duplicate or phantom opportunities. |
| Flexible quota | Three sessions/week yields 2/3 partial progress after two qualifying sessions, one weekly success after three, no penalty for other weekdays, and no bonus score for a fourth. |
| Timezones | Travel, DST gap/overlap, midnight, and week-start changes preserve historical dates and occurrence identities; one reminder per logical slot. |
| Schedule changes | Future target change leaves prior target snapshots intact; rescheduling cancels the old reminder; restore does not mark archived time missed. |
| Momentum | 80/100/70 window example yields 86; 3 successes/1 miss yields 75 with early-history label; no history is unknown; open/rest periods are excluded. |
| Streaks | Partial/missed closed opportunity breaks strict streak; pending/rest does not; a freeze affects protected streak only. |
| Timer | Pause/resume/switch/reload/crash and duplicate stop commit once; breaks excluded; cross-midnight totals conserved; linked task/habit focus not double-counted. |
| Persistence | Offline log survives restart; failed storage write is surfaced and retryable; backup includes every new slice. |
| Sync | Two offline devices add different quantity events and both survive; replayed ID counts once; conflicting corrections converge visibly; deletion prevents stale resurrection. |
| Reminders | Completion, snooze, pause, archive, quiet hours, denied permission, late reconnect, and overlapping foreground/server delivery obey the same eligibility rules. |
| Rewards | Repeated check-in/undo, backup restore, sync retry, and threshold crossing never multiply XP; corrected partial-to-full earns a total of 10, not 18. |
| Privacy | Another account cannot read/write a habit or attach a log to it; private content absent from notifications, exports, sharing, telemetry, and AI unless selected. |
| AI | No consent means no provider request; fabricated IDs/invalid schedules rejected; unavailable provider falls back; accepted changes previewed and revalidated. |
| Challenges | Nonmembers denied; leaving/revocation removes future access; duplicate/late submissions follow rules; raw habit data never becomes public. |
| Migration | Old local data/backups upgrade without losing unrelated records; interrupted migration recovers; unsupported future backup versions are rejected clearly. |
| Accessibility | Check-in, reorder, history review, chart reading, and undo usable by keyboard/screen reader; reduced motion respected. |
| Performance | Suggested starting budget: 100 active habits and 10,000 logs, check-in feedback under 100 ms and Today usable within 2 s on an agreed midrange device; measure and revise explicitly. |

Use the existing package scripts as the regression starting point: `npm run typecheck`, `npm run test:logic`, `npm run export:web`, and appropriate `npm run test:browser` suites. Extend the actual script lists so new tests are executed. Security tests use dedicated test accounts/environment; do not point destructive fixtures at personal data. Add focused tests for occurrence semantics, score arithmetic, event merge/idempotency, and migration failures rather than UI snapshots that merely mirror implementation.

This documentation-only task did not run app builds, deploy migrations, or certify these acceptance criteria as passing.

## 12. Instructions for the implementing developer

1. Read this document and current repository instructions, then re-inspect the app; the source may have changed since this snapshot.
2. Extend Isked in small, reviewable phases. Preserve branding and current workflows. Do not scaffold a replacement app.
3. Start with domain rules, persistence, migrations, and tests; add UI over that shared engine. Proposed helper modules such as `lib/habits.ts`, `lib/habitOccurrences.ts`, and `lib/habitScores.ts` should follow current conventions.
4. Reuse calendar, planner, notifications, focus, auth, sync, backup, settings, and UI primitives. Add adapters where capability is missing, not parallel systems.
5. Keep private data and event history authoritative; derive counters and caches. Never implement the system as only a mutable streak or done flag.
6. Ship server compatibility before enabling new cloud collections. Use additive migrations, backup/version checks, and feature flags. Rollback disables new features without dropping user history.
7. Treat proposed score details, quotas, reward caps, and thresholds as visible product defaults that can be revised with versioning. Record any changed semantics and migrate deliberately.
8. Finish each phase with its acceptance tests and a clear report of shipped capabilities, limitations, and remaining work. Do not describe planned AI, native notifications, widgets, encryption, or social verification as implemented.
