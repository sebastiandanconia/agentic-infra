import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

interface VeniceModel {
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

interface VeniceModelsResponse {
  data: VeniceModel[];
}

interface CachedModels {
  models: VeniceModel[];
  timestamp: number;
}

// No filtering — register *all* models from Venice.ai (~69 currently).
// Models that report supportsFunctionCalling: false will use pi's simulated
// prompt-based tool calling.
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_FILE = path.join(os.homedir(), ".pi", "agent", "venice-models-cache.json");

function loadCachedModels(): VeniceModel[] | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) {
      return null;
    }

    const cached: CachedModels = JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
    const age = Date.now() - cached.timestamp;

    if (age < CACHE_TTL_MS) {
      console.log(`Venice.ai: Using cached models (age: ${Math.floor(age / 1000 / 60)}m)`);
      return cached.models;
    }

    console.log(`Venice.ai: Cache expired (age: ${Math.floor(age / 1000 / 60)}m)`);
    return null;
  } catch (error) {
    console.error("Venice.ai: Failed to load cache:", error);
    return null;
  }
}

function saveCachedModels(models: VeniceModel[]): void {
  try {
    const cached: CachedModels = {
      models,
      timestamp: Date.now(),
    };
    fs.writeFileSync(CACHE_FILE, JSON.stringify(cached, null, 2));
    console.log(`Venice.ai: Cached ${models.length} models`);
  } catch (error) {
    console.error("Venice.ai: Failed to save cache:", error);
  }
}

async function fetchVeniceModels(apiKey: string, useCache: boolean = true): Promise<VeniceModel[]> {
  // Try cache first
  if (useCache) {
    const cached = loadCachedModels();
    if (cached) {
      // Refresh in background
      setImmediate(() => fetchVeniceModels(apiKey, false));
      return cached;
    }
  }

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000); // 10s timeout

    const response = await fetch("https://api.venice.ai/api/v1/models", {
      headers: {
        "Authorization": `Bearer ${apiKey}`,
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.error(`Venice.ai models fetch failed: ${response.status} ${response.statusText}`);
      return [];
    }

    const data: VeniceModelsResponse = await response.json();

    // No filtering — use all models
    const allModels = data.data;

    // Save to cache
    saveCachedModels(allModels);

    return allModels;
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      console.error("Venice.ai: API request timed out after 10s");
    } else {
      console.error("Venice.ai: Failed to fetch models:", error);
    }
    return [];
  }
}

function mapVeniceModel(model: VeniceModel) {
  const spec = model.model_spec;

  return {
    id: model.id,
    name: spec.name,
    reasoning: spec.capabilities.supportsReasoning || false,
    input: spec.capabilities.supportsVision ? ["text", "image"] as const : ["text"] as const,
    cost: {
      input: spec.pricing.input.usd,
      output: spec.pricing.output.usd,
      cacheRead: spec.pricing.cache_input?.usd || 0,
      cacheWrite: spec.pricing.cache_write?.usd || 0,
    },
    contextWindow: spec.availableContextTokens,
    maxTokens: spec.maxCompletionTokens,
    compat: {
      supportsDeveloperRole: true,
      supportsReasoningEffort: spec.capabilities.supportsReasoningEffort,
    }
  };
}

export default async function (pi: ExtensionAPI) {
  // Get API key from environment
  const apiKey = process.env.VENICE_API_KEY;

  if (!apiKey) {
    console.warn("Venice.ai extension: VENICE_API_KEY not set. Skipping model registration.");
    console.warn("Set your API key: export VENICE_API_KEY='your-key-here'");
    return;
  }

  // Fetch models from Venice.ai (will use cache if available)
  const veniceModels = await fetchVeniceModels(apiKey);

  if (veniceModels.length === 0) {
    console.warn("Venice.ai extension: No models available. Check your API key or internet connection.");
    return;
  }

  // Map to pi model format
  const piModels = veniceModels.map(mapVeniceModel);

  // Register provider with models
  pi.registerProvider("venice", {
    baseUrl: "https://api.venice.ai/api/v1",
    apiKey: "VENICE_API_KEY",
    api: "openai-completions",
    models: piModels,
  });

  console.log(`Venice.ai: Registered all ${piModels.length} available models (no family filtering)`);
}
