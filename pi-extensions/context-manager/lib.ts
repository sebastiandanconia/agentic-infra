// Testable internals for the context-manager pi extension.
//
// The factory in index.ts stays thin (it only touches the ExtensionAPI surface
// and ctx) and delegates everything unit-testable to this module.
//
// Why compact_context is fire-and-forget (the important invariant):
//
// pi's compaction pipeline (AgentSession.compact) begins with
// `await abort()` to abort the current agent operation, and the current agent
// operation *is* this tool's own execution — the agent loop is
// `await tool.execute(...)`. abort() then `await waitForIdle()`, which awaits
// the run, which awaits this tool's promise. If the tool only resolves inside
// onComplete/onError, and those callbacks only fire after compact() returns,
// the awaits form a re-entrant cycle and the tool hangs forever (and if the
// tool ignores its AbortSignal, even abort cannot break it). That deadlock left
// a real session stuck on a compact_context call for ~32h.
//
// triggerCompaction() therefore kicks off ctx.compact() and returns
// immediately. The (now-aborted) run signal ends the turn, waitForIdle()
// resolves, and compaction actually runs while the harness is idle, then
// reloads the session. onComplete/onError are best-effort UI notifications
// only — never the tool's resolution path. The pre-compact branch is retained
// in the session file, so nothing is lost.

import type { CompactionResult, ContextUsage } from "@earendil-works/pi-coding-agent";

/** Minimal slice of a pi model that this module needs. */
export interface ModelLike {
  provider: string;
  id: string;
  contextWindow?: number;
}

/** pi's ctx.ui.notify signature. `kind` is optional in pi; handlers always pass it. */
export type NotifyFn = (message: string, kind?: "info" | "warning" | "error") => void;

/** Shape of ctx.compact's options. Mirrors pi's CompactOptions. */
export interface CompactOptions {
  customInstructions?: string;
  onComplete?: (result: CompactionResult) => void;
  onError?: (error: Error) => void;
}

/** A callable accepting CompactOptions, e.g. ctx.compact or a wrapper around it. */
export type CompactFn = (options: CompactOptions) => void;

/** Best-effort onComplete/onError handlers for a fire-and-forget compact() call. */
export interface CompactHandlers {
  onComplete: (result: CompactionResult) => void;
  onError: (error: Error) => void;
}

export interface ContextUsageDetails {
  tokens: number | null;
  contextWindow: number | null;
  percent: number | null;
  model: string | null;
  /** Deep clone of the raw ContextUsage snapshot, for agent calibration. */
  raw: unknown;
}

export interface ContextUsageResult {
  text: string;
  details: ContextUsageDetails;
}

export interface CompactionTriggerResult {
  content: [{ type: "text"; text: string }];
  details: { ok: true; triggered: true; instructions: string | null };
}

/** Text returned by the compact_context tool. Kept here so tests can assert on it. */
export const COMPACTION_TRIGGERED_TEXT =
  "Compaction triggered. It runs asynchronously: the current turn is aborted, older context is summarized, and the session reloads with the compacted context. Re-issue your next step once compaction finishes (the pre-compact branch is retained, so nothing is lost).";

/**
 * Recommendation copy appended to the context_usage tool result when fill is
 * high. Returns "" when percent is null/unknown so the agent is not misled.
 */
export function recommendationForPercent(percent: number | null): string {
  if (percent == null) return "";
  if (percent >= 90) return " Critically high — compact before continuing any long task.";
  if (percent >= 75) return " Approaching the limit — consider compacting before a long task.";
  if (percent >= 50) return " Moderate fill.";
  return "";
}

/** Render a model as "provider/id", or null when no model is active. */
export function modelLabel(model: ModelLike | undefined): string | null {
  return model ? `${model.provider}/${model.id}` : null;
}

/**
 * Estimate retained tokens from a CompactionResult. Prefer
 * estimatedTokensAfter; fall back to tokensBefore; otherwise null. Exposed for
 * testability and used by the onComplete handler.
 */
