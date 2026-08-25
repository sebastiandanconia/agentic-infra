# Loadout Manager (`loadout-mgr`)

A [pi](https://pi.dev) extension that lets you define named **loadouts** — coherent bundles of skills, roles, and workflows — in a single TOML file, and activate them from any pi `settings.json` with one entry.

This approach improves on these obvious, but painful, alternatives:

- **Symlink folders** break over some network file systems, can be laborious to maintain, and are less than optimal for versioning a loadout as a unit.
- **Editing `skills`/`packages` arrays by hand** in every `settings.json` is tedious and drift-prone when the same group of resources follows you across machines and projects.

A loadout file is the unit you version, share, and reference. The extension resolves it at startup and feeds its sections into pi's existing discovery machinery — it does not replace skill/agent/workflow loading, it just wires a TOML manifest to it.

## What a loadout is

A loadout is a TOML manifest with three keys — `skills`, `roles`, and `workflows` — each an array of names. Example (`data-science.toml`):

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

`skills`, `roles`, and `workflows` live under a single `skills/` tree one level above the loadout file. `roles/` and `workflows/` are nested inside `skills/`:

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
```

So from any loadout file at `<agents>/loadouts/<name>.toml`, the resource roots are fixed at `../skills/`, `../skills/roles/`, and `../skills/workflows/`. You never encode those paths in the TOML; the extension derives them from the loadout file's location. This is what makes a loadout portable across machines and shares: only the path *to the loadout file* is machine-specific, everything inside it is relative.

A listed name `foo` in `skills` resolves to `../skills/foo/` (a `SKILL.md` directory) or `../skills/foo.md` (a single-file skill). `roles` and `workflows` resolve the same way against their own roots (`../skills/roles/foo/`, `../skills/workflows/foo/`). All three are ordinary skill files as far as pi is concerned — the extension treats `roles` and `workflows` exactly like `skills`, just resolved from a different subdirectory under `skills/`. There is no subagent-definition or workflow-runner registration; pi's normal skill discovery loads them. Missing resources produce a warning and are skipped — a loadout never hard-fails pi startup because one role is absent on a given machine.

### Inheritance (optional)

A loadout may declare it builds on another:

```toml
[meta]
inherits = "complex-coding"
```

The parent is resolved relative to the same `loadouts/` directory and merged section-by-section before this loadout's entries are applied. `false` entries in the child remove items inherited from the parent, so inheritance is subtractive as well as additive. A child `true` re-adds an item the parent excluded. Cycles are detected and reported as a warning (the chain is truncated at the cycle, and the loadout's own resources still load). This is the clean replacement for "loadout A is loadout B plus a few extras" symlink chains.

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

This means the same physical loadout file on your network share can be referenced from your global settings (your default working set) *and* again per-project, with no copying and no symlinks. To *remove* a resource per-project, add a second loadout file (in the project's `.pi/settings.json` `loadouts` array) that inherits from the shared base and sets that resource to `false`; that inheritance-based exclusion is the only subtraction mechanism, since one item in the loadouts array cannot remove another item's contributions.

Each loadout's `skills`, `roles`, and `workflows` entries are all fed into pi's skill discovery as if you had listed each resolved skill directory in the `skills` array — the only difference is which subdirectory under `skills/` each section resolves from (`skills/`, `skills/roles/`, or `skills/workflows/`). The extension does not reimplement skill loading; it translates the TOML into the same inputs pi's discovery already accepts, so validation, deduplication, and name-collision warnings all behave exactly as they would if you'd wired everything up by hand.

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

## What this extension deliberately does *not* do

- **It does not invent a new resource type.** Skills, roles, and workflows remain whatever pi and herdr already consider them to be. The extension only collects names from a manifest and points the existing loaders at them.
- **It does not copy or re-distribute resources.** The directory convention is resolved at startup from the loadout file's location, so the share layout is the source of truth.
- **It does not depend on symlink support.** Everything is plain files and directories, which is the whole reason it exists relative to the symlink-folder approach.
- **It does not manage remote sync.** Getting `<agents>/` onto each machine (CIFS mount, NFS export, git clone, rsync) is outside its scope. A loadout just says "given that these directories exist at `../{skills,roles,workflows}/`, load this subset."
