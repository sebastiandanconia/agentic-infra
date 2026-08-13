/**
 * Context Manager Extension
 *
 * Gives the agent tools to observe and manage its own context window:
 *
 * - `context_usage`  — report this session's context fill (tokens, window,
 *   percent) so the agent can poll before long tasks and when approaching
 *   limits.
 * - `compact_context` — trigger pi's compaction programmatically, without a
 *   user-side `/compact`. The session file retains the pre-compact branch,
 *   so this is session-internal and recoverable.
 *
 * Policy-free by design: the tools always work. The decision of *when* to
 * compact (e.g. only at autonomy L2+, never mid-atomic-edit, log to task
 * state for audit) lives in the agent layer, not here, so this extension
 * stays reusable across projects and agents that do not use the autonomy
 * scheme.
 *
 * Install: ~/.pi/agent/extensions/context-manager.ts  (global), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

export default function contextManagerExtension(pi: ExtensionAPI) {
  pi.registerTool({
    name: "context_usage",
    label: "Context Usage",
    description:
      "Report this session's context-window fill: token count, the active model's context window, and the fill percent. Poll before long tasks and when approaching limits. Returns a recommendation when fill is high.",
    promptSnippet: "Report this session's context-window fill (tokens, percent, window)",
    promptGuidelines: [
      "Use context_usage to poll this session's context fill before long tasks and when you suspect you are approaching the limit.",
    ],
    parameters: Type.Object({}),
    async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
      const usage = ctx.getContextUsage();
      const model = ctx.model;

      const tokens = typeof usage?.tokens === "number" ? usage.tokens : null;
      // The window size may be on the usage object or on the active model;
      // try both, defensively (the exact usage shape is not pinned in the
      // docs). Avoid the name `window` (shadows the global).
      const usageAny = usage as unknown as Record<string, unknown> | null;
      const usageWindow =
        typeof usageAny?.contextWindow === "number" ? (usageAny.contextWindow as number) : null;
      const modelWindow =
        typeof model?.contextWindow === "number" ? model.contextWindow : null;
      const windowSize: number | null = usageWindow ?? modelWindow;

      const pct =
        tokens != null && windowSize != null && windowSize > 0 ? (tokens / windowSize) * 100 : null;

      const parts: string[] = [];
      if (tokens != null) {
        parts.push(`${tokens.toLocaleString()} tokens`);
      } else {
        parts.push("token count unavailable");
      }
      if (windowSize != null) {
        parts.push(`window ${windowSize.toLocaleString()}`);
      }
      if (pct != null) {
        parts.push(`${pct.toFixed(1)}%`);
      }
      if (model) {
        parts.push(`model ${model.provider}/${model.id}`);
      }

      let recommendation = "";
      if (pct != null) {
        if (pct >= 90) {
          recommendation = " Critically high — compact before continuing any long task.";
        } else if (pct >= 75) {
          recommendation = " Approaching the limit — consider compacting before a long task.";
        } else if (pct >= 50) {
          recommendation = " Moderate fill.";
        }
      }

      let rawClone: unknown = null;
      try {
        rawClone = usage ? JSON.parse(JSON.stringify(usage)) : null;
      } catch {
        rawClone = null;
      }

      const text = `Context: ${parts.join(", ")}.${recommendation}`;
      return {
        content: [{ type: "text" as const, text }],
        details: {
          tokens,
          contextWindow: windowSize,
          percent: pct,
          model: model ? `${model.provider}/${model.id}` : null,
          // Echo the raw usage object so the agent can calibrate field
          // names on first call.
          raw: rawClone,
        },
      };
    },
  });

  pi.registerTool({
    name: "compact_context",
    label: "Compact Context",
    description:
      "Trigger context compaction for this session, freeing context window space. Use when context_usage reports high fill or before a long task. Compaction runs asynchronously: the current turn is aborted, older context is summarized, and the session reloads with the compacted context, so re-issue your next step afterward. The session file retains the pre-compact branch (recoverable).",
    promptSnippet: "Trigger this session's context compaction to free context-window space",
    promptGuidelines: [
      "Use compact_context to compact this session when context_usage reports high fill. It is fire-and-forget: it triggers compaction and returns immediately, the current turn is aborted, and the session reloads with compacted context. Re-issue your next step once compaction finishes. The session file retains the pre-compact branch so this is recoverable.",
    ],
    parameters: Type.Object({
      instructions: Type.Optional(
        Type.String({
          description:
            "Custom summarizer instructions, e.g. 'Focus on the electrical-system state, open review threads, and the task-002 commit sequence.'",
        }),
      ),
    }),
    async execute(_toolCallId, params, signal, _onUpdate, ctx) {
      // Trigger compaction, then return with `terminate: true`.
      // Do NOT await ctx.compact() itself — that deadlocks.
      //
      // Background — the original deadlock (v1):
      //   The tool awaited ctx.compact(). compact() begins with
      //   `await abort()`. abort() calls `await waitForIdle()`, which
      //   waits for the run to finish, which waits for this tool's
      //   promise to settle, which only settles via onComplete/onError,
      //   which only fire after compact() returns, which is stuck on
      //   abort(). Re-entrant circular await → ~32h hang.
      //
      // v2 fix (fire-and-forget): return immediately after calling
      //   ctx.compact(). This broke the deadlock but created a race:
      //   the agent loop saw the tool result and made one more LLM call
      //   before compact's abort() fired. That call was aborted
      //   mid-flight, producing an empty error message
      //   (stopReason="error", errorMessage="This operation was
      //   aborted", 0 tokens) — a wasted API call and a confusing
      //   blank response for the user.
      //
      // v3 fix (this version): call ctx.compact() fire-and-forget,
      //   then return with `terminate: true` in the tool result.
      //
      //   Why this works: compact() → abort() calls
      //   `controller.abort()` (fires the signal synchronously) BEFORE
      //   `await waitForIdle()`. So by the time our execute() returns,
      //   the signal is already aborted. The agent loop's
      //   executeToolCallsSequential sees `signal?.aborted` → breaks
      //   out of the tool batch. But without `terminate: true`,
      //   shouldTerminateToolBatch() returns false, so
      //   `hasMoreToolCalls` stays true and the loop makes one more
      //   streamAssistantResponse() call — which is immediately
      //   aborted, producing the empty error message.
      //
      //   Setting `terminate: true` makes shouldTerminateToolBatch()
      //   return true, so `hasMoreToolCalls = !true = false`, the
      //   inner loop exits without another LLM call, the run
      //   finishes, waitForIdle() resolves, and compact() proceeds
      //   with summarization. No wasted API call, no blank error.
      //
      // The pre-compact branch is retained in the session file, so
      // this is recoverable. onComplete/onError are best-effort UI
      // notifications only — never the tool's resolution path.
      const instructions = params.instructions;
      ctx.compact({
        customInstructions: instructions,
        onComplete: (result) => {
          if (signal?.aborted) return;
          const after =
            typeof result?.estimatedTokensAfter === "number"
              ? result.estimatedTokensAfter
              : typeof result?.tokensBefore === "number"
                ? result.tokensBefore
                : null;
          try {
            ctx.ui.notify(
              `Context compacted${after != null ? ` (~${Number(after).toLocaleString()} tokens retained)` : ""}.`,
              "info",
            );
          } catch {
            // Notifications are best-effort; never throw from a callback.
          }
        },
        onError: (error) => {
          if (signal?.aborted) return;
          try {
            ctx.ui.notify(`Compaction failed: ${error.message}`, "error");
          } catch {
            // Best-effort.
          }
        },
      });

      return {
        content: [
          {
            type: "text" as const,
            text:
              "Compaction triggered. It runs asynchronously: the current turn is aborted, older context is summarized, and the session reloads with the compacted context. Re-issue your next step once compaction finishes (the pre-compact branch is retained, so nothing is lost).",
          },
        ],
        details: { ok: true, triggered: true, instructions: instructions ?? null },
        // Signal the agent loop to stop after this tool batch.
        // Without this, the loop makes one more (aborted) LLM call
        // — the race that produced the empty "This operation was
        // aborted" error message in v2.
        terminate: true,
      };
    },
  });
}
