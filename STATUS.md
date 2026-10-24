# Status — Sorted

_Last updated: 23 September 2026. First version, written from a read of the
repo rather than from memory of the work — correct anything that looks wrong._

## What this is

Say anything and have Claude sort it into the right list. Groceries, to-dos and
what you're watching live in one app, shared with the household, synced so it is
the same on every device.

The idea that holds it together: what a list *does* — how it groups, whether it
clears itself after a shop, where a ticked item goes next — is columns on the
`lists` row rather than code. A new kind of list needs no new rendering path.

## Where it runs

| | |
|---|---|
| Framework | Next.js 16 (App Router) — note `src/proxy.ts`, the renamed middleware |
| Data | Supabase (Postgres, Auth, Realtime) |
| Hosting | Vercel; production branch is `main` |
| AI | `ANTHROPIC_API_KEY`, server-side only, in `src/app/api/capture/route.ts` |
| Email | Gmail SMTP for the "Email me" button — needs its **own** app password, separate from the one in Supabase's SMTP settings |

Six migrations in `supabase/migrations/`, run in order.

## Where we're up to

Working and shared with the household. Last pushed **7 September 2026**, so
about two weeks quiet.

Capture handles four things: adding items, updating something already on a list,
answering a question, and running an action — and always shows a receipt naming
where things went, with one undo. That receipt is what makes automatic routing
safe to trust.

Three commands (tick off, switch list, read aloud) are matched in the browser
before anything reaches the API, so they work in a supermarket dead spot.

## Open items

- [ ] **The sign-up allow-list is enforced in the UI, not the database.** The
  login page checks `allowed_emails` before sending a code, but someone calling
  Supabase's auth API directly would bypass it entirely. Fine while the link is
  only shared with people trusted to use the app normally. The real fix is a
  Supabase Auth Hook rejecting disallowed sign-ups at the database level.
- [ ] **The morning email is built but not scheduled.** *Send mine now* works
  today. The 6am version needs a `vercel.json` cron, a `CRON_SECRET`, and
  `SUPABASE_SERVICE_ROLE_KEY`. The schedule is deliberately not committed — see
  the Gotchas.
- [ ] **Realtime needs turning on for the `items` table** in the Supabase
  dashboard under Database → Replication. Without it, live sync silently doesn't
  happen — ticking milk off in the aisle won't reach the other phone.
- [ ] **A free Supabase project pauses after a week of inactivity.** Worth
  knowing before blaming the app for being broken after a quiet fortnight.

## Gotchas

- **`SUPABASE_SERVICE_ROLE_KEY` bypasses every row-level security policy.** It
  is why the morning cron isn't committed. If it is ever switched on, the route
  re-applies the private-list rule by hand, because the policies that normally
  enforce it have been bypassed — that line is the one to watch in any change.
- **The sign-in code is deliberately not a clickable magic link.** Outlook's
  Safe Links pre-visits links in incoming mail and burns single-use tokens before
  anyone clicks. A numeric code has nothing for a scanner to consume. Don't
  "improve" this back into a link.
- **Supabase's Site URL must be the deployed URL, not localhost** — Supabase
  falls back to it when building links, so leaving it on localhost sends people
  confirmation links their phone can't open.
- **`npm run build` needs the Supabase env vars set**; they are inlined into the
  client bundle at build time.
- **Two lists of people, and confusing them looks like a bug.** *Who can sign up*
  is who may create an account at all; *Household* is who shares your lists. Being
  on the first doesn't create an account.
- **Making a shared list private hides it from everyone else**, and only the
  person who did it can share it back.
- **Clear bought archives rather than deletes** — and that archive is what *Add
  the usuals* reads. Deleting it would quietly break a feature.
- **Pick something never invents a title.** Recommending something new would mean
  knowing what is on Stan this month; a confident suggestion for a show that left
  six months ago is worse than none.
