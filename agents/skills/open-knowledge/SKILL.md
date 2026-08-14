---
name: open-knowledge
description: Produce, consume, and maintain knowledge bundles in Google's Open Knowledge Format (OKF v0.2) — a directory of markdown files with YAML frontmatter carrying provenance, trust, lifecycle, and attested-computation metadata. Use when creating, reading, updating, or validating OKF concept documents, index/log files, or attested-computation contracts, or whenever a user references OKF, a "knowledge bundle", or an OKF concept/type/frontmatter field.
license: GPL-2.0
metadata:
  author: GoogleCloudPlatform/knowledge-catalog
  okf_version: "0.2"
  source: https://raw.githubusercontent.com/GoogleCloudPlatform/knowledge-catalog/refs/heads/main/okf/SPEC.md
---

# Open Knowledge Format (OKF v0.2) — operating manual

This is an **agent-facing operating manual** for OKF, not a restatement of the
data format. It tells you how to *produce*, *consume*, and *maintain* OKF
bundles. Field semantics that you only need sometimes live in `references/`;
load them on demand to save context.

## Mental model (read once)

- A **bundle** is a directory tree of UTF-8 markdown files. Unit of distribution (git repo, tarball, or subdir).
- A **concept** is one `.md` file = one unit of knowledge. Its **concept ID** is the file path with `.md` removed.
- Every concept = **YAML frontmatter** (`---` delimited) + **markdown body**.
- Only `type` is always required. Everything else is optional and its absence is meaningful (unverified ≠ verified; consumers MUST NOT reject for missing optional fields).
- Three metadata *families* are optional but first-class: **provenance** (`sources`), **trust** (`generated`/`verified`), **lifecycle** (`status`/`stale_after`). Attested Computation concepts add a fourth: the **computation contract**.
- No schema registry, no central authority, no SDK required. `cat` to read; `git clone` to ship.

When deeper field semantics matter (credibility-signal interpretation, the
attestation runtime protocol, v0.1 fallbacks, full worked examples), read the
relevant file in `references/`:

| You need… | Read |
|---|---|
| Every frontmatter field, its type, and exact rules | `references/FIELDS.md` |
| How to author or run an Attested Computation | `references/ATTESTED-COMPUTATION.md` |
| Copy-and-paste worked examples (table, playbook, attested metric, v0.1→v0.2) | `references/EXAMPLES.md` |
| Conformance rules, what consumers MUST/MUST NOT reject, v0.1 compatibility | `references/CONFORMANCE.md` |

## Conventions never to violate

1. **Reserved filenames** — `index.md` (directory listing, §Index) and `log.md` (update history, §Maintain) MUST NOT be used for concepts. Root `index.md` is the *only* `index.md` that may carry frontmatter, and only an `okf_version` key.
2. **Actor strings** — identities use one convention: `<producer>/<version>` for agents/tools (e.g. `reference_agent/gemini-2.5-pro`), `human:<id>` for people (e.g. `human:ahormati`), `process:<id>` for automated processes (e.g. `process:finance-nightly`). The `human:` prefix is what consumers key off for trust tiers — **MUST** use it for human-authored/confirmed content.
3. **Links between concepts** — prefer **bundle-relative** paths starting with `/` (stable across moves within a subdirectory): `[customers](/tables/customers.md)`. Relative (`./other.md`) is allowed. The relationship kind is conveyed by surrounding prose, not the link. Consumers MUST tolerate broken links (not-yet-written knowledge).
4. **Path-valued fields** (`resource`, `sources[].resource`, `computation`, `executor.resource`, `attester.resource`) accept an absolute URL, a bundle-relative path (`/…`), or a relative path. A `sources[].resource` may instead be a scope descriptor (e.g. `all queries in BigQuery project X`) — then it is not a path.
5. **Never reject for optionality** — consumers MUST NOT reject a concept/bundle for missing optional fields, unknown `type` values, unknown extra frontmatter keys, broken cross-links, or missing `index.md`. Round-tripping SHOULD preserve unknown keys.

## Frontmatter cheat sheet (the produce surface)

