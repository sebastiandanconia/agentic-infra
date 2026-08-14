# OKF v0.2 — conformance and v0.1 compatibility

Load this when validating a bundle or consuming v0.1 documents. For the
operating manual see `../SKILL.md`.

## Conformance

A bundle is **conformant** with OKF v0.2 if:

1. Every non-reserved `.md` file in the tree contains a parseable YAML
   frontmatter block.
2. Every frontmatter block contains a non-empty `type` field.
3. Every reserved filename (`index.md`, `log.md`) follows the structure in
   §8/§9 (see `EXAMPLES.md`) when present.

Reserved filenames MUST NOT be used for concept documents:

| Filename | Purpose |
|---|---|
| `index.md` | Directory listing (progressive disclosure). No frontmatter, except a root `index.md` MAY carry `okf_version`. |
| `log.md` | Update history. No frontmatter. |

All other `.md` files are concept documents.

## Producer SHOULD vs consumer MUST

When the trust, lifecycle, provenance, or computation families are present,
producers SHOULD follow §5–§10, and consumers:

- **MUST** treat a bare `verified` mapping as a one-element list.
- **MUST NOT** reject a concept for missing any optional family (incl. trust —
  unverified is distinguishable but never rejected).
- **SHOULD** derive trust tiers and staleness only from the fields specified
  here, and **SHOULD** surface, not silently drop, a failing attestation.

Consumers SHOULD treat all other constraints as soft guidance.

## Consumers MUST NOT reject a bundle because of

- Missing optional frontmatter fields.
- Unknown `type` values (treat as generic concepts).
- Unknown additional frontmatter keys (preserve when round-tripping).
- Broken cross-links (target absent ⇒ not malformed, just not-yet-written).
- Missing `index.md` files (synthesize one on the fly when none is present).

## Minimal conformant concept

A concept carrying just `type` is fully conformant:

```markdown
---
type: Reference
---
Body.
```

## Versioning

- OKF is at **0.2**. Revisions are `<major>.<minor>`: minor = backward-compatible
  additions; major may break.
- Bundles MAY declare `okf_version: "0.2"` in a bundle-root `index.md`
  frontmatter block (the only place frontmatter is permitted in an `index.md`).
- Consumers that do not understand the declared version SHOULD attempt
  best-effort consumption rather than refusing the bundle.

## v0.1 compatibility (fallbacks)

v0.2 supersedes v0.1 and is versioned as a minor bump, despite two deliberate
breaking changes (renamed or retired v0.1 fields). A v0.1 bundle is consumable
by a v0.2 consumer via these fallbacks.

### Breaking changes

| v0.1 | v0.2 | Consumer fallback |
|---|---|---|
| `timestamp` | `generated.at` (now `generated: { by, at }`) | Fall back to legacy `timestamp` when `generated` is absent. |
| body `# Citations` list | `sources` frontmatter | Read `sources`; MAY still parse a legacy `# Citations` body list for v0.1 docs. |

### Additive changes (their absence yields a plain v0.1 concept)

New optional keys, one new concept type, one new conventional heading:

- `sources` + per-source credibility signals (`author`, `usage_count`,
  `last_modified`) and the `usage_window` sibling.
- `generated`, `verified`.
- `status`, `stale_after`.
- Concept type `Attested Computation` and its keys `runtime`, `parameters`,
  `computation`, `executor`, `attester`.
- Conventional body heading `# Computation`.
- The actor convention for `generated.by` and `verified[].by`.

Everything else (bundle structure, reserved filenames, the required `type`,
recommended `title`/`description`/`resource`/`tags`, cross-linking, index/log
files, permissive conformance) carries forward unchanged.

## Quick machine check

Run `../scripts/validate-bundle.sh <bundle-dir>` for a fast conformance scan
(frontmatter present + non-empty `type` on every non-reserved `.md`; reserved
files structurally sane). It is a convenience, not the whole conformance rule
set — it does not check family field semantics.
