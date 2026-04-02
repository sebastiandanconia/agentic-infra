
# Git Workflow

## Commits

- The assistant must ask the user for permission to make commits at the
  start of each Autopilot session in which commits may be needed.
- If permission is granted, confirm the target branch name before making
  any commit. Record that branch name for the remainder of the session.
- All commits stay local unless the user explicitly approves a push.
- Never push to any remote without explicit per-push approval.
- Never force-push without explicit approval.

## Branching

- Do not create, rename, or delete branches without explicit instruction.
- Do not merge or rebase branches without explicit instruction.

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
