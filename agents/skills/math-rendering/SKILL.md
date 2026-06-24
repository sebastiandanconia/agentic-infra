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
