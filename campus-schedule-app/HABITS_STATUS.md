# Habit integration — first local release

This implements the initial usable tracking slice of `../HABIT_TRACKER_INTEGRATION.md`. It does **not** claim completion of all four phases or all Phase 1 release gates.

## Available

- Schedule → Manage habits, `/habits`, and command-palette navigation; original tabs remain intact.
- Create and edit binary, quantity, duration, and explicitly confirmed avoid/reduce habits. Search by name/category; active, paused, archived and all filters; introductory name templates; notes and categories.
- Daily, selected weekdays, anchored intervals, multiple daily slots, start/end dates, and weekly quotas with one qualifying session per day. Weekly periods currently start Monday.
- Timezone-aware boundaries, earliest repeated DST time, and gap advancement. Saved schedule versions retain prior targets. Schedule edits are future-effective.
- Check-in, manual amounts/time, explicit avoid confirmation, immutable undo entries, date-based historical corrections, and confirmed deletion of a habit with its logs.
- Shared occurrence/progress calculations, open-period exclusion, Momentum Score, current/best strict streak, and a text-labeled 14-day history view.
- Calendar month entries and week-strip entries link to habit history, with a hide/show filter. Private habits are not included in ICS export.
- Existing focus timer supports duration habits, pause/resume/reload and replay-safe commit IDs. A failed habit save retains the paused session for retry.
- Existing reminder pipeline supports generic habit reminders at a slot's start, checks completion/archive/pause, and uses its existing late-delivery limit. Global reminder settings must be enabled. Habit background delivery is unavailable.
- Versioned local storage, serialized writes, visible failure/retry, validation on hydration and restore, JSON backup v2 with habit counts, and restore undo. Old backups remain accepted; replacing from an older backup that lacks habits preserves current habit data.
- Habit uploads are explicitly excluded from both the sync slice list and item mapping. Habits are device-local, including when signing in; they are not isolated into account-specific device profiles.

## Current boundaries and remaining roadmap

- No habit server migration or deployment. Cloud event merging, account-specific local isolation, quotas, tombstones, conflict resolution, and server reminders remain required before enabling cloud habits.
- Pause/archive stops current reminder eligibility immediately; the schedule pause begins tomorrow. Resume begins tomorrow. Today's existing opportunity/history is retained. There is no occurrence-excuse or reschedule editor yet.
- Calendar week view lists habits in the strip rather than timed blocks. Weekly progress repeats as a reference to the same opportunity on each date, not independent records. Planner suggestions, conflict previews, task linkage and sticky actions are not implemented.
- Habit focus currently attributes a session to its selected occurrence/date. Cross-midnight segment attribution, Pomodoro phases, multi-device timer conflicts, and timer adjustments remain future work.
- Schedule edits preserve prior versions. Backup merge imports whole new habits and their logs, keeping existing habits unchanged; it is not a two-device event-history merge.
- Sorting/reordering, tags, routines, stacking, goals, extended reports, CSV, reflections, protected streaks and adaptive suggestions remain in the roadmap.
- Rewards, companion, growth map, feature presets, AI coach, social challenges, native widgets and native background notifications are not implemented.
- No user acceptance study or 100-habit/10,000-log device benchmark has been performed. This is not a production release certification.

## Compatibility and verification

Read the repository-required Expo 57 reference and checked the manifest's SDK 54 baseline. No Expo dependency, SDK upgrade, or new native API was introduced; existing app abstractions are reused.

Checks: `npm run typecheck`, `npm run test:logic`, `npm run export:web`, and `node tests/habits.browser.test.mjs`. New pure tests are included in `test:logic`; the habit browser scenario is included in `test:browser`. `npm run test:habits` runs both habit suites against an already exported build.

Browser scenarios cover creation, check-in/undo, restart persistence, history, mobile overflow, pause/resume, focus recovery/commit, storage failure/retry, and Calendar filtering. Screenshots are written under `tests/.output/`.
