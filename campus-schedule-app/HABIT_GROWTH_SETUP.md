# Habit quality-of-life and optional growth setup

These changes are local source changes, not a deployed release. The user subsequently authorized testing on 8 November 2026. TypeScript, the web export, logic tests, habit browser scenarios, mocked cloud synchronization, isolated PostgreSQL migrations/RPCs, and the mocked AI Edge handler have passed. Hosted Supabase deployment, real-provider AI calls, and native-device behavior have not been verified. See HABITS_STATUS.md for regression results.

## Using the daily features

Open **Habits → New habit → Study**. The template starts with a 120-minute daily goal, which is editable. The card offers **Start studying → Take a break → Continue**, plus **Finish & save** while a session exists. Taking a break saves that focus block immediately; break time is excluded. The live progress includes the current unsaved block, which is persisted with the timer and committed on break/finish. The app supports one timer at a time.

Under **Customize habit**, independently turn Pomodoro on or off. Presets are 25/5, 30/10 and 60/20 minutes; both durations can also be entered manually (1–1440 minutes). Timed blocks pause at the limit and show a persistent in-app prompt. The break starts when accepted. After a break, focus resumes only when the user chooses Continue. With Pomodoro off, the timer runs freely and manual breaks still exclude rest time. Preference changes apply to the next block. Existing scheduled goals are preserved; target/schedule changes start on the displayed future date.

Focus counts are capped at the local day boundary, even after the app was suspended. It does not automatically distribute one overnight session across two days. A new session on the next day uses that day's occurrence. A failed save retains the stopped session for retry with a stable source ID.

For **Drink water**, the template suggests 8 glasses and an optional 120-minute inactivity interval. Users should customize the amount to their own needs. Reminders remain off until enabled. In Customize, turn reminders on/off, enter an inactivity interval, and set the start/end of allowed reminder hours (defaults 09:00–21:00 in the habit timezone). Leave the interval blank to use scheduled-slot reminders. Check-ins reset the interval; achieving the goal suppresses further reminders. An in-app reminder offers **Snooze 15 min**. Global app reminders must also be enabled in Settings. Interval reminders are evaluated with the existing short missed-delivery window, so a long absence does not generate a backlog.

Habit and focus prompts currently require the app to be running. A browser may delay timers while backgrounded; elapsed study time is still capped, but prompts may appear when returning. System notifications use generic text; an active in-app reminder can show the habit name. No native background scheduling or widgets are claimed.

## Other additions

- Today, Library and Insights views; compact sync controls; management inside Details.
- Templates with real defaults, quick quantity additions, undo-last and optional manual entry.
- Routine labels, habit cues, search and sorting. Optional reflections and mood entries stay in personal habit history and JSON backup, not coaching/circle payloads or activity CSV.
- Week/month/year closed-goal completion summaries, a labeled 28-day activity view, optional points/levels/milestones, and web CSV export. Activity points count at most once per habit/day; missing days never deduct points. Editing or deleting the underlying records recalculates derived milestones.

## Optional circles and AI coaching

1. Apply `supabase/migrations/0009_habit_growth.sql` after 0002 and 0008 in the Supabase SQL Editor. The user previously reported applying 0007 and 0008; this new migration has not been applied by this coding session.
2. Circles then become available under **Habits → Insights → Accountability circle** for signed-in users. They use separate RPC-only tables. Nothing is copied automatically from personal habits. Joining shares a chosen display name; each shared daily check-in is explicit and can be undone. Leaving removes that member's shared records. Deleting a circle removes everyone's circle records but leaves personal habits intact. Creators can replace the invitation code. Limits: 10 circles per account, 20 members per circle, rate-limited operations. This is a small accountability feature, not a public feed, chat or competitive challenge system.
3. For optional AI coaching, add `OPENAI_API_KEY` and `HABIT_COACH_MODEL` as **Supabase Edge Function secrets**, using a Responses API-compatible model available to the app owner's account. Never use `EXPO_PUBLIC_` for these secrets or put the key in client code. Configure provider billing/usage limits before enabling it.
4. Deploy the `habit-coach` Edge Function. It verifies the caller's bearer token itself. If the project uses publishable keys and requires disabling legacy gateway JWT verification, deploy with `supabase functions deploy habit-coach --no-verify-jwt`; application-level `auth.getUser(token)` remains mandatory and is implemented.
5. Deploy the frontend only when ready. This session has not deployed or published it.

The coaching UI asks permission on every request and previews the aggregate counts. The server allowlists numeric totals for up to 50 habits over 30 days; no habit names, individual entry dates, notes, moods, IDs or account details are sent to the model. Suggestions cannot perform app actions. Requests are limited to 2/minute and 20/day per account. The function does not log prompts or responses and asks the Responses API not to store the response. This does not promise zero provider retention. API behavior reference: [OpenAI Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create).

## Still outside this implementation

Native widgets, closed-app habit notifications, a cosmetic companion/inventory, public challenges or social moderation tools, protected-streak policies, automatic adaptive goal edits, drag-to-reorder routines, and a full cross-day focus-session ledger remain future work. The earlier blueprint is broader than this implemented feature set. No claim is made that all roadmap phases are complete.
