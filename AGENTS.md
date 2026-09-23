<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Supabase: every new table needs explicit grants

From 30 Oct 2026 Supabase no longer grants Data API access to new tables in
`public` automatically. A table created without grants exists, but
supabase-js gets "permission denied" on it. So in the same SQL that creates a
table, straight after its `enable row level security` line, add:

```sql
grant select, insert, update, delete on public.<table> to authenticated, service_role;
```

- Don't grant `anon` (signed-out visitors) on tables. Signed-out checks (the email allowlist) go through SECURITY DEFINER functions with their own grants.
- Never grant on a table without RLS enabled: the grant opens the table and RLS
  is what limits it to the right rows.
- A `bigserial`/identity column the app inserts into also needs
  `grant usage, select on sequence public.<table>_<column>_seq to authenticated, service_role;`
- Tables that already exist keep the grants they have; nothing to re-run.
