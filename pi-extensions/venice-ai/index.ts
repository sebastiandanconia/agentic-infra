import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  fetchVeniceModels,
  mapVeniceModel,
  supportsFunctionCalling,
  DEFAULT_CACHE_FILE,
} from "./lib";
import type { VeniceModel } from "./lib";

export default async function (pi: ExtensionAPI) {
  // Get API key from environment.
  const apiKey = process.env.VENICE_API_KEY;
  let piModels: any[] = [];
  let veniceModels: VeniceModel[] = [];

  if (apiKey) {
    // Fetch models from Venice.ai (will use cache if available).
    veniceModels = await fetchVeniceModels(apiKey, true, DEFAULT_CACHE_FILE);

    if (veniceModels.length > 0) {
      // Map to pi model format.
      piModels = veniceModels
        .filter(supportsFunctionCalling)
        .map(mapVeniceModel);
    }
  }

  // Register provider with models.
  pi.registerProvider("venice", {
    baseUrl: "https://api.venice.ai/api/v1",
    apiKey: apiKey || "VENICE_API_KEY",
    api: "openai-completions",
    models: piModels,
  });

  // Notify the user of configuration issues on session start.
  pi.on("session_start", async (_event, ctx) => {
    if (!apiKey) {
      ctx.ui.notify(
        "Venice.ai extension: VENICE_API_KEY not set. Models will not be available.",
        "warning",
      );
    } else if (piModels.length === 0) {
      ctx.ui.notify(
        "Venice.ai extension: No models available. Check your API key or connection.",
        "warning",
      );
    }
  });
}