```yaml
---
type: <Type name>                  # REQUIRED, non-empty. Not centrally registered; descriptive & self-explanatory.
title: <display name>              # recommended; else derived from filename
description: <one-line summary>    # recommended; used by index generators & previews
resource: <URI of underlying asset> # recommended for tangible assets; omit for abstract ideas
tags: [a, b]                       # optional, cross-cutting
# --- provenance ---
sources:                           # optional; what the concept derives from
  - id: <stable key>               #   optional; join key for footnote attribution
    resource: <url|/path|../rel|scope>  # REQUIRED within an entry
    title: <label>                 #   optional
    author: <actor>                #   optional; authority signal
    usage_count: <int>             #   optional; liveness signal over usage_window
    last_modified: <YYYY-MM-DD>    #   optional; recency signal (source's own change date)
    usage_window: { from: <date>, to: <date> }  # optional; overrides shared
usage_window: { from: <date>, to: <date> }      # optional; frames every usage_count
# --- trust ---
generated: { by: <actor>, at: <ISO8601 datetime> }  # by REQUIRED within generated
verified:                          # optional; list of { by, at } events
  - { by: <actor>, at: <ISO8601> } #   bare mapping ⇒ treat as one-element list
# --- lifecycle ---
status: stable                     # draft | stable | deprecated ; absent ⇒ stable
stale_after: <YYYY-MM-DD>          # optional; stale when today >= stale_after
# --- computation (Attested Computation only; see references/ATTESTED-COMPUTATION.md) ---
runtime: <bigquery|postgres|dbt|python|Looker|…>  # REQUIRED for this type
parameters: [ { name, type, required } ]
computation: </path|../rel>        # optional; file holds the computation; else body # Computation fence
executor:  { resource: <path>, receipt: [field, …] }
attester:  { resource: <path> }
---
```

**Body conventions:** favor structure (headings, lists, tables, fenced code) over prose. Conventional headings: `# Schema`, `# Examples`, `# Computation`. Per-claim attribution = markdown footnote whose label is a `sources[].id` (keyed, not positional): `…sharded daily.[^ga4-schema]` + `[^ga4-schema]: <title>`.

## PRODUCE — create a concept

