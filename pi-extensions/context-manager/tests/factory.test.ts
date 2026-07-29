import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

import factory from "../index";
import type { ModelLike } from "../lib";
import { COMPACTION_TRIGGERED_TEXT } from "../lib";
import { makeCompactionResult, makeModel, makeUsage } from "./fixtures";

interface CapturedTool {
  definition: ReturnType<typeof vi.fn> extends never ? never : any;
  name: string;
  execute: (toolCallId: string, params: any, signal: AbortSignal | undefined, onUpdate: any, ctx: any) => Promise<any>;
  parameters: any;
}

interface MockPi {
  pi: ExtensionAPI;
  tools: Map<string, CapturedTool>;
}

function createMockPi(): MockPi {
  const tools = new Map<string, CapturedTool>();
  const pi = {
    registerTool: (definition: any) => {
      tools.set(definition.name, { definition, name: definition.name, execute: definition.execute, parameters: definition.parameters });
    },
  } as unknown as ExtensionAPI;
  return { pi, tools };
}

interface MockCtxOptions {
  usage?: ReturnType<typeof makeUsage>;
  model?: ModelLike;
  compact?: ReturnType<typeof vi.fn>;
}

function createMockCtx(options: MockCtxOptions = {}) {
  return {
    getContextUsage: vi.fn(() => options.usage ?? makeUsage({ tokens: 5000, contextWindow: 1_000_000 })),
    model: options.model ?? makeModel({ provider: "venice", id: "test-model" }),
    compact: options.compact ?? vi.fn(),
    ui: { notify: vi.fn() },
  };
}

