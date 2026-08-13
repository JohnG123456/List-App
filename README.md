# Task List

Dictate a list of tasks, have Claude turn it into a task list, and check tasks off — synced to your account via Supabase so it's the same list on every device.

## Setup

### 1. Supabase project

1. Create a project at [supabase.com](https://supabase.com).
2. In the SQL editor, run the migration in `supabase/migrations/0001_init.sql` — it creates the `tasks` table and row-level security policies scoping each user to their own tasks.
3. In **Authentication → Providers**, email/password is on by default. For magic links, make sure the "Confirm email" setting matches what you want (magic link works either way).
4. In **Authentication → URL Configuration**, add `http://localhost:3000/auth/callback` (and your deployed URL's equivalent) to the redirect allow list.
5. Copy the project URL and anon key from **Project Settings → API**.

### 2. Anthropic API key

Get a key from the [Anthropic Console](https://console.anthropic.com). It's only ever used server-side (in `src/app/api/parse-tasks/route.ts`) — never exposed to the browser.

### 3. Environment variables

Copy `.env.example` to `.env.local` and fill in:

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
ANTHROPIC_API_KEY=
```

### 4. Run it

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000). You'll be redirected to `/login` until you sign in.

> `npm run build` requires `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` to be set (`.env.local` covers this locally) — they're inlined into the client bundle at build time.

## How it works

- **Auth** — Supabase Auth (email/password or magic link). `src/proxy.ts` (Next.js 16's renamed middleware) redirects unauthenticated requests to `/login` and keeps the session cookie fresh.
- **Main list view** (`src/app/page.tsx`) — loads existing tasks from Supabase on mount. The dictation box sends its text to `/api/parse-tasks`, a server-side route that calls the Claude API to split it into discrete tasks, which are then inserted into Supabase. Checking off or deleting a task updates Supabase directly.
- **Dictation** — uses the browser's built-in Web Speech API (no server round-trip). Not supported in every browser (notably: not Firefox) — typing works everywhere as a fallback.

## Deploying

Deploy to [Vercel](https://vercel.com/new) and set the same three environment variables there. The free tiers of both Supabase and Vercel are enough for personal use — note a free Supabase project pauses after a week of inactivity unless you're on a paid plan.
