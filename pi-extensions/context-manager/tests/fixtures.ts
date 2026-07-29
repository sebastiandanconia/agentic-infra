import type { CompactionResult, ContextUsage } from "@earendil-works/pi-coding-agent";

import type { ModelLike } from "../lib";

interface UsageOverrides {
  tokens?: number | null;
  contextWindow?: number;
  percent?: number | null;
}

/**
 * Build a ContextUsage fixture. Defaults to a healthy, known fill so tests can
 * focus on the field under test. Pass `tokens: null` to exercise the
 * "token count unavailable" path.
 */
export function makeUsage(overrides: UsageOverrides = {}): ContextUsage {
  return {
    // Use !== undefined (not ??) so an explicit null is preserved instead of
    // being defaulted back to a number.
    tokens: overrides.tokens !== undefined ? overrides.tokens : 5000,
    contextWindow: overrides.contextWindow ?? 1_000_000,
    percent: overrides.percent ?? null,
  };
}

/**
 * Build a ContextUsage whose contextWindow is not a number, to exercise the
 * model.contextWindow fallback and the no-window path. pi's type says
 * contextWindow is always a number, but the tool defends against a non-number
 * defensively, so we construct one via a cast.
 */
export function makeUsageWithoutWindow(tokens: number | null = 5000): ContextUsage {
  return { tokens, contextWindow: undefined as unknown as number, percent: null };
}

interface ModelOverrides {
  provider?: string;
  id?: string;
  contextWindow?: number;
}

/** Build a ModelLike fixture. Omit contextWindow to exercise the no-model-window path. */
export function makeModel(overrides: ModelOverrides = {}): ModelLike {
  const model: ModelLike = {
    provider: overrides.provider ?? "venice",
    id: overrides.id ?? "test-model",
  };
  if (overrides.contextWindow !== undefined) {
    model.contextWindow = overrides.contextWindow;
  }
  return model;
}

interface CompactionResultOverrides {
  summary?: string;
  firstKeptEntryId?: string;
  tokensBefore?: number;
  estimatedTokensAfter?: number;
}

/** Build a CompactionResult fixture for onComplete handler tests. */
export function makeCompactionResult(
  overrides: CompactionResultOverrides = {},
): CompactionResult {
  return {
    summary: overrides.summary ?? "compacted",
    firstKeptEntryId: overrides.firstKeptEntryId ?? "entry-1",
    tokensBefore: overrides.tokensBefore ?? 200_000,
    ...(overrides.estimatedTokensAfter !== undefined
      ? { estimatedTokensAfter: overrides.estimatedTokensAfter }
      : {}),
  };
}
