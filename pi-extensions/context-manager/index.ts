/**
 * Context Manager Extension
 *
 * Gives the agent tools to observe and manage its own context window:
 *
 * - `context_usage`  — report this session's context fill (tokens, window,
 *   percent) so the agent can poll before long tasks and when approaching
 *   limits.
 * - `compact_context` — trigger pi's compaction programmatically, without a
 *   user-side `/compact`. It is fire-and-forget: it kicks off compaction and
 *   returns immediately, the current turn is aborted, older context is
 *   summarized, and the session reloads with the compacted context. The session
 *   file retains the pre-compact branch, so this is session-internal and
 *   recoverable.
 *
 * Policy-free by design: the tools always work. The decision of *when* to
 * compact (e.g. only at autonomy L2+, never mid-atomic-edit, log to task state
 * for audit) lives in the agent layer, not here, so this extension stays
 * reusable across projects and agents that do not use the autonomy scheme.
 *
 * Install: ~/.pi/agent/extensions/context-manager.ts  (global), then /reload.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildContextUsageResult, triggerCompaction } from "./lib";

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
      const { text, details } = buildContextUsageResult(ctx.getContextUsage(), ctx.model);
      return { content: [{ type: "text" as const, text }], details };
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
      // Pass wrappers (not ctx.compact / ctx.ui.notify directly) so `this`
      // binding can never bite across pi versions. triggerCompaction returns
      // synchronously; it does NOT await ctx.compact's callbacks.
      return triggerCompaction(
        (options) => ctx.compact(options),
        (message, kind) => ctx.ui.notify(message, kind),
        params.instructions,
        signal,
      );
    },
  });
}
