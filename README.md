# Sorted

Say anything and have Claude sort it into the right list. Groceries, to-dos and
what you're watching all live in one app, shared with your household, synced via
Supabase so it's the same on every device.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations in `supabase/migrations/` **in order**:
   - `0001_init.sql` — creates the original `tasks` table and its row-level security policies.
   - `0002_allowed_emails.sql` — creates the invite-only allow-list (see [Restricting who can sign up](#restricting-who-can-sign-up)) and seeds it with the first user's email.
   - `0003_households_and_lists.sql` — households, lists, and the move from one flat task list to many. **Take a database export before running this one**: it renames `tasks` to `items`, rewrites every security policy, and backfills existing rows. A free Supabase project has no point-in-time recovery to fall back on.
   - `0004_list_transitions.sql` — lets a list say where a promoted or ticked item goes, which is how "Start watching" and filing a finished show under Watched work without the app knowing anything about television.
   - `0005_household_management.sql` — the functions behind the settings screen. Adding someone needs a lookup in `auth.users`, which the browser can't see and shouldn't be able to, so it runs server-side with an ownership check.
   - `0006_due_dates_and_invites.sql` — due dates on items, grouping a list by when things are due, and the function that shows who has actually signed up.
3. In **Authentication → Providers**, email/password is on by default.
4. In **Authentication → Emails → Magic Link**, edit the template so it shows the numeric code, e.g. add `<p>Your code: {{ .Token }}</p>` (the default template only shows a clickable link, which Outlook's Safe Links scanner "clicks" for you and burns before you get to it — see [How it works](#how-it-works)).
5. In **Authentication → URL Configuration**, add `http://localhost:3000/auth/callback` (and your deployed URL's equivalent) to the redirect allow list — used for the password sign-up confirmation email.
6. Copy the project URL and anon key from **Project Settings → API**.

### 2. Anthropic API key

Get a key from the [Anthropic Console](https://console.anthropic.com). It's only ever used server-side (in `src/app/api/capture/route.ts`) — never exposed to the browser.

### 3. Gmail app password for "Email me"

The "Email me" button sends the same Gmail account already used for SMTP login codes (see [How it works](#how-it-works)), but it needs its **own** app password — Google only shows an app password once, and the one already pasted into Supabase's SMTP settings can't be retrieved again. Generate a second one:

1. Sign into that Gmail account → [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. Name it something like "Sorted" and create it.
3. Copy the 16-character password (spaces don't matter, with or without them works).

### 4. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
GMAIL_ADDRESS=
GMAIL_APP_PASSWORD=
```

### 5. Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` until you sign in.

> `npm run build` requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to be set (`.env.local` covers this locally) — they're inlined into the client bundle at build time.

## How it works

- **Auth** — Supabase Auth (email/password, or a one-time email code). The code flow deliberately avoids a clickable magic link: Microsoft 365/Outlook's Safe Links protection pre-visits links in incoming email to scan them, which silently burns single-use magic-link tokens before the user ever clicks — a numeric code has nothing for the scanner to consume. `src/proxy.ts` (Next.js 16's renamed middleware) redirects unauthenticated requests to `/login` and keeps the session cookie fresh.
- **Lists** — a household holds one or more people plus the settings they share (streaming services, viewing profiles, the order of the aisles in their supermarket). Every list belongs to a household and is shared with it, unless `private_to` names one person — that's how a private to-do list sits beside a shared grocery list without a second sharing mechanism. Several lists can share a `group_name`, which is how "Watching now" and "Want to watch" appear as two sections under one TV pill rather than two pills.
- **Per-list behaviour is data, not code** — how a list groups itself (by streaming service, by supermarket aisle, or not at all), whether it clears itself after a shop, and whether finished items show are columns on the `lists` row. A new list needs no new rendering path.
- **Main view** (`src/app/page.tsx`) — a pill per group with open counts, one list on screen at a time, and the last one you used remembered. Every row is the same component; what differs between a grocery item and a TV show is which fields have values.
- **Capture** (`/api/capture`) — everything typed or dictated goes here, and Claude decides which of four things it meant: **add** new items (each routed to a list), **update** something already on a list ("we're up to episode six of Severance"), **ask** a question answered rather than stored ("have we watched Ripley?"), or **do** an action such as reading a list aloud. Whichever it was, the app shows a receipt naming where things went, with one undo — that receipt is what makes automatic routing safe to trust.
- **Dictation** — uses the browser's built-in Web Speech API (no server round-trip). Not supported in every browser (notably: not Firefox) — typing works everywhere as a fallback. Saying "create list" (or "create the list" / "make the list") while dictating stops the mic and submits automatically, instead of requiring a button tap.
- **"Email me"** — `/api/email-list` takes the lists you're looking at (or all of them), fetches their open items, and sends them grouped by list to your own account email via the same Gmail SMTP relay used for login codes, using `nodemailer` server-side.

## Restricting who can sign up

Sign-up is invite-only. The `allowed_emails` table (migration `0002`) holds the list of emails permitted to create an account; the login page checks it (via the `is_email_allowed` SQL function) before sending a code or creating a password account. Anyone marked `is_owner` on their `household_members` row gets a "Manage access" panel on the main page to add or remove emails.

Before migration `0003` the admin's email was hardcoded in two places, the page and the RLS policies. It no longer is: ownership is a column, and the migration makes each existing user the owner of their own household.

This check runs in the app's UI, not as a database-level lock — someone who called Supabase's auth API directly (bypassing the web app entirely) could still sign up with an email that isn't on the list. Fine for sharing a link with people you trust to just use the app normally; if that gap ever matters, the stronger fix is a Supabase Auth Hook that rejects disallowed sign-ups at the database level.

## Deploying

Deploy to [Vercel](https://vercel.com/new) and set the same environment variables there. The free tiers of both Supabase and Vercel are enough for personal use — note a free Supabase project pauses after a week of inactivity unless you're on a paid plan.

Vercel's production branch is `main` — every push to it publishes a Production deployment; pushes to any other branch get a preview URL instead.

## Sharing lists with someone else

1. Add their email under **Who can sign up** in Settings.
2. Have them sign up.
3. Add them by email under **Household** in Settings.

Anything they'd already built up on their own comes with them, and their private
lists stay private. Only the household owner can add or remove people.

A list is shared with the whole household unless it's marked private to one
person. Careful with that switch: making a shared list private hides it from
everyone else, and only the person who did it can share it again.

## The TV lists

Watching now, Want to watch and Watched share a `group_name`, so they appear as
three sections under one TV pill. Each is grouped by streaming service, with
anything whose service isn't known collected at the bottom behind a **Where?**
button that sets it from the services your household has configured.

Moving between them is configuration, not code. `promote_to` on Want to watch
points at Watching now, which is what the play button follows; `done_to` on
Watching now points at Watched, which is where a ticked show files itself.
Un-ticking walks it back. Any other pair of lists gets the same behaviour by
filling in those two columns.

**Have we watched this** searches all three sections in the browser, with no
round trip, and answers with the service and whose profile it was on — the thing
the streaming apps can't tell you when you each have your own profile. It only
knows what's in the app, so anything watched before this existed comes back as
no match.

**Pick something** (`/api/pick`) chooses from titles you have already saved and
never invents one. Recommending something new would mean knowing what is on Stan
this month, which changes constantly; a confident suggestion for something that
left the service six months ago is worse than no suggestion at all.

## Groceries

The list groups into supermarket sections and orders them by the household's
`aisle_order`, so it reads in the order you walk the shop rather than the order
things were said. Claude tags each item with a section at capture time; anything
it can't place collects at the end under "Not sorted yet".

**Clear bought** archives the ticked items rather than deleting them. A shopping
list is a session, not a record — without it, every week's shop stacks up until
you're scrolling past hundreds of ticked items to find this week's.

**Add the usuals** reads that archive and puts back what you buy most weeks:
counted case-insensitively, anything bought twice or more, most frequent first,
skipping whatever is already on the list. It runs entirely in the browser, so it
costs nothing and works as well on the tenth shop as the hundredth. Before there
is history it says so rather than adding nothing silently.

## Settings

`/settings` holds the household and its people, the streaming services, the
viewing profiles, the supermarket order, the lists, and the sign-up allow-list.
It's a separate screen because the main screen is for the lists: a panel opened
twice a year shouldn't sit above them.

Everything saves as you change it — there's no Save button, because there's
nothing here you'd want to fill in and then abandon. A failed save puts the old
value back rather than leaving the screen showing something that isn't true.

## Voice commands

The capture box takes four kinds of thing: items to add, a change to something
already on a list, a question, or an action to run. Say "go" (or "that's it",
"done", "send it") to stop dictating and send it.

Three commands never reach the API at all. Ticking an item off, switching list,
and reading a list aloud are matched in the browser first (`src/lib/commands.ts`),
so they are instant, cost nothing, and — the point of the exercise — still work
in a supermarket dead spot where a round trip would just hang.

That matcher is deliberately a fast path rather than a parser. It only ticks
when exactly one open item matches, and anything it isn't confident about
returns nothing and goes to Claude. So "got the milk" ticks the milk when milk
is on a list, and falls through to be added when it isn't.

Actions that send to another person, or that can't be undone, ask first. Clearing
a shop is a reasonable thing to say out loud and a bad thing to get wrong.

## Today versus the rest

The to-do list groups by when things are due: **Today**, **This week**, **Later**,
**Whenever**. Anything overdue joins today rather than getting an "Overdue"
heading of its own, because it's still a thing to do now and a permanent red
section is a section you stop reading.

It's a date rather than a star on purpose. A star flagged "today" is still
flagged tomorrow, and a list where everything is starred is a list where nothing
is. A date sorts itself out as time passes.

Set one with the calendar button, or just say it: "clean the car today", "book
the car service before Friday". No day mentioned means no due day rather than a
guess.

**Snooze** (the clock button) hides something until 5am tomorrow. It's not done
and not deleted, and the count sits at the bottom of the list with a way to wake
it, so nothing quietly disappears.

## Two lists of people

These are different, and confusing them looks like a bug:

- **Who can sign up** — email addresses permitted to create an account at all.
- **Household** — people who have an account *and* share your lists.

Being on the first doesn't create an account. Someone has to sign up themselves
before they can be added to a household, so the sign-up list shows each address
as "hasn't signed up yet", "signed up, add them above", or "in your household".

## Live sync

Ticking milk off in the aisle appears on the other phone without a refresh, over
Supabase Realtime. It's included in the free plan and its limits are sized for
far more than a household.

The incoming row always wins: it's the database's version, and briefly losing
your own optimistic edit beats the two of you seeing different lists. **This
needs Realtime turned on for the `items` table** in the Supabase dashboard, under
Database → Replication.
