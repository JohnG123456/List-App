---
name: status
description: Answer "where are we up to" for this app, and bring STATUS.md back in line with reality. Use when John asks where the project stands, what is still outstanding, what was last done, or asks to write or refresh the status file — and near the end of a working session, so the next one starts informed instead of re-reading the whole repo.
---

# Status

`STATUS.md` in the repository root is this app's handover note. It exists because
John builds several apps at once and comes back to each after weeks away, and
because a Claude Code session starts with no memory of the last one. A session
that reads it should know where things stand without being told.

It is committed to the repo on purpose: it travels with the code, it is
versioned, and a future session picks it up as context without anyone fetching
it from anywhere.

## Reading it

Read `STATUS.md` before answering any "where are we up to" question. Then check
whether it is still true — it is written by hand and the code moves underneath
it. Compare its `Last updated` date against `git log` since that date. If work
has landed that the file doesn't mention, say so rather than repeating a stale
file back to John as though it were current.

## Refreshing it

Gather before writing. Do not update the file from memory of the conversation
alone:

1. `git log --oneline -20` and the dates, to see what has actually landed.
2. Open pull requests, and whether their checks are green.
3. Whether the deployment is healthy, where the app is deployed.
4. The existing `STATUS.md`, so that settled items move rather than vanish and
   open items keep their history.

Then rewrite the file, keeping the section order below.

## What goes in it

- **What this is** — a short paragraph. Someone who has never seen the repo
  should understand what the app does and who uses it.
- **Where it runs** — hosting, database, the dashboards that matter, with links.
  Names and project references only; never secrets, keys or connection strings.
- **Where we're up to** — the honest current state in a few sentences. Include
  what is half-finished, not only what is done.
- **Open items** — a checklist. Each line says what it is and why it matters,
  enough to act on without reconstructing the reasoning. Mark whose job it is
  when that isn't obvious.
- **Recently settled** — dated, with PR links. This is the record that outlives
  the chat thread, so keep a few months of it and prune below that.
- **Gotchas** — what would bite someone picking this up cold: manual steps,
  things that look wrong but aren't, deploy conventions, anything learned the
  hard way. This is the section that earns the file its keep.

## Rules

- **Write only what you have checked.** An unverified claim in a handover note
  is worse than a gap, because the next session believes it. If something is
  unconfirmed, write that it is unconfirmed.
- **No secrets.** No keys, tokens, connection strings, passwords, bank details
  or members' personal data. Public identifiers already shipped in client code
  are fine.
- **Plain English.** John reads these after weeks away and on a phone. Short
  sentences, no jargon that the repo itself doesn't use.
- **Date every entry**, and set `Last updated` when you change the file.
- **Follow the repo's own contribution rules** for committing this file —
  including anything in `CLAUDE.md` or `AGENTS.md` about branching, pull
  requests and who merges.
