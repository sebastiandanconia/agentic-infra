# context-manager

A [pi](https://pi.dev) extension that gives the agent tools to observe and manage its own context window.

## Tools

### `context_usage`

Reports this session's context-window fill: token count, the active model's context window, and the fill percent. Poll before long tasks and when approaching limits. Returns a recommendation when fill is high (`>= 75%` approaching, `>= 90%` critically high).

### `compact_context`

Triggers pi's context compaction programmatically, without a user-side `/compact`. Use when `context_usage` reports high fill or before a long task. Pass optional `instructions` to focus the summary, e.g. `"Focus on the electrical-system state, open review threads, and the task-002 commit sequence."`

`compact_context` is **fire-and-forget**: it kicks off compaction and returns immediately. The current turn is aborted, older context is summarized, and the session reloads with the compacted context, so re-issue your next step once compaction finishes. The session file retains the pre-compact branch, so this is session-internal and recoverable.

## Why fire-and-forget

pi's compaction pipeline (`AgentSession.compact`) begins with `await abort()` of the current agent operation — and the current agent operation *is* this tool's own execution (the agent loop is `await tool.execute(...)`). `abort()` then `await waitForIdle()`, which awaits the run, which awaits this tool's promise. If the tool only resolved inside the `onComplete`/`onError` callbacks, and those callbacks only fire after `compact()` returns, the awaits form a re-entrant cycle and the tool hangs forever (and ignoring the run's `AbortSignal` means even abort cannot break it). That deadlock once left a session stuck on a `compact_context` call for ~32h.

Returning immediately breaks the cycle: compaction is kicked off, the now-aborted run signal ends the turn, `waitForIdle()` resolves, and compaction actually runs while the harness is idle and reloads the session. `onComplete`/`onError` are best-effort UI notifications only — never the tool's resolution path.

## Policy-free

The tools always work. The decision of *when* to compact (e.g. only at autonomy L2+, never mid-atomic-edit, log to task state for audit) lives in the agent layer, not here, so this extension stays reusable across projects and agents that do not use the autonomy scheme.

## Install

Place `index.ts` (or a copy named `context-manager.ts`) in `~/.pi/agent/extensions/` (global) or `.pi/extensions/` (project-local), then `/reload`. As a package it can also be installed with `pi install`.

## Develop

```bash
npm install
npm test            # vitest run
npm run test:watch
npm run test:coverage
npm run typecheck   # tsc --noEmit
```
