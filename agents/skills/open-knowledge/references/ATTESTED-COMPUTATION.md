# OKF v0.2 — Attested Computation

Load this only when authoring or running an Attested Computation. For the
operating manual see `../SKILL.md`; for every field see `FIELDS.md`.

## Why a computation is its own concept

An Attested Computation concept carries not just what a value *means* but a
sanctioned way to *compute* it, so a consumer can confirm the agent ran the
blessed computation instead of improvising its own. Provenance (`sources`)
answers "where did this claim come from"; attestation answers "was this number
produced the way we said it must be." OKF records the computation and the means
to check it; it does not execute anything itself.

Three properties motivate making it a standalone concept (`type: Attested
Computation`):

1. **`runtime` defines what `parameters` mean.** A parameter is a SQL bind
   variable, a dbt var, or a Python argument depending on the runtime. Keeping
   `runtime` and `parameters` together in frontmatter makes the binding
   semantics self-evident.
2. **One computation, many consumers.** The same computation can back a metric,
   a dashboard concept, and a report; as a concept it is referenced once and
   reused.
3. **Trust state is per computation.** `verified`, `stale_after`, and a single
   `attester` describe one thing. Revenue, profit, and margin each verify and
   attest independently — three concepts, not three entries in one frontmatter.

A concept that *needs* the value (a `Metric`, a `BigQuery Table`) links to the
computation with a normal markdown link; it does not embed the SQL.

## Contract (frontmatter)

In addition to the provenance, trust, and lifecycle families, an Attested
Computation carries:

| Field | Required | Rule |
|---|---|---|
| `runtime` | **yes** | How to run the computation; defines `parameters` binding. `bigquery`, `postgres`, `dbt`, `python`, `Looker`, … |
| `parameters` | no (usually present) | List of `{ name, type, required }`. The typed, named holes the agent may fill. |
| `computation` | no | Path to a file holding the computation. Absent ⇒ the body `# Computation` fence is the computation. |
| `executor` | no (normatively expected) | `{ resource, receipt }`. `resource` names run instructions/code a runner follows. `receipt` lists the fields a run must return — the evidence the attester inspects (e.g. a BigQuery `job_id` and the SQL the job actually executed). |
| `attester` | no (normatively expected) | `{ resource }`. Deterministic (**no LLM**) code that takes a receipt and returns a verdict. Intended to run on the consumer side. |

OKF fixes the interface, not the packaging — what sits behind a `resource`
(Skill, script, container) is the producer's choice.

## The computation (two ways to provide it)

- **Inline:** a single fenced code block in the body under `# Computation`. Best
  for a short computation reviewed alongside the contract.
- **File:** set `computation` to a path and omit the body fence. Best for a long
  or generated computation, or one already kept as a real file shared with
  non-OKF tooling.

```yaml
runtime: bigquery
computation: references/computations/lib/revenue.sql
parameters:
  - { name: year, type: integer, required: true }
```

### Hard rule on authoring

The agent may supply only **values** for the declared `parameters`; it MUST NOT
author or edit the computation. Binding the computation with those parameter
values into the executable artifact is the **consumer's** job, and the attester
independently re-derives that same binding to compare against what actually ran.

Because the comparison is on the expanded, compiled artifact the receipt carries
(`executed_sql`, `compiled_sql`), a rewritten query, a swapped computation file,
or a mutated dependency fails the check. A typed, parameter-only surface is what
makes "did the sanctioned thing run" a mechanical comparison rather than a
judgment call.

## Worked example

```markdown
---
type: Attested Computation
title: Revenue for fiscal year
description: Recognized revenue for a fiscal year, per Finance's definition.
status: stable
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: references/skills/run-on-bq.md
  receipt: [job_id, executed_sql, result]
attester:
  resource: references/attesters/revenue.py
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-09-23
sources:
  - id: rev-policy
    resource: https://wiki.acme/finance/revenue-recognition
    title: Revenue recognition policy
---

# Computation

    SELECT SUM(amount) AS revenue
    FROM finance.recognized_revenue
    WHERE fiscal_year = @year

The computation binds only the declared `parameters`, per the recognition
policy.[^rev-policy]

[^rev-policy]: Revenue recognition policy
```

A concept that uses this value links to it:

```markdown
---
type: Metric
title: Revenue
description: Recognized revenue for a fiscal year.
tags: [finance, revenue]
status: stable
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
---

# Definition

Recognized revenue sums `amount` over rows booked to the fiscal year,
computed by [the revenue computation](../computations/revenue.md).
```

Because each computation is its own concept, revenue can be fresh while profit
is past its `stale_after`, and each attests on its own run. Co-locating them is
a directory choice (a `computations/` folder with an `index.md`), not a
frontmatter one.

## How a consumer uses it (informative runtime protocol)

The runtime artifacts below are **not** stored in the bundle.

1. **Discover** via `type: Attested Computation` (a frontmatter signal that can
   be lifted into `index.md`); reach one directly or by following a link from a
   concept that uses it.
2. **Load** the contract from frontmatter and the computation from the body (or
   the file named by `computation`).
3. **Parameterize**: the agent supplies values for the declared `parameters`.
4. **Execute**: the executor runs the bound computation and returns a receipt
   shaped by `executor.receipt`.
5. **Attest**: the consumer runs the attester over the receipt. It confirms:
   - **provenance** — the computation that ran equals `computation` bound with
     the claimed parameters, not agent-authored SQL;
   - **fidelity** — the displayed value matches the receipt's authoritative
     source, re-read by job id rather than taken from the agent's text.
6. **Gate**: refuse to display a failing attestation; warn or refuse when
   `today >= stale_after`. On success, surface the verdict (e.g. a link to the
   job log) so trust is visible.

## Verification versus attestation (both exist, they are distinct)

- **`verified`** confirms the *definition* still matches policy. Doc-level,
  slow, recorded in the bundle.
- **Attestation** confirms a single *run* produced the value the sanctioned way.
  Per-call, runtime, not stored in the bundle.

A concept with a stale definition can still attest cleanly, and a freshly
verified definition still requires attestation on each run — which is why both
are needed.
