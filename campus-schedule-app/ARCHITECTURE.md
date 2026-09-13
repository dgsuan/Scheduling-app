# Architecture

This document explains the technical choices behind this scaffold: the
cross-platform framework, the recommended (but not yet implemented)
backend/database approach, the folder structure, and a roadmap that
separates a buildable MVP from later "added features."

Nothing here wires up a real backend, database, or paid service. Those are
recommendations for you to decide on and provision yourself when you're
ready — see "Backend & database" below.

## 1. Framework choice: React Native, via Expo

**Recommendation: React Native, using the Expo toolchain (with Expo
Router for navigation), written in TypeScript.**

There are two realistic contenders for "one codebase, both iOS and
Android": **React Native** and **Flutter**. Both are legitimate, mature
choices used in production apps. Here's the plain-language reasoning for
picking React Native/Expo specifically for *you*:

- **Language you may already know.** React Native uses JavaScript/TypeScript,
  the language of the web. Flutter uses Dart, which is a fine language but
  is one more new thing to learn on top of mobile-specific concepts. If
  you've touched any JavaScript before (or even just HTML/CSS), React
  Native's learning curve is gentler.
- **Expo removes the hardest beginner problem.** Historically, the annoying
  part of React Native wasn't the JavaScript — it was Xcode and Android
  Studio project configuration (signing, native build settings, Gradle,
  CocoaPods). Expo manages all of that for you and gives you **one command**
  (`npx expo start`) that can launch the app in an iOS simulator, an Android
  emulator, or even on a physical phone via the Expo Go app — no native
  build step needed for a scaffold like this one.
- **Expo Router gives you file-based navigation for free.** The folder
  structure you see under `app/` *is* the navigation structure — no
  separate "route config" file to maintain, no manually wiring together the
  4 mockup screens.
- **Huge ecosystem, big community.** Almost any "how do I..." question
  already has a Stack Overflow answer or an existing library, which matters
  a lot when you're still learning.
- **Honest trade-off:** Flutter tends to have slightly better raw
  animation performance and a more "batteries-included" widget set out of
  the box. If this project later needs extremely complex custom animations
  or pixel-perfect custom rendering (more likely for the freeform canvas
  notes feature than anything else here), that's a place where Flutter's
  approach can shine. But for a student schedule/calendar app, React
  Native/Expo is the more beginner-friendly path to something that actually
  runs on both platforms quickly.

**Why not a "native for each platform" approach (Swift/Kotlin
separately)?** That would mean writing and maintaining two entirely
separate apps. It's the highest-effort option and not worth it unless you
specifically want to learn iOS or Android native development, or need deep
platform-specific capabilities this app doesn't need.

## 2. Backend & database

### About the `public-apis` repo you bookmarked

