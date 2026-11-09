# Habit integration — first local release

## 9 November offline access and automatic reconnect

- Habit records and pending changes remain in the existing durable local profile. Browser online events now trigger immediate reconciliation; foreground activation and periodic retries remain fallbacks. Offline status explains that local changes will sync on reconnect, and transport failures are no longer mislabeled as a missing migration.
- Auth restores the SDK's saved device session for local access without waiting for network token refresh. Explicit auth changes still replace/clear that identity, and another account's habits remain hidden. Cloud RPCs still require valid server credentials.
- Service-worker installation now caches the entry HTML's JS/CSS dependencies before completing, including the initial visit whose scripts loaded before worker control. Open the deployed app online once and allow caching before using it offline. Clearing browser storage removes local records/cache. Reconnection sync runs while the app is open; no closed-app background-sync guarantee is made.
- Passed TypeScript, web export, pure sync tests, real browser offline reload/create/persistence checks, and mocked cloud tests covering expired-token offline startup, automatic reconnect upload, conflicts and account isolation. No hosted database or deployment changes were made.

## 8 November UX and quality-of-life additions (local)

See `HABIT_GROWTH_SETUP.md` for current behavior, limitations and backend setup. Added Today/Library/Insights, progressive creation, functional templates, compact cloud controls, management inside Details, quantity shortcuts, undo-last, routine labels/cues, optional reflections/moods, period reports, activity calendar, CSV and derived milestones. These supersede the corresponding pending items below.

Duration habits now support Study → Break → Continue, live progress, saved focus blocks, configurable/optional Pomodoro (25/5, 30/10, 60/20 or custom), break countdowns and persistent in-app prompts. Breaks do not earn duration credit. Day-boundary caps prevent overnight overcounting. Inactivity reminders have per-habit enable/disable, custom intervals and allowed hours, reset after activity, goal suppression and 15-minute snooze. App-open delivery only; global reminders must be on.

Added source for optional consent-based AI coaching and invitation-only accountability circles, with migration 0009 and the habit-coach Edge Function. Backend setup/deployment is still required. The user subsequently authorized tests; nothing was published.

### Verification after authorization

Goal-edit correction: saving a target/unit now updates the current daily or weekly goal immediately and carries it forward. Dated goal history preserves closed periods and existing occurrence IDs/check-ins; schedule changes still take effect on the displayed future date. Resaving a previously queued target also fixes today's stale card. The added metadata works with the existing cloud schema; no extra SQL migration is required. Older app builds should be refreshed to display the new goal history.

- TypeScript and production web export passed.
- All logic suites passed, including added reminder interval/reset/quiet-hours/snooze tests, reports, CSV privacy/formula escaping, milestones and configuration validation.
- Habit browser tests passed: daily tracking, history, phone layout/navigation, study/break/continue, reload recovery, capped Pomodoro timing, no break credit, free timer, editable reminder settings, actual inactivity toast/snooze, storage failure/retry and Calendar. A new failed-create/retry regression caught duplicate habits; stable editor IDs now prevent that, and the test passes.
- Mocked two-account/two-device cloud browser tests passed, including offline corrections, conflicts and account isolation.
- Isolated PostgreSQL tests passed for migrations 0007–0009, reruns, immutable history, ownership, CAS, circle invitations/membership/check-in/undo/leave, rate limiting and anonymous denial.
- The real coaching handler passed with mocked auth/provider IO: consent, authentication, input limits, rate-limit failure, privacy allowlisting and response parsing. No live model requests or hosted database writes were made.
- Fixed missing web aria-selected state on navigation tabs. Updated stale planning/guide test expectations; both suites pass.
- All 14 browser suites passed across the initial run, resumed suites and corrected reruns: core browser, images, settings, features, CRS, planning, deadlines, guide, Form 5, Eka, board, responsive layouts, sticky and habits. The initial sequential run was interrupted when a rebuild replaced its served files; remaining suites were rerun against the completed build. The resumed batch reported the two stale assertions above as failures; both passed their subsequent individual reruns. No failing test remains from these runs.
- Live `test:security` was not run: it requires two configured real test accounts and writes to hosted Supabase. The isolated database tests cover the new security rules locally. No native-device or live AI/provider test was performed.

This implements the initial usable tracking slice of `../HABIT_TRACKER_INTEGRATION.md`. It does **not** claim completion of all four phases or all Phase 1 release gates.

## Available

