import type { VeniceModel } from "../lib";

interface ModelOverrides {
  id?: string;
  name?: string;
  inputUsd?: number;
  outputUsd?: number;
  cacheInputUsd?: number;
  cacheWriteUsd?: number;
  contextTokens?: number;
  maxCompletion?: number;
  supportsReasoning?: boolean;
  supportsVision?: boolean;
  supportsFunctionCalling?: boolean;
  supportsReasoningEffort?: boolean;
}

/**
 * Build a VeniceModel fixture. Cache pricing fields are omitted entirely when
 * not supplied so tests can exercise the "absent -> default 0" mapping path.
 */
export function makeModel(overrides: ModelOverrides = {}): VeniceModel {
  return {
    id: overrides.id ?? "venice-1",
    model_spec: {
      name: overrides.name ?? "Venice Test Model",
      pricing: {
        input: { usd: overrides.inputUsd ?? 0.001 },
        output: { usd: overrides.outputUsd ?? 0.002 },
        ...(overrides.cacheInputUsd !== undefined
          ? { cache_input: { usd: overrides.cacheInputUsd } }
          : {}),
        ...(overrides.cacheWriteUsd !== undefined
          ? { cache_write: { usd: overrides.cacheWriteUsd } }
          : {}),
      },
      availableContextTokens: overrides.contextTokens ?? 128_000,
      maxCompletionTokens: overrides.maxCompletion ?? 8_192,
      capabilities: {
        supportsReasoning: overrides.supportsReasoning ?? false,
        supportsVision: overrides.supportsVision ?? false,
        supportsFunctionCalling: overrides.supportsFunctionCalling ?? true,
        supportsReasoningEffort: overrides.supportsReasoningEffort ?? false,
      },
    },
  };
}
