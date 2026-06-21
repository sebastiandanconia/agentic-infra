// Testable internals for the Venice.ai pi extension.
// The factory in index.ts stays thin (it touches process.env / os.homedir /
// the ExtensionAPI surface) and delegates everything unit-testable to here.

import * as fs from "fs";
import * as path from "path";
import * as os from "os";

export interface VeniceModel {
  id: string;
  model_spec: {
    name: string;
    pricing: {
      input: { usd: number };
      output: { usd: number };
      cache_input?: { usd: number };
      cache_write?: { usd: number };
    };
    availableContextTokens: number;
    maxCompletionTokens: number;
    capabilities: {
      supportsReasoning: boolean;
      supportsVision: boolean;
      supportsFunctionCalling: boolean;
      supportsReasoningEffort: boolean;
    };
  };
}

export interface VeniceModelsResponse {
  data: VeniceModel[];
}

export interface CachedModels {
  models: VeniceModel[];
  timestamp: number;
}

// Cache entries are considered fresh for one hour.
export const CACHE_TTL_MS = 60 * 60 * 1000;

// Network request timeout for the Venice models endpoint.
export const FETCH_TIMEOUT_MS = 10_000;

export const VENICE_MODELS_URL = "https://api.venice.ai/api/v1/models";

// Default cache location under the user's pi config directory.
export const DEFAULT_CACHE_FILE = path.join(
  os.homedir(),
  ".pi",
  "agent",
  "venice-models-cache.json",
);

/**
 * Load cached models from `cacheFile`. Returns null when the file is missing,
 * corrupt, or older than the TTL. `now` is injectable so TTL behavior can be
 * tested deterministically without faking the system clock.
 */
export function loadCachedModels(
  cacheFile: string,
  now: number = Date.now(),
): VeniceModel[] | null {
  try {
    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const cached: CachedModels = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    const age = now - cached.timestamp;

    if (age < CACHE_TTL_MS) {
      return cached.models;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Persist `models` to `cacheFile` with a timestamp. Best-effort: any write
 * failure is swallowed so a bad cache path never breaks model loading.
 */
export function saveCachedModels(
  models: VeniceModel[],
  cacheFile: string,
  now: number = Date.now(),
): void {
  try {
    const cached: CachedModels = {
      models,
      timestamp: now,
    };
    fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2));
  } catch {
    // Silent failure: caching is best-effort.
  }
}

/**
 * Fetch the Venice model catalog. Uses the cache when `useCache` is true and
 * refreshes it in the background on a cache hit. Returns an empty array on any
 * non-ok response, network error, or abort.
 */
export async function fetchVeniceModels(
  apiKey: string,
  useCache: boolean = true,
  cacheFile: string = DEFAULT_CACHE_FILE,
): Promise<VeniceModel[]> {
  // Try cache first.
  if (useCache) {
    const cached = loadCachedModels(cacheFile);
    if (cached) {
      // Refresh in the background so the next call sees fresh data.
      setImmediate(() => {
        void fetchVeniceModels(apiKey, false, cacheFile);
      });
      return cached;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId: ReturnType<typeof setTimeout> = setTimeout(
      () => controller.abort(),
      FETCH_TIMEOUT_MS,
    );

    const response = await fetch(VENICE_MODELS_URL, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return [];
    }

    const data: VeniceModelsResponse = await response.json();
    const models = data.data;

    saveCachedModels(models, cacheFile);

    return models;
  } catch {
    return [];
  }
}

/**
 * Map a Venice model descriptor into pi's ProviderModelConfig shape.
 */
export function mapVeniceModel(model: VeniceModel) {
  const spec = model.model_spec;

  return {
    id: model.id,
    name: spec.name,
    reasoning: spec.capabilities.supportsReasoning || false,
    input: spec.capabilities.supportsVision
      ? (["text", "image"] as const)
      : (["text"] as const),
    cost: {
      input: spec.pricing.input.usd,
      output: spec.pricing.output.usd,
      cacheRead: spec.pricing.cache_input?.usd ?? 0,
      cacheWrite: spec.pricing.cache_write?.usd ?? 0,
    },
    contextWindow: spec.availableContextTokens,
    maxTokens: spec.maxCompletionTokens,
    compat: {
      supportsDeveloperRole: true,
      supportsReasoningEffort: spec.capabilities.supportsReasoningEffort,
      supportsLongCacheRetention: false, // Venice rejects prompt_cache_retention: "24h"
    },
  };
}
