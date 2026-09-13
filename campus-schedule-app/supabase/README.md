# Supabase setup

The app works fully offline without any of this. With it, people get accounts,
sync, course sharing and class sections.

## Database

Run each file in `migrations/` once, in order, in **Supabase → SQL Editor → New
query** (paste → Run). They're safe to re-run.

| File | Adds |
| --- | --- |
| `0001_user_data.sql` | The first, whole-slice sync table (now read-only; read once to migrate). |
| `0002_items_sharing_safety.sql` | Per-item sync, file storage, course sharing, class sections, account deletion, and every abuse limit below. |

## What the database enforces

All of it is checked by Postgres itself, so it holds even for someone calling
the API directly with their own login (dev tools, curl, a script):

- **Row Level Security everywhere.** You only ever read or write your own
  items and files. Signed-out visitors get nothing except `ping()`.
- **Sizes.** 1 MB per synced item, 25 MB and 20,000 items per person; files
  up to 5 MB, 50 MB and 1,000 files per person, and only images, PDF, Office
  and text files. The storage bucket is private.
- **Rate limits** (per person): 3,000 item writes a minute (heavier writes
  count more), 30 course shares a day, 60 share-code lookups an hour,
  20 section joins an hour, 10 new sections a day, 30 posts an hour.
  Failed guesses count too, so codes can't be brute-forced.
- **Codes** are 10 random characters (~50 bits). A wrong code and a banned
  user get the same answer, and nobody can list codes.
- **Sections.** Only members see a section, its posts and its members
  (display names only, never emails). Members can post and delete their own
  posts; only the owner can remove or ban members, change the invite code, or
  delete others' posts. At most 300 members, 500 posts, 20 owned sections.
- **Integrity.** The server stamps timestamps, ids and owners can't be
  changed, deleted items can't carry hidden data, shared courses are
  stripped to known fields.
- **Deleting an account** requires a password sign-in within the last
  10 minutes, then removes the user and everything they own.

Checked by `node tests/security.test.mjs` (see the top of that file; it needs
two existing accounts and cleans up after itself).

## Dashboard settings worth changing

These live outside SQL, under **Authentication**:

1. **Sign In / Providers → Email:** set *Minimum password length* to 8 and
   require letters and digits. The app asks for 8, but only this setting
   enforces it for direct API calls.
2. **Rate Limits:** keep the defaults or lower them (sign-ups, sign-ins,
   emails per hour) to slow down spam accounts.
3. **Attack Protection:** turn on CAPTCHA if you ever see bot sign-ups
   (needs a small app change to show the challenge).

## Keys

- The **publishable** key (in `.env.local` and the GitHub repo Variables) is
  meant to be public; the rules above are what protect data.
- Never put the **secret / service_role** key or the database password in the
  app, the repo, or GitHub Variables. They bypass every rule.

## Keeping the free project awake

Free projects pause after a week without activity. The
`Keep Supabase awake` GitHub Action calls `ping()` every ~3 days. GitHub
disables scheduled workflows after 60 days without commits — re-enable it in
the Actions tab if that happens.
