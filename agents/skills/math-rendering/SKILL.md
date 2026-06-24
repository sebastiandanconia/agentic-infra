---
name: math-rendering
description: Enforces terminal-first math output standards. Renders math as Unicode pretty-math in chat by default and avoids Markdown math delimiters ($...$, $$...$$) unless the user explicitly asks for them. Writes formal derivations, proofs, and equation sets to LaTeX .tex artifacts under the default path artifacts/math/<name>.tex, optionally split into notes.tex (equations only) and full.tex (standalone document with preamble). In combined mode, gives a brief Unicode summary in chat plus the full .tex artifact path. Use when displaying equations, derivations, proofs, or any non-trivial math.
---

# Math Output Standards (terminal-first):
 - Default math rendering in chat: Unicode pretty-math.
 - Do not use Markdown math delimiters ($...$, $$...$$) unless user explicitly asks.
 - Suggested default path: artifacts/math/<name>.tex.

## Unicode pretty-math mode
 Use Unicode symbols but still plain text, e.g.:
 - ∀x ∈ ℝ, x² ≥ 0
 - f: ℝ → ℝ

## TeX/LaTeX artifact mode
 - Put formal derivations/proofs/equations into a LaTeX `.tex` file.
 - This file must consist of valid LaTeX.
 - Prefer letter-sized pages
 - Optionally split into:
     - notes.tex (equations only)
     - full.tex (standalone document with preamble)
 - If response includes non-trivial derivation/proof/equation sets, generate a .tex artifact.

## Combined mode
Brief Unicode summary in chat + full .tex artifact path.
