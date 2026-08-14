#!/usr/bin/env bash
# OKF v0.2 bundle conformance checker.
# Usage: validate-bundle.sh <bundle-dir>
#
# Fast, dependency-light scan. Checks the hard conformance rules from the OKF
# spec (§11): every non-reserved .md has parseable YAML frontmatter with a
# non-empty `type`; reserved filenames (index.md, log.md) are structurally sane.
# Does NOT validate optional family field semantics — see references/CONFORMANCE.md.
#
# Exit codes: 0 = conformant, 1 = violations found, 2 = usage/IO error.

set -u

if [ "$#" -ne 1 ]; then
  echo "usage: $0 <bundle-dir>" >&2
  exit 2
fi

bundle="$1"
if [ ! -d "$bundle" ]; then
  echo "error: not a directory: $bundle" >&2
  exit 2
fi

# yaml_block: read a file; if it starts with "---\n", print lines until the next
# standalone "---", then stop. Returns the frontmatter block (without delimiters)
# on stdout; empty if no/invalid block.
yaml_block() {
  awk '
    FNR==1 {
      if ($0 != "---") { exit }
      in_fm = 1; next
    }
    in_fm {
      if ($0 == "---") { found = 1; exit }
      print
    }
    END { exit (found ? 0 : 1) }
  ' "$1"
}

has_type() {
  # accepts frontmatter text on stdin; prints the type value if non-empty
  awk '
    /^[[:space:]]*type[[:space:]]*:/ {
      line = $0
      sub(/^[[:space:]]*type[[:space:]]*:[[:space:]]*/, "", line)
      gsub(/^["'\'']|["'\'']$/, "", line)
      gsub(/[[:space:]]+$/, "", line)
      if (line != "") { print line; found = 1 }
    }
    END { exit (found ? 0 : 1) }
  '
}

violations=0
concepts=0
reserved=0

while IFS= read -r -d '' f; do
  base="$(basename "$f")"

  # Reserved filenames.
  if [ "$base" = "index.md" ] || [ "$base" = "log.md" ]; then
    reserved=$((reserved + 1))
    # Reserved files carry no frontmatter, except a root index.md MAY carry okf_version.
    firstline="$(head -n1 "$f" 2>/dev/null)"
    if [ "$firstline" = "---" ]; then
      # Only allowed if it is a root index.md and the sole key is okf_version.
      rel="${f#"$bundle"/}"
      if [ "$rel" = "index.md" ]; then
        keys="$(yaml_block "$f" | grep -E '^[[:space:]]*[A-Za-z0-9_]+[[:space:]]*:' | sed -E 's/^[[:space:]]*([A-Za-z0-9_]+).*/\1/')"
        bad=0
        while IFS= read -r k; do
          [ -n "$k" ] || continue
          if [ "$k" != "okf_version" ]; then bad=1; fi
        done <<< "$keys"
        if [ "$bad" -ne 0 ]; then
          echo "VIOLATION: root index.md frontmatter has keys other than okf_version: $f" >&2
          violations=$((violations + 1))
        fi
      else
        echo "VIOLATION: reserved file has frontmatter (only root index.md may, okf_version only): $f" >&2
        violations=$((violations + 1))
      fi
    fi
    continue
  fi

  concepts=$((concepts + 1))
  fm="$(yaml_block "$f")"
  if [ $? -ne 0 ]; then
    echo "VIOLATION: no parseable YAML frontmatter block: $f" >&2
    violations=$((violations + 1))
    continue
  fi
  if [ -z "$fm" ]; then
    echo "VIOLATION: empty frontmatter block: $f" >&2
    violations=$((violations + 1))
    continue
  fi
  if ! printf '%s\n' "$fm" | has_type >/dev/null; then
    echo "VIOLATION: missing or empty required 'type' field: $f" >&2
    violations=$((violations + 1))
  fi
done < <(find "$bundle" -type f -name '*.md' -print0)

echo "scanned: $concepts concept(s), $reserved reserved file(s), $violations violation(s)" >&2
if [ "$violations" -gt 0 ]; then
  exit 1
fi
exit 0
