# Loadout Manager (`loadout-mgr`)

A [pi](https://pi.dev) extension that lets you define named **loadouts** — coherent bundles of skills, roles, workflows, and policies — in a single TOML file, and activate them from any pi `settings.json` with one entry.

This approach improves on these obvious, but painful, alternatives:

- **Symlink folders** break over some network file systems, can be laborious to maintain, and are less than optimal for versioning a loadout as a unit.
- **Editing `skills`/`packages` arrays by hand** in every `settings.json` is tedious and drift-prone when the same group of resources follows you across machines and projects.

A loadout file is the unit you version, share, and reference. The extension resolves it at startup and feeds its sections into pi's existing discovery machinery — it does not replace skill/agent/workflow loading, it just wires a TOML manifest to it.

## What a loadout is

A loadout is a TOML manifest with four optional keys — `skills`, `roles`, `workflows`, and `policies` — each an array of names. The first three are skill-like resources pi loads on demand; `policies` are always-on Markdown fragments concatenated into your system prompt in the same way as `AGENTS.md` files. Example (`data-science.toml`):

```toml
skills = [
  "commits",
  "herdr",
  "math-rendering",
  "vision-delegation",
  "herdr-subagent-delegation",
  "open-knowledge",
]

roles = [
  "architect",
  "code-reviewer",
  "critic",
  "datasci-critic",
  "design-for-test",
  "executor",
  "planner",
  "verifier",
]

workflows = [
  "autopilot",
  "context-snapshots",
  "deep-interview",
  "evidence-verification",
  "ralph",
  "ralplan",
  "state-management",
  "visual-ralph",
]

policies = [
  "secrets",
  "whitespace",
  "capitalization",
]
```

### TOML format notes

The natural representation of "a list of names" in TOML is an array of strings, shown above — that is the canonical form this extension expects.

The draft this replaced wrote each section as a `[table]` header followed by bare words (`commits` on its own line). That is **not valid TOML**: per the [TOML 1.0.0 spec](https://toml.io/en/v1.0.0#table), a table is "collections of key/value pairs" and "under that, and until the next header or EOF, are the key/values of that table" — a bare word is not a key/value pair, and TOML defines no bare-word-list construct under a header.

The extension also accepts the **boolean-table form** as an alternative, where each name is a key mapped to `true`/`false`:

```toml
[skills]
commits = true
herdr = true
relay = false   # explicitly excluded; useful with `inherits`
```

The two forms are semantically equivalent for `true`/present entries. The only reason to prefer the boolean form is when you want to explicitly *exclude* an item you would otherwise inherit (see [Inheritance](#inheritance-optional)) — `name = false` subtracts it. Unknown top-level keys and unknown `[meta]` fields are ignored with a warning, so you can annotate a loadout without breaking parsing.

### Directory convention

`skills`, `roles`, and `workflows` live under a single `skills/` tree one level above the loadout file. `roles/` and `workflows/` are nested inside `skills/`. `policies` live in a sibling `policies/` directory one level above the loadout file:

```
<agents>/
├── loadouts/
│   ├── data-science.toml      <- the loadout manifest
│   └── coding.toml
└── skills/
    ├── commits/
    │   └── SKILL.md
    ├── herdr/
    ├── ...
    ├── roles/                  <- nested under skills/
    │   ├── architect/
    │   │   └── SKILL.md
    │   └── ...
    └── workflows/              <- nested under skills/
        ├── autopilot/
        │   └── SKILL.md
        └── ...
├── policies/                 <- sibling of skills/, one level above loadouts/
│   ├── secrets.md
│   ├── whitespace.md
│   └── capitalization.md
```

So from any loadout file at `<agents>/loadouts/<name>.toml`, the resource roots are fixed at `../skills/`, `../skills/roles/`, `../skills/workflows/`, and `../policies/`. You never encode those paths in the TOML; the extension derives them from the loadout file's location. This is what makes a loadout portable across machines and shares: only the path *to the loadout file* is machine-specific, everything inside it is relative.

A listed name `foo` in `skills` resolves to `../skills/foo/` (a `SKILL.md` directory) or `../skills/foo.md` (a single-file skill). `roles` and `workflows` resolve the same way against their own roots (`../skills/roles/foo/`, `../skills/workflows/foo/`). A listed name `bar` in `policies` resolves to `../policies/bar.md` (or `../policies/bar/`, though policies are conventionally single files). All four are ordinary Markdown/SKILL files as far as pi is concerned — the extension treats `roles` and `workflows` exactly like `skills`, just resolved from a different subdirectory under `skills/`; `policies` are plain Markdown fragments with no frontmatter and no skill machinery. There is no subagent-definition or workflow-runner registration; pi's normal skill discovery loads the first three, and the extension feeds policies into the system prompt directly (see [Policies](#policies)). Missing resources produce a warning and are skipped — a loadout never hard-fails pi startup because one role or one policy is absent on a given machine.

### Inheritance (optional)

A loadout may declare it builds on another:

```toml
[meta]
inherits = "complex-coding"
```

The parent is resolved relative to the same `loadouts/` directory and merged section-by-section before this loadout's entries are applied. `false` entries in the child remove items inherited from the parent, so inheritance is subtractive as well as additive. A child `true` re-adds an item the parent excluded. This applies to all four sections — `skills`, `roles`, `workflows`, and `policies` — identically. Cycles are detected and reported as a warning (the chain is truncated at the cycle, and the loadout's own resources still load). This is the clean replacement for "loadout A is loadout B plus a few extras" symlink chains.

## Referencing a loadout from `settings.json`

The hook from `settings.json` is a new top-level `loadouts` key, modeled on pi's existing `skills` and `packages` arrays. It accepts an array of paths to loadout TOML files:

```json
{
  "loadouts": [
    "~/src/agents/loadouts/data-science.toml"
  ]
}
```

Resolution rules, deliberately identical to how pi treats local package paths:

- `~` and `$HOME` are expanded.
- Relative paths are resolved against the settings file the entry appears in — so a project `.pi/settings.json` can say `"loadouts": ["../agents/loadouts/data-science.toml"]` and it resolves relative to that project, not your home directory.
- Both global (`~/.pi/agent/settings.json`) and project (`.pi/settings.json`) settings are honored; project settings are read only once the project is trusted, matching how pi gates `.pi` resources. Each referenced loadout is resolved independently (inheritance is resolved within a single loadout file) and the resulting skill paths are unioned with de-duplication, so a loadout referenced from both scopes contributes its resources once. Exclusion is intra-loadout: a `false` entry subtracts from the same loadout's inherited set, not from a different loadout's contributions.

A `loadouts` array is read only from the `settings.json` at the cwd's `.pi/` (project scope) and from `~/.pi/agent/settings.json` (global) — exactly like pi's own `skills` and `packages` arrays. It is **not** ancestor-walked the way `AGENTS.md` is: a `loadouts` entry placed in a parent directory's `.pi/settings.json` is not seen when pi runs from a child directory. This is the one place the policies story diverges from the `AGENTS.md` story (which [sequences](#sequencing-relative-to-agentsmd) policy fragments relative to ancestor `AGENTS.md` files) — the *contents* a loadout contributes are sequenced as if they sat at that tree level, but the *loadout manifest itself* is only discovered if its `settings.json` is one pi actually reads.

This means the same physical loadout file on your network share can be referenced from your global settings (your default working set) *and* again per-project, with no copying and no symlinks. To *remove* a resource per-project, add a second loadout file (in the project's `.pi/settings.json` `loadouts` array) that inherits from the shared base and sets that resource to `false`; that inheritance-based exclusion is the only subtraction mechanism, since one item in the loadouts array cannot remove another item's contributions.

Each loadout's `skills`, `roles`, and `workflows` entries are fed into pi's skill discovery as if you had listed each resolved skill directory in the `skills` array — the only difference is which subdirectory under `skills/` each section resolves from (`skills/`, `skills/roles/`, or `skills/workflows/`). The extension does not reimplement skill loading; it translates the TOML into the same inputs pi's discovery already accepts, so validation, deduplication, and name-collision warnings all behave exactly as they would if you'd wired everything up by hand. Each loadout's `policies` entries are resolved to Markdown fragment paths and concatenated into the system prompt as described in [Policies](#policies).

## Policies

Policies are always-on directives — cross-cutting rules that should govern every session regardless of task, such as "never read secrets files" or "no trailing whitespace." They are the same concept described in the `agents/` README's `policies/` folder: plain Markdown fragments with no frontmatter and no skill machinery, each a self-contained section that concatenates cleanly with the others. The reason policies are not skills is structural — a rule like "never read secrets" has to be present *before* the agent can tell whether the current task touches it, so it cannot sit behind a load-on-demand trigger.

A loadout's `policies` section lists fragment names that resolve from the sibling `../policies/` directory, in exactly the path-relative way `skills`, `roles`, and `workflows` resolve from their roots. The order in which policies are listed in the TOML is the order in which they are concatenated. Inheritance and exclusion work identically to the skill sections: a child loadout inherits its parent's policies, `name = false` subtracts an inherited policy, and a child `true` re-adds one the parent excluded.

### How policies reach the model

Pi loads `AGENTS.md` (or `CLAUDE.md`) at startup and concatenates every match it finds into the system prompt's `<project_context>` block, each wrapped as `<project_instructions path="...">content</project_instructions>`. The closest file to your working directory is read last, so project-level rules are read after — and in addition to — the global ones. The extension delivers policies through that *same* channel: at the start of each turn it reads the resolved policy fragments, wraps each in the same `<project_instructions>` wrapper, and splices them into the same `<project_context>` block. Because they travel the same wrapper and the same block as `AGENTS.md` content, policies are used for inference in exactly the same way as `AGENTS.md` files — there is no separate "policy" prompt section for the model to weight differently.

### Sequencing relative to `AGENTS.md`

Policy loadouts and hand-written `AGENTS.md` files coexist without surprises. The extension therefore positions policy fragments where an `AGENTS.md` at the corresponding tree level would land:

- **Policies from a loadout referenced in pi's global `~/.pi/agent/settings.json`** are inserted right after the global `AGENTS.md` (the one in the pi agent directory), before any ancestor or project `AGENTS.md`. If there is no global `AGENTS.md`, they go first in the block.
- **Policies from a loadout referenced in a project `.pi/settings.json`** are sequenced as if they were the `AGENTS.md` closest to the working directory — they are appended at the end of the block, after every existing `AGENTS.md` entry, so they are read last and take the "most project-specific" position.

Within each scope, the policies are emitted in the order the loadouts are listed in that settings file and, within a loadout, in the order the policies are listed in the TOML. A policy fragment named by both a global and a project loadout is emitted once, in its global (earlier) position — mirroring how a higher `AGENTS.md` is read before a closer one and the closer file does not re-append content already supplied from above. Within a single scope, duplicate listings of the same policy collapse to their first occurrence.

The net effect is that mixing `AGENTS.md` files and policy loadouts in the same tree reads as one coherent, ordered context document: global `AGENTS.md`, then global-scope policies, then ancestor `AGENTS.md` files walking down to the project, then the project `AGENTS.md`, then project-scope policies — which is exactly where you would expect each to appear if you had written them all as `AGENTS.md` files by hand at those tree levels.

### Failure modes and freshness

A loadout with no `policies` key contributes no policy fragments and is fully valid. A policy name that resolves to no file produces a warning and is skipped — it never breaks pi startup or a turn.

Policies are read **once**, at `resources_discover` time (startup and each `/reload`), and the resulting text is cached — exactly how pi handles `AGENTS.md` (read once during load, cached, not re-read per turn). The cached entries are re-spliced into the system prompt on every turn, because pi resets the prompt to its base form each turn when no extension modifies it, so the splice must run every turn to keep policies present — but the splice reads only from the cache, with no filesystem access, so it does not make policies any fresher than `AGENTS.md`. Consequences, deliberately identical to `AGENTS.md`:

- Editing a policy fragment between turns has **no** effect until the next `/reload` (or restart). A turn started before the edit sees the old text; this is the same staleness you get by editing `AGENTS.md` mid-session.
- Deleting a fragment after discovery does not drop its content from the current session — the cached snapshot is still injected, with no warning. The removal takes effect at the next `/reload`.
- `/reload` re-runs discovery, re-reads the fragments, and refreshes the cache, so edits and removals both take effect at the next `/reload`.
- The *set* of policies a loadout resolves (which names map to which files) is likewise fixed at discovery time, so adding a new fragment to a `policies/` directory or renaming one requires `/reload` to be picked up.

## Installation

This extension is part of `agentic-infra/pi-extensions`. From a trusted checkout:

```bash
pi install ~/src/agentic-infra/pi-extensions/loadout-mgr
```

Or, for a single run without persisting it to settings:

```bash
pi -e ~/src/agentic-infra/pi-extensions/loadout-mgr
```

After installing, `/reload` (or restart pi) and reference a loadout as shown above. There is no configuration beyond the `loadouts` array and the TOML files it points at.

### Removal

`pi remove` identifies a package the same way `pi install` does — by source string, not by the npm `name` field in `package.json`:

| Installed via | Remove with |
| --- | --- |
| `pi install ~/src/.../loadout-mgr` (local path) | `pi remove ~/src/agentic-infra/pi-extensions/loadout-mgr` — the **same path** you installed with |
| `pi install npm:pi-loadout-mgr` (published) | `pi remove npm:pi-loadout-mgr` — by package name |
| `pi install git:github.com/.../loadout-mgr` | `pi remove git:github.com/.../loadout-mgr` — by repo URL |

A bare `pi remove pi-loadout-mgr` does **not** work for a local-path install: `pi` parses an unprefixed argument as a local path, resolves it under the scope base dir (`~/.pi/agent`), and reports “No matching package found.”

Remove from the scope you installed into. `pi remove` defaults to global (`~/.pi/agent/settings.json`); add `-l` for a project-local install (`.pi/settings.json`).

After removing the package, you may also delete any `"loadouts": [...]` arrays you added to your `settings.json` files — `pi remove` does not touch that key. The TOML loadout manifests and the `skills/`, `skills/roles/`, `skills/workflows/`, and `policies/` resource trees are not managed by the extension or by `pi install`/`pi remove` either; they live under your own `<agents>/` directory and are removed by deleting those files directly.

To clean build products from a source checkout of the extension itself:

```bash
cd ~/src/agentic-infra/pi-extensions/loadout-mgr
npm run clean
```

This removes `node_modules/`, `dist/`, `coverage/`, `package-lock.json`, and any `*.log` files, leaving only the source tree.

## What this extension deliberately does *not* do

- **It does not invent a new resource type.** Skills, roles, and workflows remain whatever pi and herdr already consider them to be. The extension only collects names from a manifest and points the existing loaders at them.
- **It does not copy or re-distribute resources.** The directory convention is resolved at startup from the loadout file's location, so the share layout is the source of truth.
- **It does not depend on symlink support.** Everything is plain files and directories, which is the whole reason it exists relative to the symlink-folder approach.
- **It does not manage remote sync.** Getting `<agents>/` onto each machine (CIFS mount, NFS export, git clone, rsync) is outside its scope. A loadout just says "given that these directories exist at `../{skills,skills/roles,skills/workflows,policies}/`, load this subset."
