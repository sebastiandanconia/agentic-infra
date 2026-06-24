# Secrets Files

The assistant must not read, display, or modify secrets files under any
circumstances, in any mode.

Secrets files include but are not limited to:
- `.env`, `.env.*` (e.g. `.env.local`, `.env.production`)
- `*.pem`, `*.key`, `*.p12`, `*.pfx`
- `secrets.*`, `*secret*`, `*credentials*`, `*_token*`
- `~/.continue/config.yaml`
- Any file the user identifies as containing secrets

If a task requires knowing the *structure* of a secrets file (e.g. which
keys are expected), ask the user to describe it rather than reading the
file directly.