- Habits is a primary navigation destination with a leaf icon and the existing `/habits` link. Desktop shows all destinations in the sidebar. Mobile shows Schedule, Tasks, Habits, Calendar and More; More contains Courses, Notes, Import and Settings. Schedule quick check-ins and command-palette access remain available.
- Create and edit binary, quantity, duration, and explicitly confirmed avoid/reduce habits. Search by name/category; active, paused, archived and all filters; introductory name templates; notes and categories.
- Daily, selected weekdays, anchored intervals, multiple daily slots, start/end dates, and weekly quotas with one qualifying session per day. Weekly periods currently start Monday.
- Timezone-aware boundaries, earliest repeated DST time, and gap advancement. Saved schedule versions retain prior targets. Schedule edits are future-effective.
- Check-in, manual amounts/time, explicit avoid confirmation, immutable undo entries, date-based historical corrections, and confirmed deletion of a habit with its logs.
- Shared occurrence/progress calculations, open-period exclusion, Momentum Score, current/best strict streak, and a text-labeled 14-day history view.
- Calendar month entries and week-strip entries link to habit history, with a hide/show filter. Private habits are not included in ICS export.
- Existing focus timer supports duration habits, pause/resume/reload and replay-safe commit IDs. A failed habit save retains the paused session for retry.
- Existing reminder pipeline supports generic habit reminders at a slot's start, checks completion/archive/pause, and uses its existing late-delivery limit. Global reminder settings must be enabled. Habit background delivery is unavailable.
- Versioned local storage, serialized writes, visible failure/retry, validation on hydration and restore, JSON backup v2 with habit counts, and restore undo. Old backups remain accepted; replacing from an older backup that lacks habits preserves current habit data.
- Optional habit sync is implemented in the working tree, using the existing Supabase account and item table with a dedicated immutable-event reconciliation adapter. Habits stay outside generic newer-change-wins sync. Enabling requires database capability version 2 and an explicit guest-data choice. Account profiles are separately cached; a different account's active profile is hidden until switching. A habit-specific status shows pending changes, errors, conflicts and successful sync.

## Current boundaries and remaining roadmap

- The user reports applying migration 0007. Migration `0008_habit_sync_compare_and_swap.sql` is additionally required before enabling client sync. It prevents stale definition writes, checks the expected account, blocks older clients' generic habit writes, and provides a consistent read snapshot. Both migrations pass isolated PostgreSQL tests; hosted deployment of 0008 and a real two-device production smoke test remain pending. Habit background reminders remain unavailable.
- Pause/archive stops current reminder eligibility immediately; the schedule pause begins tomorrow. Resume begins tomorrow. Today's existing opportunity/history is retained. There is no occurrence-excuse or reschedule editor yet.
- Calendar week view lists habits in the strip rather than timed blocks. Weekly progress repeats as a reference to the same opportunity on each date, not independent records. Planner suggestions, conflict previews, task linkage and sticky actions are not implemented.
- Habit focus currently attributes a session to its selected occurrence/date. Cross-midnight segment attribution, Pomodoro phases, multi-device timer conflicts, and timer adjustments remain future work.
- Schedule edits preserve prior versions. Backup merge imports whole new habits and their logs, keeping existing habits unchanged; it is not a two-device event-history merge.
- Cloud sync unions independently identified check-ins, preserves durable local pending changes through reload, and acknowledges writes only after success. Conflicting definitions require an explicit local/cloud choice; incompatible schedule history is rejected rather than dropped. Full snapshots currently fetch the account's habit rows (bounded by existing account quotas), so large-history performance still needs measurement. Personal account deletion clears its local habit cache; guest and other account caches remain separate.
- External JSON backups omit cloud ownership/base metadata. Restore retains the current profile's ownership and sync base. Export/restore is blocked while the active habit profile belongs to another account. Account caches are device-local storage, not encrypted vaults.
- Reordering, tags, richer routine sequencing, broader goals, protected streaks and automatic adaptive suggestions remain in the roadmap. Sorting, routine labels/cues, period reports, CSV and optional reflections are now implemented locally as described above.
- Derived activity points, levels and milestones are implemented locally. Companion/cosmetics, growth map, feature presets, richer social challenges, native widgets and native background notifications remain unimplemented. Optional AI coaching/circle source exists but still requires backend setup.
- No user acceptance study or 100-habit/10,000-log device benchmark has been performed. This is not a production release certification.

## Compatibility and verification

Read the repository-required Expo 57 reference and checked the manifest's SDK 54 baseline. No Expo dependency, SDK upgrade, or new native API was introduced; existing app abstractions are reused.

Checks: `npm run typecheck`, `npm run test:logic`, `npm run export:web`, and `node tests/habits.browser.test.mjs`. New pure tests are included in `test:logic`; the habit browser scenario is included in `test:browser`. `npm run test:habits` runs both habit suites against an already exported build.

Browser scenarios cover creation, check-in/undo, restart persistence, history, mobile overflow, pause/resume, focus recovery/commit, storage failure/retry, and Calendar filtering. Screenshots are written under `tests/.output/`.

Cloud checks: `npm run test:habit-cloud` uses simulated API/accounts to test capability gating, consent, two-device propagation, offline corrections, reload, replay, definition conflicts and account-switch isolation. It requires a local build configured for Supabase and `.env.local`; it intercepts API requests and never writes to the hosted project. `npm run test:habit-database` uses the separately installed PGlite test runtime to test the real SQL migrations, ownership, quotas inherited from the item schema, immutability, compare-and-swap, old-client rejection, and deletion/account cascades. The pure merge tests also run in `test:logic`.
