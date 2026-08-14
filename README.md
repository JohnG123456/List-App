# Task List

Dictate a list of tasks, have Claude turn it into a task list, and check tasks off — synced to your account via Supabase so it's the same list on every device.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migrations in `supabase/migrations/` **in order**:
   - `0001_init.sql` — creates the `tasks` table and row-level security policies scoping each user to their own tasks.
   - `0002_allowed_emails.sql` — creates the invite-only allow-list (see [Restricting who can sign up](#restricting-who-can-sign-up)) and seeds it with the admin's email.
3. In **Authentication → Providers**, email/password is on by default.
4. In **Authentication → Emails → Magic Link**, edit the template so it shows the numeric code, e.g. add `<p>Your code: {{ .Token }}</p>` (the default template only shows a clickable link, which Outlook's Safe Links scanner "clicks" for you and burns before you get to it — see [How it works](#how-it-works)).
5. In **Authentication → URL Configuration**, add `http://localhost:3000/auth/callback` (and your deployed URL's equivalent) to the redirect allow list — used for the password sign-up confirmation email.
6. Copy the project URL and anon key from **Project Settings → API**.

### 2. Anthropic API key

Get a key from the [Anthropic Console](https://console.anthropic.com). It's only ever used server-side (in `src/app/api/parse-tasks/route.ts`) — never exposed to the browser.

### 3. Gmail app password for "Email me"

The "Email me" button sends the same Gmail account already used for SMTP login codes (see [How it works](#how-it-works)), but it needs its **own** app password — Google only shows an app password once, and the one already pasted into Supabase's SMTP settings can't be retrieved again. Generate a second one:

1. Sign into that Gmail account → [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords).
2. Name it something like "Voice Task List app" and create it.
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
- **Main list view** (`src/app/page.tsx`) — loads existing tasks from Supabase on mount. The dictation box sends its text to `/api/parse-tasks`, a server-side route that calls the Claude API to split it into discrete tasks, which are then inserted into Supabase. Checking off or deleting a task updates Supabase directly.
- **Dictation** — uses the browser's built-in Web Speech API (no server round-trip). Not supported in every browser (notably: not Firefox) — typing works everywhere as a fallback. Saying "create list" (or "create the list" / "make the list") while dictating stops the mic and submits automatically, instead of requiring a button tap.
- **"Email me"** — `/api/email-list` fetches your open tasks (RLS-scoped, so only your own) and sends them to your own account email via the same Gmail SMTP relay used for login codes, using `nodemailer` server-side.

## Restricting who can sign up

Sign-up is invite-only. The `allowed_emails` table (migration `0002`) holds the list of emails permitted to create an account; the login page checks it (via the `is_email_allowed` SQL function) before sending a code or creating a password account. The signed-in admin — hardcoded as `ADMIN_EMAIL` in `src/app/page.tsx`, and separately in the RLS policies in `0002_allowed_emails.sql` — gets a "Manage access" panel on the main page to add or remove emails. If the admin's own email ever changes, update it in **both** places.

This check runs in the app's UI, not as a database-level lock — someone who called Supabase's auth API directly (bypassing the web app entirely) could still sign up with an email that isn't on the list. Fine for sharing a link with people you trust to just use the app normally; if that gap ever matters, the stronger fix is a Supabase Auth Hook that rejects disallowed sign-ups at the database level.

## Deploying

Deploy to [Vercel](https://vercel.com/new) and set the same environment variables there. The free tiers of both Supabase and Vercel are enough for personal use — note a free Supabase project pauses after a week of inactivity unless you're on a paid plan.
