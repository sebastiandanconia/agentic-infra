# OKF v0.2 — worked examples

Copy-and-paste examples that exercise every family. For field rules see
`FIELDS.md`; for the attestation runtime protocol see `ATTESTED-COMPUTATION.md`.

## 1. Concept bound to a resource

```markdown
---
type: BigQuery Table
title: Customer Orders
description: One row per completed customer order across all channels.
resource: https://console.cloud.google.com/bigquery?p=acme&d=sales&t=orders
tags: [sales, orders, revenue]
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-05-28T14:30:00Z }
---

# Schema

| Column        | Type      | Description                              |
|---------------|-----------|------------------------------------------|
| `order_id`    | STRING    | Globally unique order identifier.        |
| `customer_id` | STRING    | Foreign key into [customers](/tables/customers.md). |
| `total_usd`   | NUMERIC   | Order total in US dollars.               |
| `placed_at`   | TIMESTAMP | When the customer submitted the order.   |

# Joins

Joined with [customers](/tables/customers.md) on `customer_id`.
```

Notes: bundle-relative link `/tables/customers.md` is the recommended form. The
concept carries `generated` (trust) but no `verified` ⇒ **unverified** tier,
still fully consumable.

## 2. Concept not bound to a resource (abstract idea)

```markdown
---
type: Playbook
title: "Incident response: data freshness alert"
description: Steps to triage a freshness alert on the orders pipeline.
tags: [oncall, incident]
generated: { by: human:ahormati, at: 2026-04-12T09:00:00Z }
---

# Trigger

A freshness alert fires when `orders` lags more than 30 minutes behind its
expected SLA. See the [orders table](/tables/orders.md).

# Steps

1. Check the [ingestion job dashboard](https://example.com/dash).
2. ...
```

Notes: `generated.by: human:ahormati` (human author). No `resource` (abstract).
Links express relationships via prose context ("See the orders table").

## 3. Attested Computation with full provenance + trust + lifecycle

```markdown
---
type: Attested Computation
title: Revenue for fiscal year
description: Recognized revenue for a fiscal year, per Finance's definition.
tags: [finance, revenue]
status: stable
runtime: bigquery
parameters:
  - { name: year, type: integer, required: true }
executor:
  resource: references/skills/run-on-bq.md
  receipt: [job_id, executed_sql, result]
attester:
  resource: references/attesters/sql-equality.py
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-28T14:00:00Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-12-31
sources:
  - id: rev-policy
    resource: https://wiki.acme/finance/revenue-recognition
    title: Revenue recognition policy
    author: team:finance-fpa
    last_modified: 2026-04-02
  - id: exec-rev-dash
    resource: dashboards/exec-revenue
    title: Executive revenue dashboard
    author: team:finance-fpa
    usage_count: 5000
    last_modified: 2026-06-18
usage_window: { from: 2026-06-01, to: 2026-06-30 }
---

# Computation

    SELECT SUM(amount) AS revenue
    FROM finance.recognized_revenue
    WHERE fiscal_year = @year

Recognized revenue per the recognition policy,[^rev-policy] corroborated by
the executive revenue dashboard.[^exec-rev-dash]

[^rev-policy]: Revenue recognition policy
[^exec-rev-dash]: Executive revenue dashboard
```

Notes: two sources with credibility signals; `usage_window` frames
`usage_count`; footnotes keyed to `sources[].id`; human-reviewed tier;
attester is deterministic no-LLM code.

## 4. A computation in a deliberately stale, process-verified state

Same shape as #3 but past its expiry and machine-confirmed only:

```yaml
status: stable
runtime: dbt
parameters:
  - { name: year, type: integer, required: true }
  - { name: segment, type: string, required: true }
executor:
  resource: references/skills/run-dbt.md
  receipt: [run_id, compiled_sql, result]
attester:
  resource: references/attesters/dbt-binding.py
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-14T14:00:00Z }
verified: { by: process:finance-nightly, at: 2026-06-12T08:00:00Z }
stale_after: 2026-06-15
```