export function retainedTokens(result: CompactionResult): number | null {
  if (typeof result.estimatedTokensAfter === "number") return result.estimatedTokensAfter;
  if (typeof result.tokensBefore === "number") return result.tokensBefore;
  return null;
}

/**
 * Build the context_usage tool result (text + details) from a ContextUsage
 * snapshot and the active model. Pure: no I/O, no side effects.
 *
 * The window is taken from usage.contextWindow, falling back to
 * model.contextWindow. percent is computed from tokens/window rather than
 * trusted from usage.percent, matching the original tool's behavior.
 */
export function buildContextUsageResult(
  usage: ContextUsage | undefined,
  model: ModelLike | undefined,
): ContextUsageResult {
  const tokens = usage && typeof usage.tokens === "number" ? usage.tokens : null;
  const usageWindow = usage && typeof usage.contextWindow === "number" ? usage.contextWindow : null;
  const modelWindow = model && typeof model.contextWindow === "number" ? model.contextWindow : null;
  const windowSize: number | null = usageWindow ?? modelWindow;
  const percent =
    tokens != null && windowSize != null && windowSize > 0 ? (tokens / windowSize) * 100 : null;

  const parts: string[] = [];
  parts.push(tokens != null ? `${tokens.toLocaleString()} tokens` : "token count unavailable");
  if (windowSize != null) parts.push(`window ${windowSize.toLocaleString()}`);
  if (percent != null) parts.push(`${percent.toFixed(1)}%`);
  const label = modelLabel(model);
  if (label) parts.push(`model ${label}`);

  let rawClone: unknown = null;
  try {
    rawClone = usage ? JSON.parse(JSON.stringify(usage)) : null;
  } catch {
    // A non-serializable usage snapshot (e.g. circular) must not break the tool.
    rawClone = null;
  }

  const text = `Context: ${parts.join(", ")}.${recommendationForPercent(percent)}`;
  return {
    text,
    details: { tokens, contextWindow: windowSize, percent, model: label, raw: rawClone },
  };
}

/**
 * Build best-effort onComplete/onError handlers for a fire-and-forget
 * ctx.compact() call.
 *
 * The handlers only emit UI notifications; they are never the tool's
 * resolution path. They short-circuit (no-op) once `signal` is aborted,
 * because by then the turn that owns this tool is gone and the post-compaction
 * reload will produce its own UI. Each handler swallows any throw from `notify`
 * so a bad UI never breaks compaction.
 */
export function createCompactHandlers(
  notify: NotifyFn,
  signal: AbortSignal | undefined,
): CompactHandlers {
  const safeNotify = (message: string, kind: "info" | "error"): void => {
    if (signal?.aborted) return;
    try {
      notify(message, kind);
    } catch {
      // Best-effort: never throw out of a compaction callback.
    }
  };

  return {
    onComplete: (result) => {
      const after = retainedTokens(result);
      safeNotify(
        `Context compacted${after != null ? ` (~${Number(after).toLocaleString()} tokens retained)` : ""}.`,
        "info",
      );
    },
    onError: (error) => {
      safeNotify(`Compaction failed: ${error.message}`, "error");
    },
  };
}

/** Build the synchronous result returned by the compact_context tool. */
export function compactionTriggeredResult(instructions: string | undefined): CompactionTriggerResult {
  return {
    content: [{ type: "text" as const, text: COMPACTION_TRIGGERED_TEXT }],
    details: { ok: true, triggered: true, instructions: instructions ?? null },
  };
}

/**
 * Trigger pi compaction in fire-and-forget mode and return the tool result
 * immediately. This must NOT await the callbacks — see the file header for the
 * deadlock this prevents. `compactFn` is typically a wrapper around ctx.compact
 * and `notify` around ctx.ui.notify, passed as plain functions so there are no
 * `this`-binding hazards across pi versions.
 */
export function triggerCompaction(
  compactFn: CompactFn,
  notify: NotifyFn,
  instructions: string | undefined,
  signal: AbortSignal | undefined,
): CompactionTriggerResult {
  const { onComplete, onError } = createCompactHandlers(notify, signal);
  compactFn({ customInstructions: instructions, onComplete, onError });
  return compactionTriggeredResult(instructions);
}
