# Pi Extensions

This repository contains custom extensions for [pi.dev](https://pi.dev), a minimal terminal coding harness.

## What is pi.dev?

[pi.dev](https://pi.dev) is a lightweight, highly extensible terminal-based coding agent. Unlike many other coding assistants, pi avoids baking in rigid workflows (like "plan mode" or "sub-agents"). Instead, it provides a powerful core and allows users to adapt the tool to their own preferences via:

- **Extensions**: TypeScript modules that add custom tools, commands, UI components, and provider integrations.
- **Skills**: Markdown-based capability packages.
- **Prompt Templates**: Reusable prompts.
- **Themes**: Custom terminal styling.

## Installing Custom Extensions

There are several ways to install extensions in pi:

### 1. Using `pi install`
If an extension is packaged as a pi package (containing a `pi` key in its `package.json`), you can install it directly:
```bash
pi install git:https://github.com/username/repo
```

### 2. Manual Installation
You can place TypeScript or compiled JavaScript extension files in the following directories:
- **Global**: `~/.pi/agent/extensions/`
- **Project-local**: `.pi/extensions/` (within your project root)

### 3. CLI Flag
Load an extension on-the-fly using the `-e` flag:
```bash
pi -e ./path/to/extension.ts
```

---

## Extensions in this Repository

### `venice-ai`
Adds support for [Venice AI](https://venice.ai) as an inference provider. This extension dynamically fetches available models from the Venice API and registers them within pi, allowing you to use Venice's uncensored and high-performance models for your coding tasks.

**Setup:**
Ensure you have your Venice API key set in your environment:
```bash
export VENICE_API_KEY=your_api_key_here
```

### `context-manager`
Adds two tools that let the agent observe and manage its own context window:

- `context_usage` — reports token count, the active model's context window, and fill percent, with a recommendation when fill is high.
- `compact_context` — triggers pi's compaction programmatically (no user-side `/compact`). It is fire-and-forget so it cannot deadlock against pi's abort-then-wait-for-idle compaction pipeline; the current turn is aborted, older context is summarized, and the session reloads with the compacted context. The session file retains the pre-compact branch, so this is recoverable.

**Setup:**
No configuration required. Install the extension and `/reload`.