describe("extension factory", () => {
  let mock: MockPi;

  beforeEach(() => {
    mock = createMockPi();
  });

  it("registers exactly context_usage and compact_context", () => {
    factory(mock.pi);

    expect([...mock.tools.keys()].sort()).toEqual(["compact_context", "context_usage"]);
  });

  it("gives compact_context an object schema with optional instructions and context_usage an empty object schema", () => {
    factory(mock.pi);

    const usageParams = mock.tools.get("context_usage")!.parameters;
    const compactParams = mock.tools.get("compact_context")!.parameters;

    expect(usageParams.type).toBe("object");
    expect(usageParams.properties?.instructions).toBeUndefined();

    expect(compactParams.type).toBe("object");
    expect(compactParams.properties?.instructions).toBeDefined();
  });

  describe("context_usage tool", () => {
    it("returns the formatted context report built from ctx.getContextUsage() and ctx.model", async () => {
      factory(mock.pi);
      const ctx = createMockCtx({
        usage: makeUsage({ tokens: 12_345, contextWindow: 100_000 }),
        model: makeModel({ provider: "venice", id: "glm-5" }),
      });

      const result = await mock.tools.get("context_usage")!.execute("c1", {}, undefined, undefined, ctx);

      expect(ctx.getContextUsage).toHaveBeenCalledTimes(1);
      expect(result.content[0].type).toBe("text");
      expect(result.content[0].text).toBe("Context: 12,345 tokens, window 100,000, 12.3%, model venice/glm-5.");
      expect(result.details.tokens).toBe(12_345);
      expect(result.details.percent).toBeCloseTo(12.345, 5);
      expect(result.details.model).toBe("venice/glm-5");
    });

    it("includes a critically-high recommendation when fill is >=90%", async () => {
      factory(mock.pi);
      const ctx = createMockCtx({
        usage: makeUsage({ tokens: 950_000, contextWindow: 1_000_000 }),
      });

      const result = await mock.tools.get("context_usage")!.execute("c1", {}, undefined, undefined, ctx);

      expect(result.content[0].text).toContain("Critically high — compact before continuing any long task.");
    });
  });

  describe("compact_context tool", () => {
    it("is fire-and-forget: resolves immediately even when ctx.compact never fires callbacks", async () => {
      // Regression for the re-entrant abort deadlock: pi's compact() starts
      // with `await abort()` of the current agent operation, which IS this
      // tool's own execution; abort() awaits waitForIdle() which awaits the
      // run which awaits this tool's promise. If execute only resolved inside
      // onComplete/onError (which fire only after compact() returns), the
      // awaits would cycle and the tool would hang forever — exactly the bug
      // that left a session stuck on a compact_context call for ~32h. Here
      // ctx.compact records options and never fires, simulating that blocked
      // state; execute must still resolve.
      factory(mock.pi);
      const ctx = createMockCtx({ compact: vi.fn() });

      const result = await Promise.race([
        mock.tools.get("compact_context")!.execute("c1", { instructions: "Focus on task-003" }, undefined, undefined, ctx),
        new Promise((_, reject) => setTimeout(() => reject(new Error("HANG: execute() did not resolve within 3s")), 3000)),
      ]);

      expect(ctx.compact).toHaveBeenCalledTimes(1);
      expect(ctx.compact.mock.calls[0][0].customInstructions).toBe("Focus on task-003");
      expect(result.content[0].text).toBe(COMPACTION_TRIGGERED_TEXT);
      expect(result.details).toEqual({ ok: true, triggered: true, instructions: "Focus on task-003" });
    });

    it("does not await ctx.compact's callbacks: resolves long before a scheduled onComplete fires", async () => {
      // A compact that schedules onComplete 10s out must not delay the tool.
      factory(mock.pi);
      const ctx = createMockCtx({
        compact: vi.fn((options: any) => {
          setTimeout(() => options.onComplete?.(makeCompactionResult()), 10_000);
        }),
      });

      const start = Date.now();
      const result = await Promise.race([
        mock.tools.get("compact_context")!.execute("c1", {}, undefined, undefined, ctx),
        new Promise((_, reject) => setTimeout(() => reject(new Error("HANG")), 3000)),
      ]);
      const elapsed = Date.now() - start;

      expect(result.details.triggered).toBe(true);
      expect(elapsed).toBeLessThan(1000);
    });

    it("normalizes undefined instructions to null in the result and passes undefined to ctx.compact", async () => {
      factory(mock.pi);
      const ctx = createMockCtx({ compact: vi.fn() });

      const result = await mock.tools.get("compact_context")!.execute("c1", {}, undefined, undefined, ctx);

      expect(result.details.instructions).toBeNull();
      expect(ctx.compact.mock.calls[0][0].customInstructions).toBeUndefined();
    });

    it("passes provided instructions through to ctx.compact and the result", async () => {
      factory(mock.pi);
      const ctx = createMockCtx({ compact: vi.fn() });

      const result = await mock.tools
        .get("compact_context")!
        .execute("c1", { instructions: "Focus on the electrical-system state" }, undefined, undefined, ctx);

      expect(ctx.compact.mock.calls[0][0].customInstructions).toBe("Focus on the electrical-system state");
      expect(result.details.instructions).toBe("Focus on the electrical-system state");
    });

    it("wires ctx.compact's onComplete to ctx.ui.notify (success path)", async () => {
      factory(mock.pi);
      let captured: any;
      const ctx = createMockCtx({
        compact: vi.fn((options: any) => {
          captured = options;
        }),
      });

      await mock.tools.get("compact_context")!.execute("c1", {}, undefined, undefined, ctx);
      captured.onComplete(makeCompactionResult({ estimatedTokensAfter: 777 }));

      expect(ctx.ui.notify).toHaveBeenCalledWith("Context compacted (~777 tokens retained).", "info");
    });

    it("wires ctx.compact's onError to ctx.ui.notify (failure path)", async () => {
      factory(mock.pi);
      let captured: any;
      const ctx = createMockCtx({
        compact: vi.fn((options: any) => {
          captured = options;
        }),
      });

      await mock.tools.get("compact_context")!.execute("c1", {}, undefined, undefined, ctx);
      captured.onError(new Error("rate limited"));

      expect(ctx.ui.notify).toHaveBeenCalledWith("Compaction failed: rate limited", "error");
    });

    it("suppresses the success notification when the run signal is already aborted", async () => {
      factory(mock.pi);
      let captured: any;
      const ctx = createMockCtx({
        compact: vi.fn((options: any) => {
          captured = options;
        }),
      });
      const controller = new AbortController();
      controller.abort();

      await mock.tools.get("compact_context")!.execute("c1", {}, controller.signal, undefined, ctx);
      captured.onComplete(makeCompactionResult());

      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });

    it("suppresses the failure notification when the run signal is already aborted", async () => {
      factory(mock.pi);
      let captured: any;
      const ctx = createMockCtx({
        compact: vi.fn((options: any) => {
          captured = options;
        }),
      });
      const controller = new AbortController();
      controller.abort();

      await mock.tools.get("compact_context")!.execute("c1", {}, controller.signal, undefined, ctx);
      captured.onError(new Error("boom"));

      expect(ctx.ui.notify).not.toHaveBeenCalled();
    });
  });
});