Being direct about this: **[public-apis/public-apis](https://github.com/public-apis/public-apis)
is not relevant to solving your backend/database problem.** It's a curated
list of free third-party APIs for things like weather, currency
conversion, movie data, jokes, etc. It is not a database, not a backend
framework, and it doesn't host anything for you. Nothing in it can store
*your* app's data (notes, imported schedules, user accounts) or serve as
"the backend" for a schedule app. It's the kind of resource you'd reach
for if you needed, say, a public holiday calendar API — not as a
foundation for this project. Worth keeping bookmarked for unrelated future
projects, but it doesn't solve anything here.

### What this app actually needs

Look at what the 4 features require:

1. **Canvas notes** — data that only matters to the one student using the
   phone. No sharing, no multi-device sync requirement stated.
2. **Calendar + export** — same: the student's own events, plus generating
   a URL other calendar apps can subscribe to (this needs *some* small
   piece of always-on hosting to serve that URL — see below).
3. **LMS import** — pulling events from an external calendar feed (UVLE)
   into local storage. This is a one-way read from a source you don't
   control; it doesn't require your own backend to *receive* anything.
4. **Next-class widget** — reads schedule data that's either cached
   locally or fetched from AMIS (a system you don't control and can't
   provision credentials for right now).

None of these strictly require a always-on server *for the MVP*. The one
partial exception is the "export calendar → subscribable URL" feature:
subscribing means some other calendar app (Google Calendar, Outlook, etc.)
periodically re-fetches a URL over the internet, and a phone that's asleep
or offline can't serve that URL itself. That piece genuinely needs
something reachable on the internet, but it can be a small piece added
later — it doesn't need to exist for the MVP.

### Recommendation: start local-first, decide on hosting later

**For the MVP: an embedded, on-device database — no account, no cloud
service, nothing to provision.** Concretely, this means a package like
`expo-sqlite` (a real SQL database that ships inside the app) or, for
something even simpler while the data model is still small and changing,
`@react-native-async-storage/async-storage` (simple key-value storage).
Neither requires you to sign up for anything, configure a cloud project,
or hand over billing details — the data just lives in a file inside the
app's own storage on the phone. This is honestly the right call even
ignoring the "no paid services" constraint: it's the simplest thing that
could work, it works offline (which matters for a student on campus wifi),
and it defers a harder decision until you actually need it.

**When (not if) you outgrow local-only storage** — for example, once you
want the calendar export URL to be servable at all times, or you want a
student's notes to sync between their phone and a browser — that's the
point where a **Backend-as-a-Service (BaaS)** with a free tier becomes
worth it, because it gives you a hosted database *and* a way to run a tiny
bit of server-side code (to serve that export URL) without you having to
manage a server yourself. The two mainstream free-tier options:

- **Supabase** — a hosted Postgres database plus auto-generated APIs and
  simple server functions. Popular because the free tier is generous and
  the underlying database (Postgres) is a widely-used, well-documented,
  standard technology — useful to know beyond just this app.
- **Firebase** (Google) — a hosted NoSQL database (Firestore) plus
  functions, historically the most common "mobile app backend" choice, with
  very good official React Native/Expo support and documentation.

Either would work fine here. This is explicitly **not** decided or
provisioned in this scaffold — per your instructions, no account is
created and no service is configured. Treat "Supabase vs. Firebase vs.
staying local-only a while longer" as a decision to make deliberately,
later, once you know how the export/import features actually need to
behave — not something to lock in on day one.

## 3. Folder structure

```
campus-schedule-app/
├── app/                        # Expo Router: file-based navigation.
│   │                           # Every file here is a screen/route.
│   ├── _layout.tsx             # Root layout (wraps the whole app)
│   └── (tabs)/                 # A route "group" — the 4-tab shell
│       ├── _layout.tsx         # Defines the bottom tab bar
│       ├── index.tsx           # Schedule home (dark mode, Next Class)
│       ├── calendar.tsx        # Month view + export panel
│       ├── notes.tsx           # Blank-canvas notes
│       └── import.tsx          # Import from LMS
├── constants/
│   └── theme.ts                # Shared colors/spacing tokens
├── assets/                     # App icons, splash images
├── app.json                    # Expo app config (name, icons, plugins)
├── package.json
└── tsconfig.json
```

As real logic gets added, the natural next additions (not created yet) are
a `lib/` or `data/` folder for the local database access code, and a
`components/` folder once UI pieces are actually shared between screens —
deliberately not scaffolded now since nothing needs them yet.

## 4. Feature roadmap: MVP vs. later

**MVP (buildable without any backend, account, or paid service):**

1. Local schedule storage — a small on-device database (`expo-sqlite`)
   holding the student's class schedule, entered manually or pasted in,
   which both the Schedule home screen and the Calendar screen read from.
2. Schedule home screen showing real "No Ongoing Class" / "Next Class"
   state computed from that local data and the current time (replacing the
   static placeholder in this scaffold).
3. Calendar month view rendering the same local events (replacing the
   static grid in this scaffold).
4. Canvas notes with real freeform placement and persistence — sticky
   notes the user can add, drag, and resize, saved to local storage.

**Added features (build after the MVP is solid):**

5. LMS import — actually fetching and parsing a UVLE-style calendar feed
   URL and merging its events into local storage.
6. Calendar export / subscribe — generating a real `.ics` feed and a
   stable URL other calendar apps can subscribe to. This is the one
   feature that needs *some* internet-reachable hosting (see "Backend &
   database" above), so it's reasonable to build only once you've decided
   between staying local-only vs. adopting a BaaS.
7. AMIS integration — replacing manually-entered schedule data with data
   read from AMIS, if/however that turns out to be technically possible
   (this depends entirely on what access AMIS actually exposes, which
   hasn't been investigated here).

Authentication, push notifications, and offline sync are deliberately not
on this roadmap — none of the 4 screens need them to function at a basic
level, per the project constraints.

## 5. Design system

The UI is styled two ways on purpose, and both read the same colors:

- **NativeWind (Tailwind for React Native)** with **React Native
  Reusables** — the shadcn/ui component set ported to React Native — under
  `components/ui/`. Used for anything new or rebuilt.
- **`StyleSheet` + the `Palette` object** (`useTheme()`), still used by the
  older screens (Courses, the Notes canvas internals). Both get their
  colors from the same source, so nothing drifts.

### Colors: one identity, shifting atmosphere

`constants/theme.ts` is the single source of color. `buildTheme(scheme,
timeOfDay)` returns:

- `tokens` — CSS custom properties (`--background`, `--primary`, …) that
  `tailwind.config.js` maps to Tailwind classes (`bg-card`, `text-muted-foreground`).
- `palette` — the same colors as hex, for `StyleSheet` code.

Neutrals are warm stone; `--primary` is a deep teal; `--warning` (ochre)
means "due soon" and `--destructive` (brick) means "overdue/delete".

**Time of day** (`lib/timeOfDay.ts`) returns `earlyMorning | morning |
afternoon | evening | night`, and only *re-tints* those same tokens —
warmer and brighter in the morning, softer in the evening, dim and
low-contrast at night (a light background never stays harsh white). It is
never a separate theme, and components never branch on it.

`context/theme.tsx` owns light/dark (OS default, then the user's saved
choice) and the period, applying tokens as CSS variables on `<html>` (web)
and via NativeWind's `vars()` (native). One timer fires at the next period
boundary — nothing polls. `components/AmbientBackground.tsx` paints the
period's soft wash down from the top of the window.

### Motion

Reanimated is already present (NativeWind depends on it); no other
animation library is needed. Springs are short and purposeful: `PopIn` for
things that appear, `TaskCheckbox` for completion, the sliding indicator in
`AppTabBar`, and a lift while dragging notes. On web, hover/press use CSS
transitions via `web:` classes. All of it respects Reduce Motion.

### Gotchas worth knowing

- Reanimated's `Animated.View` **ignores `className`** — animate the outer
  view, style an inner one.
- Gesture Handler callbacks need `.runOnJS(true)` here, since Reanimated
  would otherwise run them as UI-thread worklets.
- React Native Web gives every `View` its own stacking context, so
  overlays (the calendar day popover) need a `zIndex` on an ancestor.
- `Alert.alert` does nothing on web — use `ConfirmDialog`.

## 6. Scheduling rules and the data model

Everything is still local (AsyncStorage → `localStorage` on web), one key
per slice in `STORAGE_KEYS` (`context/store.tsx`). Each slice is written
only when it changes; a failed write (usually quota) surfaces as a toast.

### When does a class happen?

A course's meetings are a weekly **rule**. `lib/schedule.ts` turns the rule
into **dated occurrences**, each with a status, in one function
(`occurrencesOnDate`) that the home screen, calendar, week view, reminders
and `.ics` export all share:

| status        | meaning                                              | stored?                  |
|---------------|------------------------------------------------------|--------------------------|
| `scheduled`   | the class happens                                    | —                        |
| `outsideTerm` | before `settings.term.start` or after `term.end`     | computed                 |
| `cancelled`   | the user cancelled this one date                     | `cancellations:v1` list  |
| `holiday`     | a regular/special holiday and skipping is on         | computed (holiday data)  |

Precedence is term → cancelled → holiday. A `Cancellation` is
`{ courseId, date, start }`, so it targets one meeting on one day and the
weekly rule is untouched; restoring deletes it. `computeNowAndNext` only
sees `scheduled` occurrences and looks ahead up to three weeks (or to the
term start), so holidays, breaks and an ended term all read correctly.

### Other additions (all optional fields; old saves load unchanged)

- **Tasks:** `dueTime`, `start`, `repeat` (rolling series: completing logs a
  done copy with `seriesId` and moves `due` to the next date; course tasks
  stop at term end), `subtasks`, `timeSpentSec`, `source` (import key).
- **Events:** `source` for `.ics` de-duplication.
- **Courses:** `units`; per-course `grades:v1` (weighted components, scores,
  optional recorded `finalGrade`). GWA uses UP's 1.00–5.00 scale.
- **Images:** stored as data URLs (web), downscaled to 1600 px; edits keep
  `originalUri` so they can be reverted.
- **Appearance:** `appearance:v1`, applied as CSS variables. A derived
  snapshot (`campus-schedule-cache:theme`) lets `index.html` paint the right
  theme before the bundle loads — see `scripts/postbuild-web.mjs`.

Keys prefixed `campus-schedule-cache:` are derived or device-local (theme
snapshot, fired reminders, focus timer, pre-restore undo copy) and are not
part of backups.

### Reminders and the installable app

`public/sw.js` makes the app installable and offline-capable. Reminders are
computed on a timer **while the app is open** (tab or installed window) and
shown through the service worker. Delivering them while the app is closed
would need a push server, which this project deliberately doesn't have.
