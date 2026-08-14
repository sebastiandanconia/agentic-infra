# OKF v0.2 — frontmatter field reference

Load this only when you need exact field rules. For the operating manual see
`../SKILL.md`. All families are optional except `type`; absence is meaningful.

## Required

| Field | Rule |
|---|---|
| `type` | String, non-empty. Not centrally registered; pick descriptive, self-explanatory values. Consumers tolerate unknown types as generic concepts. Examples: `BigQuery Table`, `BigQuery Dataset`, `API Endpoint`, `Metric`, `Playbook`, `Reference`, `Attested Computation`. |

## Recommended

| Field | Rule |
|---|---|
| `title` | Human-readable display name. If omitted, consumers MAY derive from filename. |
| `description` | Single sentence. Used by index generators, search snippets, previews. |
| `resource` | Canonical URI for the underlying asset. Absent for abstract ideas. Accepts absolute URL, bundle-relative `/…`, or relative path. |
| `tags` | YAML list of short strings for cross-cutting categorization. No separate aggregation file; synthesize tag views at consumption time by scanning frontmatter. |

## Provenance family — `sources`

Records the materials a concept derives from (external or internal to the
bundle). Each entry:

| Sub-field | Required | Rule |
|---|---|---|
| `resource` | **yes** (within entry) | A concrete artifact a consumer can follow (absolute URL, bundle-relative `/…`, relative path, or path into `references/`) **or** a population/scope descriptor the consumer cannot follow (e.g. `all queries in BigQuery project X`). |
| `id` | no | Stable key used to attribute individual claims via body footnotes. SHOULD be present when the body cites the source. Keyed, not positional, because agents reorder lists — a positional index misattributes silently. |
| `title` | no | Human-readable label. |
| `author` | no | Who/what produced the source, in the actor convention. Authority signal. |
| `usage_count` | no | How often `resource` was exercised (dashboard views, query executions, page reads) over `usage_window`. Liveness signal. For a single artifact, the count of times that artifact was exercised; for a scope descriptor, the count of in-scope exercises that touch the concept. |
| `usage_window` | no | Per-entry override of the shared `usage_window`. |

Sibling to `sources`:

| Field | Rule |
|---|---|
| `usage_window` | `{ from: <YYYY-MM-DD>, to: <YYYY-MM-DD> }`. Frames every `usage_count` in the entry list. |

### How to read credibility signals

OKF records objective signals; it does **not** store a credibility score (a
score is subjective, non-portable, and goes stale). Infer it:

- `author` → authority (is the source official/known?).
- `usage_count` over `usage_window` → liveness and trend. **Coarse**: useful for alive-vs-dead and order-of-magnitude comparisons, and against a source's own history — not a precise cross-kind ranking (a scheduled query's executions ≠ a human's deliberate dashboard views). Read as liveness/trend, not a score.
- `last_modified` → recency of the *source itself*, distinct from `generated.at` (when the *concept* was written).

**Lineage** is expressed through links, not a dedicated field. When a
`sources[].resource` points at another OKF concept, the derivation edge already
exists in the bundle graph — you MAY recurse into that source's own `sources`
and let credibility propagate. External leaf sources carry only intrinsic
signals. Deeper lineage (explicit external `derived_from`, data lineage) is out
of scope for v0.2.

### Per-claim attribution

Attribute a specific claim with a markdown footnote whose label is a
`sources[].id`:

```markdown
The `events_` table is sharded daily as `events_YYYYMMDD`.[^ga4-schema]

[^ga4-schema]: GA4 BigQuery Export schema
```

The footnote label is the join key into `sources`; resolve attribution through
the matching entry, not by parsing footnote prose. Labels are keyed rather than
positional (`sources[0]`) because a positional index misattributes the moment
the list is reordered.

## Trust family — `generated`, `verified`

Kept distinct: who *wrote* a concept need not be who *confirmed* it.

### `generated`

```yaml
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
```

| Sub-field | Rule |
|---|---|
| `by` | **required** within `generated`. An actor (see actor convention). |
| `at` | ISO 8601 datetime of the content's last meaningful change. Distinguishes a recent edit from a stale fact. |

### `verified`

```yaml
verified:
  - { by: human:ahormati, at: 2026-06-25T09:00:00Z }
  - { by: process:finance-nightly, at: 2026-06-26T02:00:00Z }
```

