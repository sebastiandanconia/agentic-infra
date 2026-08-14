---
name: commits
description: Governs Git workflow. Asks the user for permission before making any commits, confirms and records the target branch, keeps all commits local unless the user explicitly approves a push, and never force-pushes without explicit approval. Enforces atomic, non-broken commits with clean commit hygiene (no build artifacts, editor temp files, or unrelated bundled changes), and specifies branch and history discipline. Use whenever commits, branches, rebase/merge, or git identity may be involved.
---

# Git Workflow

## Commits

By default:
- The assistant must ask the user for permission to make commits.
- If permission is granted, confirm the target branch name before making
  any commit. Record that branch name for the remainder of the session.

These default restrictions do not apply when
```
Autonomous commits: Authorized
```
or similar appears in harness-level prompts such as concatenated from
`AGENTS.md` files.

However, the following restrictions still apply:
- All commits stay local unless the user explicitly approves a push.
- Never push to any remote without explicit per-push approval.
- Never force-push without explicit approval.

## Branching

- Do not create, rename, or delete branches without explicit instruction.
- Do not merge or rebase branches without explicit instruction.

## Commit Message Format

- Subject line: Capitalize first word, imperative mood, no period
  - Good: "Add Ralph role for persistent execution"
  - Bad: "add ralph role" (not capitalized)
  - Bad: "feat: add ralph role" (no conventional commit prefixes)
  - Bad: "Added ralph role" (not imperative mood)
  - Bad: "Add Ralph role." (no trailing period)
- Body: Wrap at 72 characters, explain what and why (not how)
- Blank line between subject and body
- Use bullet points for multiple changes in body
- Reference issue numbers if applicable

Example:
```
Add Ralph role for persistent execution

Ralph provides completion discipline through iteration loops:
- Requires fresh evidence before claiming done
- Auto-retries on failure, escalates after 3 identical errors
- Persists state for resume capability

Enables autonomous task completion similar to oh-my-codex $ralph mode.
```

## Commit Hygiene

- Each commit must leave the codebase in a non-broken state.
- Prefer atomic commits: one logical change per commit.
- Do not bundle unrelated changes into a single commit.
- Do not commit build artifacts, editor temp files, or generated files
  unless they are intentionally tracked in the repo.

## Git User Identity

- At the start of any session involving commits, check the per-project
  `git config user.email`.
- If it is a real email address (i.e. does NOT match the pattern
  `*+*@users.noreply.github.com`), warn the user immediately:

  "WARNING: Your per-project git user.email is set to a real email
  address rather than your GitHub-anonymized noreply address. Consider
  setting it to: <ID>+<username>@users.noreply.github.com"
