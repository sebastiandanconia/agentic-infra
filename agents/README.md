# agents — Agent Instructions

A portable set of instructions for coding agents. Written as plain Markdown, they can be applied to almost any coding agent, with first-class support for [Pi](#applying-to-pi) (which implements the Agent Skills standard) and straightforward portability to any other tool that does the same.

## Layout

```
agents/
├── inspiration/   Ideas which look promising but in which I'm not yet seriously invested
├── policies/      Always-on directives, concatenated into your agent's context file
├── skills/        On-demand capability packages (Agent Skills standard, SKILL.md)
└── README.md      This file
```

1. **Inspiration/Ideas** — Agent instructions that I find interesting, but it's TBD whether I will use them. These may be either policies or skills.

2. **Policies** — Cross-cutting directives that should apply to *every* session, regardless of task. Examples in this repo: never read secrets files (`policies/secrets.md`), keep whitespace and line endings clean (`policies/whitespace.md`). Because they are always in context, they cost tokens on every turn, so each one should earn its place.

3. **Skills** — Task-specific procedures loaded *only when relevant*. Each skill is a directory with a `SKILL.md` carrying frontmatter (`name`, `description`). The agent sees just the name and a one-line description until it decides the skill applies, then reads the full file. This is progressive disclosure: the always-on footprint is tiny, and the bulk of the instructions arrive on demand. Examples in this repo: Git commit workflow (`skills/commits`), terminal-first math output (`skills/math-rendering`).

Rule of thumb when adding content: if it should govern behavior in every session no matter what the user is doing, it is a **policy**. If it only applies to a specific kind of task and would be noise otherwise, it is a **skill**.

## Applying to Pi

Pi discovers instructions through two mechanisms that line up exactly with the two tiers above.

### Policies → Your `AGENTS.md`

Pi loads `AGENTS.md` (or `CLAUDE.md`) at startup and concatenates every match it finds, from:

- `~/.pi/agent/AGENTS.md` (global, every project), then
- each ancestor directory of your working directory, walking all the way up to the filesystem root — it does **not** stop at a git boundary.

The file closest to your working directory appears last, so project-level rules are read after — and in addition to — the global ones.

To apply the policies, concatenate the selected fragments into an `AGENTS.md` at the scope that suits you:

- **Global** (`~/.pi/agent/AGENTS.md`): Every Pi session everywhere.
- **A shared parent** (e.g. `~/src/AGENTS.md`): Every project under that path, picked up automatically by the ancestor walk with no per-project setup.
- **Per project** (`<repo>/AGENTS.md`): Only that project, supplementing the inherited rules.

For example, to place all policies in a shared parent file:

```bash
cat ~/src/agentic-infra/agents/policies/*.md > ~/src/AGENTS.md
```

A subset is equally valid. Each policy is a self-contained fragment with no frontmatter and no headings that assume neighboring content, so any selection still reads as one coherent document. The ordering is your choice, though `secrets` is a sensible one to place first.

Because Pi also accepts `CLAUDE.md`, the same concatenated file works if you prefer that name (e.g. to share with Claude Code).

### Skills → Pi Skill Discovery

The skills in `agents/skills/` follow the Agent Skills standard, so Pi can load them directly. Pi discovers skills from several locations; the cleanest ways to point it at this repo's skills are:

- **Settings array (recommended).** Add the directory to `skills` in `~/.pi/agent/settings.json` (global) or `<repo>/.pi/settings.json` (project):
  ```json
  { "skills": ["~/src/agentic-infra/agents/skills"] }
  ```
  You can list the parent `skills/` directory (Pi treats each subdirectory containing a `SKILL.md` as a skill) or individual skill paths.
- **Copy or symlink** a skill into `~/.pi/agent/skills/` or a project's `.pi/skills/` / `.agents/skills/`.
- **One-off:** `pi --skill ~/src/agentic-infra/agents/skills/commits`.

Note that Pi's `.agents/skills` ancestor walk *does* stop at the git repo root, so a shared `agents/skills/` above your project will not be inherited automatically the way `AGENTS.md` is. Use the settings array or a symbolic link to bridge that boundary. (The `AGENTS.md` ancestor walk has no such limit.)

Once loaded, skills are invokable as `/skill:commits`, `/skill:math-rendering`, and so on, or the agent loads them automatically when a task matches the description. Use `/reload` after adding or changing skills so Pi reloads them without a restart.

## Applying to Other Coding Agents

The two-tier model translates to any agent, even though the filenames differ:

| Tier | Concept | Typical home (varies by tool) |
|------|---------|-------------------------------|
| Policies | Always-loaded context / system-prompt preamble | The tool's persistent instructions file (e.g. `CLAUDE.md`, `.cursor/rules/*`, a conventions file, or a custom system prompt) |
| Skills | On-demand, trigger-keyed instructions | Whatever the tool calls skills, rules, or slash commands; if it supports the Agent Skills standard, these `SKILL.md` files work as-is |

General steps:

1. **Policies.** Find your agent's always-loaded instructions file and concatenate the selected policies into it (using the same `cat policies/*.md` approach). If the tool reads a single global file plus per-project files, treat the global one as your base set and add project-specific policy fragments on top.
2. **Skills.** If your tool implements the Agent Skills standard, point it at `agents/skills/` per its docs. If it has a proprietary skill/command format, the content of each `SKILL.md` is plain prose you can adapt — keep the "load only when relevant" intent by registering them as on-demand commands rather than pasting them into always-loaded context. If your tool has no skill mechanism at all, the policies still apply independently, and you can open a skill's `SKILL.md` manually when the relevant task arises.

Because everything here is plain Markdown with no tool-specific markup beyond the standard skill frontmatter, porting is mostly a matter of *where* the text lives, not rewriting it.

## The `policies/` Folder in Detail

Policies are cross-cutting directives that are too general to be skills and that you want active in every session. Concretely:

- **Format:** Plain Markdown fragments, no frontmatter, no skill machinery. Each file is a standalone section (a short title plus rules) that concatenates cleanly with the others.
- **Why not skills:** A skill's value is that it stays out of context until needed. A rule like "never read secrets files" or "no trailing whitespace" has to be present *before* the agent can tell whether the current task touches it — by the time the agent would load such a skill, the harm may already have occurred. Such rules belong in always-loaded context, not behind a trigger.
- **Choosing what to include:** Because policies occupy context on every turn, prefer a small, high-value set. `secrets.md` and `whitespace.md` justify their context cost across essentially all work. Keep task-specific guidance out of this folder; it belongs in `skills/`.
- **Concatenating:** Write the selected files into your `AGENTS.md` (or equivalent). The fragments make no assumptions about each other's presence, so any subset — from a single file to the full set — produces a coherent document.

## The `skills/` Folder in Detail

Each subdirectory is one skill:

```
skills/commits/SKILL.md          # Git workflow: permission, branches, hygiene, identity
skills/math-rendering/SKILL.md   # Terminal-first math output: Unicode + LaTeX artifacts
…
```

`SKILL.md` frontmatter follows the Agent Skills standard:

```yaml
---
name: commits
description: Governs Git workflow during Autopilot sessions. ... Use whenever commits, branches, rebase/merge, or git identity may be involved.
---
```

The `description` is what the agent uses to decide when to load the skill, so it should be specific about *when* to use it, not just *what* it does. The body is the full procedure, read on demand. Keep skills self-contained; reference helper scripts or reference docs with paths relative to the skill directory.