- List of verification events, each `{ by, at }`. Multiple entries capture
  independent checks (e.g. human sign-off + nightly process).
- "How recently verified" = the latest `at`.
- Independent of `generated.at`: content can change without re-confirmation;
  facts can be re-confirmed without regeneration.
- A single verifier MAY be written as a bare `{ by, at }` mapping without the
  list dash. Consumers **MUST** treat a bare mapping as a one-element list:
  ```yaml
  verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
  ```

### Trust tiers (consumers derive, lowest→highest)

| Condition | Tier |
|---|---|
| No `verified` key | **unverified** |
| `verified` by non-`human:` actors only | **machine-confirmed** |
| `verified` by any `human:<id>` actor | **human-reviewed** |

A concept with no trust frontmatter is still consumable; consumers MUST NOT
reject it. Trust tiers are advisory signals, not access control.

## Lifecycle family — `status`, `stale_after`

### `status`

```yaml
status: stable   # draft | stable | deprecated
```

| Value | Meaning |
|---|---|
| `draft` | not yet reviewed; possibly incomplete |
| `stable` | default; ready for consumption (absent ⇒ stable) |
| `deprecated` | kept for links and history; no longer current |

### `stale_after`

```yaml
stale_after: 2026-09-23
```

- Optional. Absolute date (`YYYY-MM-DD`). A concept is stale when `today >= stale_after`.
- Absolute, not a relative TTL, so the staleness decision is a plain date
  comparison with no reference to when the concept was read.

## Computation family (Attested Computation only)

See `ATTESTED-COMPUTATION.md` for the full contract and runtime protocol.

| Field | Rule |
|---|---|
| `runtime` | **required** for this type. How to run the computation; defines what `parameters` mean and how the executor and attester interpret them. Examples: `bigquery`, `postgres`, `dbt`, `python`, `Looker`. |
| `parameters` | List of `{ name, type, required }`. Typed, named holes the agent fills. Binding semantics follow `runtime`. |
| `computation` | Optional path (URL / `/…` / relative) to a file holding the computation. Absent ⇒ body `# Computation` fence is the computation. |
| `executor` | `{ resource: <path>, receipt: [field, …] }`. `resource` names run instructions/code a runner follows; `receipt` declares the fields a run must return (the evidence the attester inspects). |
| `attester` | `{ resource: <path> }`. Deterministic (no-LLM) code that takes a receipt and returns a verdict. Intended to run on the consumer side. |

What sits behind a `resource` (Skill, script, container) is a packaging choice;
OKF fixes the interface, not the packaging.

## Extensions

Producers MAY include any additional keys. Consumers SHOULD preserve unknown
keys when round-tripping and MUST NOT reject documents with unrecognized
fields.

## Body conventions

- Standard markdown; no required sections.
- Favor structural markdown (headings, lists, tables, fenced code) over
  freeform prose — structure aids human reading and agent retrieval.
- Conventional headings: `# Schema` (columns/fields), `# Examples` (usage,
  often fenced code), `# Computation` (the sanctioned computation, for
  Attested Computation only).
- Per-claim attribution uses footnotes keyed to `sources[].id` (above), not a
  body citations list. (A legacy v0.1 `# Citations` body list is superseded —
  see `CONFORMANCE.md`.)

## Actor convention (recap)

`generated.by` and `verified[].by` use one convention:

- `<producer>/<version>` — agents/tools, e.g. `reference_agent/gemini-2.5-pro`.
- `human:<id>` — people, e.g. `human:ahormati`. Producers MUST use this prefix for hand-authored or human-confirmed content (consumers key off it for trust tiers).
- `process:<id>` — automated processes, e.g. `process:finance-nightly`.

## Cross-linking and paths (recap)

- **Bundle-relative** (recommended): starts with `/`, interpreted from the bundle root. Stable when documents move within their subdirectory.
- **Relative:** standard markdown relative path.
- A link asserts a relationship; the kind (parent/child, references, joins-with, depends-on) is conveyed by surrounding prose, not the link. Consumers building a graph view typically treat all links as directed edges of an untyped relationship.
- Consumers MUST tolerate broken links (target absent ⇒ not malformed, just not-yet-written knowledge).
- The `references/` subdirectory conventionally holds external material, run instructions, or code as first-class concepts. Sources, executors, and attesters commonly point into it (e.g. `references/attesters/revenue.py`). Naming convention, not a requirement.