```dbt
# body # Computation fence
SELECT gross_profit
FROM {{ ref('fct_income_statement') }}
WHERE fiscal_year = {{ var('year') }}
  AND segment = {{ var('segment') }}
```

Notes: `verified` by `process:` only ⇒ **machine-confirmed** (not
human-reviewed). `stale_after: 2026-06-15` ⇒ stale once `today >= 2026-06-15`.
It can still attest cleanly on a run even while its *definition* is stale —
that is exactly why `verified` and attestation are separate.

## 5. v0.1 → v0.2 migration (income statement)

A single v0.1 doc holding both revenue and gross profit, SQL in prose,
citations as a flat list, only `timestamp`:

```markdown
---
type: Metric
title: Income statement (fiscal year)
description: Headline income-statement figures for a fiscal year.
tags: [finance, income-statement]
timestamp: '2026-05-28T22:53:05+00:00'
---

# Definition
The income statement reports revenue and gross profit for a fiscal year.

# Revenue
Recognized revenue sums `amount` over rows booked to the fiscal year:
    SELECT SUM(amount) AS revenue FROM finance.recognized_revenue WHERE fiscal_year = <year>

# Gross profit
Gross profit by segment, per the cost-allocation standard:
    SELECT gross_profit FROM fct_income_statement WHERE fiscal_year = <year> AND segment = <segment>

# Citations
- https://wiki.acme/finance/fpa-handbook
- https://wiki.acme/finance/revenue-recognition
- https://wiki.acme/finance/cost-allocation
```

becomes a bundle where the two figures are attested computations linked from a
narrative concept:

```
bundles/finance/
  metrics/income-statement.md      type: Metric  (narrates, links both)
  computations/revenue.md          type: Attested Computation  (runtime: bigquery)
  computations/profit.md           type: Attested Computation  (runtime: dbt)
  references/skills/run-on-bq.md, run-dbt.md
  references/attesters/sql-equality.py, dbt-binding.py
```

Narrative concept (trust lives on the linked computations, not here):

```markdown
---
type: Metric
title: Income statement (fiscal year)
description: Headline income-statement figures for a fiscal year.
tags: [finance, income-statement]
status: stable
generated: { by: reference_agent/gemini-2.5-pro, at: 2026-06-20T22:53:05Z }
verified: { by: human:ahormati, at: 2026-06-25T09:00:00Z }
stale_after: 2026-12-31
sources:
  - id: fpa-handbook
    resource: https://wiki.acme/finance/fpa-handbook
    title: FP&A reporting handbook
---

# Definition
The income statement reports [revenue](../computations/revenue.md) and
[gross profit](../computations/profit.md) for a fiscal year, per the FP&A
reporting handbook.[^fpa-handbook] Each figure is produced by a sanctioned,
attestable computation; this concept only narrates them.

[^fpa-handbook]: FP&A reporting handbook
```

(`computations/revenue.md` and `computations/profit.md` are examples #3 and #4
above.)

## 6. Index file

```markdown
# Tables

* [Customer Orders](orders.md) - One row per completed customer order across all channels.
* [Customers](customers.md) - Customer master record.

# Playbooks

* [Data freshness alert](../playbooks/freshness.md) - Triage a freshness alert on the orders pipeline.
```

No frontmatter (except a root `index.md` MAY carry `okf_version`). Entries
include the linked concept's `description`.

## 7. Log file

```markdown
# Directory Update Log

## 2026-05-22
* **Update**: Added a BigQuery table reference for [Customer Metrics](/tables/customer-metrics.md).
* **Creation**: Established the [Dataplex Playbook](/playbooks/dataplex.md).

## 2026-05-15
* **Initialization**: Created foundational directory structure.
```

Flat list, newest first, ISO `YYYY-MM-DD` date headings, prose entries with a
conventional bold lead word (`**Update**`, `**Creation**`, `**Deprecation**`) —
convention, not requirement.
