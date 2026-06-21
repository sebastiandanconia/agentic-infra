import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import { makeModel } from "./fixtures";

// Partially mock lib so the factory's network call is controllable while the
// real mapVeniceModel still runs (so we can assert the mapped provider shape).
vi.mock("../lib", async (importOriginal) => {
  const actual = (await importOriginal()) as typeof import("../lib");
  return { ...actual, fetchVeniceModels: vi.fn() };
});

import factory from "../index";
import { fetchVeniceModels } from "../lib";

const VENICE_URL = "https://api.venice.ai/api/v1";

interface MockPi {
  pi: ExtensionAPI;
  registerProvider: ReturnType<typeof vi.fn>;
  on: ReturnType<typeof vi.fn>;
  handlers: Record<string, (event: any, ctx: any) => unknown>;
}

function createMockPi(): MockPi {
  const handlers: Record<string, (event: any, ctx: any) => unknown> = {};
  const registerProvider = vi.fn();
  const on = vi.fn((event: string, handler: any) => {
    handlers[event] = handler;
  });
  const pi = { registerProvider, on } as unknown as ExtensionAPI;
  return { pi, registerProvider, on, handlers };
}

function createMockCtx() {
  return { ui: { notify: vi.fn() } } as any;
}

describe("extension factory", () => {
  const originalKey = process.env.VENICE_API_KEY;

  beforeEach(() => {
    vi.resetAllMocks();
    delete process.env.VENICE_API_KEY;
  });

  afterEach(() => {
    delete process.env.VENICE_API_KEY;
    if (originalKey !== undefined) process.env.VENICE_API_KEY = originalKey;
  });

  it("registers the venice provider with the default API key placeholder and no models when VENICE_API_KEY is unset", async () => {
    const { pi, registerProvider } = createMockPi();
    await factory(pi);

    expect(registerProvider).toHaveBeenCalledWith(
      "venice",
      expect.objectContaining({
        baseUrl: VENICE_URL,
        api: "openai-completions",
        apiKey: "VENICE_API_KEY",
        models: [],
      }),
    );
  });

  it("does not call the network when VENICE_API_KEY is unset", async () => {
    const { pi } = createMockPi();
    await factory(pi);

    expect(fetchVeniceModels).not.toHaveBeenCalled();
  });

  it("notifies the user that the API key is missing on session_start when the key is unset", async () => {
    const { pi, handlers } = createMockPi();
    await factory(pi);

    const ctx = createMockCtx();
    await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("VENICE_API_KEY not set"),
      "warning",
    );
  });

  it("registers an empty model list and notifies about missing models on session_start when the key is set but no models come back", async () => {
    process.env.VENICE_API_KEY = "test-key";
    (fetchVeniceModels as any).mockResolvedValue([]);

    const { pi, registerProvider, handlers } = createMockPi();
    await factory(pi);

    expect(registerProvider).toHaveBeenCalledWith(
      "venice",
      expect.objectContaining({ apiKey: "test-key", models: [] }),
    );

    const ctx = createMockCtx();
    await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("No models available"),
      "warning",
    );
  });

  it("registers the mapped models and does not notify on session_start when the key is set and models are available", async () => {
    process.env.VENICE_API_KEY = "test-key";
    (fetchVeniceModels as any).mockResolvedValue([
      makeModel({ id: "a", supportsVision: true }),
      makeModel({ id: "b" }),
    ]);

    const { pi, registerProvider, handlers } = createMockPi();
    await factory(pi);

    const config = registerProvider.mock.calls[0][1];
    expect(config.apiKey).toBe("test-key");
    expect(config.models).toHaveLength(2);
    expect(config.models[0].id).toBe("a");
    expect(config.models[0].input).toEqual(["text", "image"]);
    expect(config.models[1].id).toBe("b");
    expect(config.models[1].input).toEqual(["text"]);

    const ctx = createMockCtx();
    await handlers.session_start({ type: "session_start", reason: "startup" }, ctx);

    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("wires the provider with the venice base URL, openai-completions API, and resolved API key", async () => {
    process.env.VENICE_API_KEY = "wired-key";
    (fetchVeniceModels as any).mockResolvedValue([makeModel()]);

    const { pi, registerProvider } = createMockPi();
    await factory(pi);

    expect(registerProvider).toHaveBeenCalledWith(
      "venice",
      expect.objectContaining({
        baseUrl: VENICE_URL,
        api: "openai-completions",
        apiKey: "wired-key",
      }),
    );
  });
});