1. **Pick the file path** relative to the bundle root. The path is the concept ID. Organize in whatever way suits the domain.
2. **Write frontmatter.** `type` is mandatory and the only thing a conformant concept strictly needs. Add `title`/`description`/`resource`/`tags` when they help a consumer route, preview, or display.
3. **Decide families — absence is a signal, so add them deliberately:**
   - **provenance** (`sources`): add when the concept derives from identifiable material. Give each cited source an `id` so body footnotes can attribute claims. Record objective credibility signals (`author`, `usage_count`+`usage_window`, `last_modified`) — do **not** invent a score.
   - **trust** (`generated`): always set `generated.by` (your actor string) and `generated.at` (ISO 8601 of this content's last meaningful change). Set `verified` only when someone/something actually confirmed the content against its sources/`resource`; append a `{ by, at }` event, don't overwrite history.
   - **lifecycle** (`status`, `stale_after`): set `status: draft` until reviewed; `stale_after` only if the content has a real expiry.
4. **Write the body.** Use structural markdown. Use `# Schema` for field/column tables, `# Examples` for usage, `# Computation` only for Attested Computation (see below). Attribute per-claim facts with footnotes keyed to `sources[].id`.
5. **Link out** with bundle-relative `/…/x.md` links to express relationships (joins, depends-on, references). Don't invent a relationship field — the prose around the link carries the semantics.
6. **If the concept is a sanctioned computation**, follow the Attested Computation rules in the next section, not freeform SQL.
7. **Update the nearest `log.md`** with a one-line dated entry (see MAINTAIN).

**Minimal conformant concept** (a concept carrying just `type` is fully conformant):
```markdown
---
type: Reference
---
Body goes here.
```

### PRODUCE — Attested Computation (summary)

A sanctioned computation is its **own concept** of `type: Attested Computation`,
not SQL embedded in a Metric. A narrative concept (a `Metric`, a `BigQuery Table`)
links to it with a normal markdown link. Why standalone: `runtime` defines what
`parameters` mean; one computation serves many consumers; trust/attestation state
is per-computation.

Frontmatter adds: `runtime` (REQUIRED), `parameters` (typed named holes the agent
fills), `computation` (path to the computation file) OR a `# Computation` fenced
block in the body, `executor` (run instructions + `receipt` fields a run returns),
`attester` (deterministic, **no-LLM** code that inspects a receipt and returns a
verdict, run on the consumer side).

**Hard rule:** the agent supplies only *values* for declared `parameters`; it
MUST NOT author or edit the computation. Binding the computation with parameter
values into the executable artifact is the consumer's job; the attester re-derives
that same binding to compare against what actually ran. Full contract, runtime
protocol, and the produce/run/attest steps: `references/ATTESTED-COMPUTATION.md`.

## CONSUME — traverse a bundle

1. **Land at the root.** If `index.md` exists, read it for progressive disclosure (sections list concepts + their `description`). If absent, synthesize one by scanning frontmatter — don't fail.
2. **Locate by `type`, `tags`, or links.** Route/filter on `type` (tolerate unknown types as generic concepts). Follow markdown links (bundle-relative `/…`) to related concepts; broken links are allowed, not errors.
3. **Read trust before trusting.** Derive the trust tier from `verified`:
   - no `verified` key ⇒ **unverified**
   - `verified` by non-`human:` actors only ⇒ **machine-confirmed**
   - `verified` by any `human:<id>` actor ⇒ **human-reviewed**
   Treat a bare `verified` mapping as a one-element list. "How recently verified" = the latest `at`. Trust is advisory, not access control — never reject unverified content.
4. **Check freshness.** Stale when `today >= stale_after` (plain date compare, no reference to read-time). `status: deprecated` ⇒ kept for links/history, no longer current. `status: draft` ⇒ possibly incomplete. Surface these to the user; don't silently drop.
5. **Judge sources; don't read a stored score.** OKF records objective per-source signals (`author`, `usage_count` over `usage_window`, `last_modified`), not a verdict. Infer credibility yourself: liveness/trend from `usage_count` (coarse — alive-vs-dead and order-of-magnitude, not a precise cross-kind rank), authority from `author`, recency from `last_modified`. If a `sources[].resource` points at another OKF concept, you MAY recurse into that concept's own `sources` and let credibility propagate.
6. **Resolve per-claim attribution** by matching a footnote label to `sources[].id` — do not parse footnote prose or use positional indices (lists get reordered; stable `id` survives).
7. **For Attested Computation concepts**, gate on attestation (see `references/ATTESTED-COMPUTATION.md`): load contract → fill declared `parameters` → execute via `executor.resource` → collect receipt shaped by `executor.receipt` → run `attester.resource` over the receipt → refuse to display a failing attestation; warn/refuse when stale. `verified` (definition still matches policy) and attestation (this run produced the value the sanctioned way) are distinct and both are required.
8. **Preserve unknown keys** when round-tripping; never reject for unknown `type`/fields.

## MAINTAIN — keep a bundle alive

- **Regenerate:** when content changes, update `generated.by`/`generated.at`. Regeneration does NOT carry over `verified` — content can change without re-confirmation.
- **Re-verify:** append a `{ by, at }` event to `verified` (don't rewrite history). Re-confirmation does not require regeneration. `verified` and `generated.at` are independent by design.
- **Refresh sources:** when a source's `last_modified` advances or a new run window opens, update its signals and `usage_window`. Recompute staleness against the new facts.
- **Deprecate:** set `status: deprecated`, keep the file for links/history. Do not delete concepts that others link to (broken links are tolerated, but intent is preservation).
- **Expire:** set `stale_after: <YYYY-MM-DD>` when content has a real expiry. A concept can attest cleanly while its *definition* is stale — that is why `verified` and attestation are separate; both still apply.
- **Log it:** append to the nearest `log.md`. Format = flat list, newest first, ISO `YYYY-MM-DD` date headings, prose entries with a conventional bold lead word:
  ```markdown
  ## 2026-05-22
  * **Update**: Added a BigQuery table reference for [Customer Metrics](/tables/customer-metrics.md).
  * **Creation**: Established the [Dataplex Playbook](/playbooks/dataplex.md).
  ```
- **Index it:** if the directory has an `index.md`, add/refresh the entry (title + `description`). Producers MAY auto-generate `index.md`; consumers MAY synthesize one when absent.
- **Validate:** run `scripts/validate-bundle.sh <bundle-dir>` for a quick conformance check (frontmatter present + non-empty `type` on every non-reserved `.md`; reserved files structurally sane).

## Index files (§8)

Any directory MAY have an `index.md` for progressive disclosure. **No frontmatter** — the sole exception is a bundle-root `index.md` carrying only `okf_version`. Body = sections, each a heading + bullet list:

```markdown
# Tables

* [Customer Orders](orders.md) - One row per completed customer order across all channels.
* [Customers](customers.md) - Customer master record.

# Playbooks

* [Data freshness alert](../playbooks/freshness.md) - Triage a freshness alert on the orders pipeline.
```

Subdirectory entries link to the subdir with a trailing slash. Entries SHOULD include the linked concept's `description`.

## Versioning

OKF is at **0.2**. Bundles MAY declare `okf_version: "0.2"` in root `index.md` frontmatter. Minor bumps = backward-compatible additions; major bumps may break. Consumers that don't understand a declared version SHOULD attempt best-effort consumption rather than refusing. v0.1 bundles are consumable by v0.2 consumers via documented fallbacks (`timestamp`→`generated.at`; body `# Citations`→`sources`) — see `references/CONFORMANCE.md`.
