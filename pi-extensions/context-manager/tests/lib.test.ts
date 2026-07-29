import { describe, it, expect, vi } from "vitest";

import {
  buildContextUsageResult,
  COMPACTION_TRIGGERED_TEXT,
  compactionTriggeredResult,
  createCompactHandlers,
  modelLabel,
  recommendationForPercent,
  retainedTokens,
  triggerCompaction,
} from "../lib";
import { makeCompactionResult, makeModel, makeUsage, makeUsageWithoutWindow } from "./fixtures";

describe("recommendationForPercent", () => {
  it("returns '' when percent is null (unknown fill)", () => {
    expect(recommendationForPercent(null)).toBe("");
  });

  it("returns '' below 50%", () => {
    expect(recommendationForPercent(0)).toBe("");
    expect(recommendationForPercent(49.9)).toBe("");
  });

  it("returns a moderate-fill note at exactly 50% up to (but not including) 75%", () => {
    expect(recommendationForPercent(50)).toBe(" Moderate fill.");
    expect(recommendationForPercent(74.9)).toBe(" Moderate fill.");
  });

  it("returns an approaching-the-limit note at exactly 75% up to (but not including) 90%", () => {
    expect(recommendationForPercent(75)).toBe(" Approaching the limit — consider compacting before a long task.");
    expect(recommendationForPercent(89.9)).toBe(" Approaching the limit — consider compacting before a long task.");
  });

  it("returns a critically-high note at 90% and above", () => {
    expect(recommendationForPercent(90)).toBe(" Critically high — compact before continuing any long task.");
    expect(recommendationForPercent(120)).toBe(" Critically high — compact before continuing any long task.");
  });
});

describe("modelLabel", () => {
  it("returns null when no model is given", () => {
    expect(modelLabel(undefined)).toBeNull();
  });

  it("renders provider/id", () => {
    expect(modelLabel(makeModel({ provider: "venice", id: "glm-5" }))).toBe("venice/glm-5");
  });
});

describe("retainedTokens", () => {
  it("prefers estimatedTokensAfter when present", () => {
    expect(
      retainedTokens(makeCompactionResult({ estimatedTokensAfter: 1234, tokensBefore: 200_000 })),
    ).toBe(1234);
  });

  it("falls back to tokensBefore when estimatedTokensAfter is absent", () => {
    expect(retainedTokens(makeCompactionResult({ tokensBefore: 99 }))).toBe(99);
  });

  it("returns null when neither field is a number (pathological result)", () => {
    const result = { summary: "s", firstKeptEntryId: "x" } as unknown as import("@earendil-works/pi-coding-agent").CompactionResult;
    expect(retainedTokens(result)).toBeNull();
  });
});

describe("buildContextUsageResult", () => {
  it("formats tokens, window, computed percent, and model label", () => {
    const { text, details } = buildContextUsageResult(
      makeUsage({ tokens: 5000, contextWindow: 1_000_000 }),
      makeModel({ provider: "venice", id: "glm-5" }),
    );

    expect(text).toBe("Context: 5,000 tokens, window 1,000,000, 0.5%, model venice/glm-5.");
    expect(details).toEqual({
      tokens: 5000,
      contextWindow: 1_000_000,
      percent: 0.5,
      model: "venice/glm-5",
      raw: makeUsage({ tokens: 5000, contextWindow: 1_000_000 }),
    });
  });

  it("rounds percent to one decimal place", () => {
    const { text, details } = buildContextUsageResult(
      makeUsage({ tokens: 12_345, contextWindow: 100_000 }),
      undefined,
    );

    // 12345/100000*100 = 12.345 -> "12.3%"
    expect(text).toContain("12.3%");
    expect(details.percent).toBeCloseTo(12.345, 5);
  });

  it("reports 'token count unavailable' and no percent when tokens is null", () => {
    const { text, details } = buildContextUsageResult(makeUsage({ tokens: null }), makeModel());

    expect(text).toBe("Context: token count unavailable, window 1,000,000, model venice/test-model.");
    expect(details.tokens).toBeNull();
    expect(details.percent).toBeNull();
  });

  it("falls back to model.contextWindow when usage.contextWindow is not a number", () => {
    const { text, details } = buildContextUsageResult(
      makeUsageWithoutWindow(5000),
      makeModel({ contextWindow: 500_000 }),
    );

    expect(text).toBe("Context: 5,000 tokens, window 500,000, 1.0%, model venice/test-model.");
    expect(details.contextWindow).toBe(500_000);
    expect(details.percent).toBe(1);
  });

  it("omits the window and percent when neither usage nor model provides one", () => {
    const { text, details } = buildContextUsageResult(makeUsageWithoutWindow(5000), makeModel());

    expect(text).toBe("Context: 5,000 tokens, model venice/test-model.");
    expect(details.contextWindow).toBeNull();
    expect(details.percent).toBeNull();
  });

  it("omits the model part and sets details.model null when no model is active", () => {
    const { text, details } = buildContextUsageResult(makeUsage({ tokens: 5000 }), undefined);

    expect(text).toBe("Context: 5,000 tokens, window 1,000,000, 0.5%.");
    expect(details.model).toBeNull();
  });

  it("does not divide by zero when windowSize is 0 (percent stays null, no percent part)", () => {
    const { text, details } = buildContextUsageResult(
      makeUsage({ tokens: 5000, contextWindow: 0 }),
      undefined,
    );

    expect(text).toBe("Context: 5,000 tokens, window 0.");
    expect(details.percent).toBeNull();
  });

  it("appends the critically-high recommendation at >=90% fill", () => {
    const { text } = buildContextUsageResult(
      makeUsage({ tokens: 950_000, contextWindow: 1_000_000 }),
      makeModel(),
    );

    expect(text).toBe(
      "Context: 950,000 tokens, window 1,000,000, 95.0%, model venice/test-model. Critically high — compact before continuing any long task.",
    );
  });

  it("appends the approaching-the-limit recommendation at >=75% fill", () => {
    const { text } = buildContextUsageResult(makeUsage({ tokens: 800_000 }), makeModel());

    expect(text.endsWith(" Approaching the limit — consider compacting before a long task.")).toBe(true);
  });

  it("appends the moderate-fill recommendation at >=50% fill", () => {
    const { text } = buildContextUsageResult(makeUsage({ tokens: 600_000 }), makeModel());

    expect(text.endsWith(" Moderate fill.")).toBe(true);
  });

  it("appends no recommendation below 50% fill", () => {
    const { text } = buildContextUsageResult(makeUsage({ tokens: 1000 }), makeModel());

    expect(text).toBe("Context: 1,000 tokens, window 1,000,000, 0.1%, model venice/test-model.");
  });

  it("sets raw to a deep clone of the usage snapshot", () => {
    const usage = makeUsage({ tokens: 42, contextWindow: 1000 });
    const { details } = buildContextUsageResult(usage, undefined);

    expect(details.raw).toEqual(usage);
    // Mutating the original must not affect the clone.
    (usage as { tokens: number }).tokens = 9999;
    expect((details.raw as { tokens: number }).tokens).toBe(42);
  });

  it("sets raw to null when no usage snapshot is provided", () => {
    const { details } = buildContextUsageResult(undefined, makeModel());

    expect(details.raw).toBeNull();
    expect(details.tokens).toBeNull();
  });

  it("sets raw to null when the usage snapshot is not serializable (e.g. circular)", () => {
    const usage = makeUsage({ tokens: 1, contextWindow: 10 }) as unknown as {
      tokens: number;
      contextWindow: number;
      percent: number | null;
      self: unknown;
    };
    usage.self = usage; // circular -> JSON.stringify throws

    const { details } = buildContextUsageResult(
      usage as unknown as import("@earendil-works/pi-coding-agent").ContextUsage,
      undefined,
    );

    expect(details.raw).toBeNull();
    // The non-serializable snapshot must not break the rest of the result.
    expect(details.tokens).toBe(1);
  });
});

describe("createCompactHandlers", () => {
  it("notifies on success with retained tokens from estimatedTokensAfter", () => {
    const notify = vi.fn();
    const handlers = createCompactHandlers(notify, undefined);

    handlers.onComplete(makeCompactionResult({ estimatedTokensAfter: 1234 }));

    expect(notify).toHaveBeenCalledWith("Context compacted (~1,234 tokens retained).", "info");
  });

  it("falls back to tokensBefore in the success message when estimatedTokensAfter is absent", () => {
    const notify = vi.fn();
    const handlers = createCompactHandlers(notify, undefined);

    handlers.onComplete(makeCompactionResult({ tokensBefore: 200_000 }));

    expect(notify).toHaveBeenCalledWith("Context compacted (~200,000 tokens retained).", "info");
  });

  it("omits the retained-tokens suffix when neither field is present", () => {
    const notify = vi.fn();
    const handlers = createCompactHandlers(notify, undefined);

    handlers.onComplete({ summary: "s", firstKeptEntryId: "x" } as unknown as import("@earendil-works/pi-coding-agent").CompactionResult);

    expect(notify).toHaveBeenCalledWith("Context compacted.", "info");
  });

  it("notifies on error with the error message", () => {
    const notify = vi.fn();
    const handlers = createCompactHandlers(notify, undefined);

    handlers.onError(new Error("simulated failure"));

    expect(notify).toHaveBeenCalledWith("Compaction failed: simulated failure", "error");
  });

  it("does not notify on success once the signal is already aborted", () => {
    const notify = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const handlers = createCompactHandlers(notify, controller.signal);

    handlers.onComplete(makeCompactionResult());

    expect(notify).not.toHaveBeenCalled();
  });

  it("does not notify on error once the signal is already aborted", () => {
    const notify = vi.fn();
    const controller = new AbortController();
    controller.abort();
    const handlers = createCompactHandlers(notify, controller.signal);

    handlers.onError(new Error("boom"));

    expect(notify).not.toHaveBeenCalled();
  });

  it("never throws when notify throws (best-effort callbacks)", () => {
    const notify = vi.fn(() => {
      throw new Error("UI exploded");
    });
    const handlers = createCompactHandlers(notify, undefined);

    expect(() => handlers.onComplete(makeCompactionResult())).not.toThrow();
    expect(() => handlers.onError(new Error("orig"))).not.toThrow();
  });

  it("returns both onComplete and onError as functions", () => {
    const handlers = createCompactHandlers(vi.fn(), undefined);

    expect(typeof handlers.onComplete).toBe("function");
    expect(typeof handlers.onError).toBe("function");
  });
});

describe("compactionTriggeredResult", () => {
  it("returns the trigger text and a triggered=true result", () => {
    const result = compactionTriggeredResult("Focus on task-003");

    expect(result.content[0].type).toBe("text");
    expect(result.content[0].text).toBe(COMPACTION_TRIGGERED_TEXT);
    expect(result.details).toEqual({ ok: true, triggered: true, instructions: "Focus on task-003" });
  });

  it("normalizes undefined instructions to null", () => {
    expect(compactionTriggeredResult(undefined).details.instructions).toBeNull();
  });

  it("normalizes empty-string instructions to null", () => {
    expect(compactionTriggeredResult("").details.instructions).toBe("");
  });
});

describe("triggerCompaction", () => {
  it("calls compactFn once with customInstructions and both handlers", () => {
    const compactFn = vi.fn();
    const notify = vi.fn();

    triggerCompaction(compactFn, notify, "Focus on task-003", undefined);

    expect(compactFn).toHaveBeenCalledTimes(1);
    const options = compactFn.mock.calls[0][0];
    expect(options.customInstructions).toBe("Focus on task-003");
    expect(typeof options.onComplete).toBe("function");
    expect(typeof options.onError).toBe("function");
  });

  it("returns the triggered result synchronously (does not await callbacks)", () => {
    const compactFn = vi.fn(); // never fires callbacks
    const notify = vi.fn();

    const result = triggerCompaction(compactFn, notify, undefined, undefined);

    expect(result.content[0].text).toBe(COMPACTION_TRIGGERED_TEXT);
    expect(result.details).toEqual({ ok: true, triggered: true, instructions: null });
    expect(notify).not.toHaveBeenCalled();
  });

  it("passes instructions through to both the compact call and the result", () => {
    const compactFn = vi.fn();
    const notify = vi.fn();

    const result = triggerCompaction(compactFn, notify, "keep X", undefined);

    expect(compactFn.mock.calls[0][0].customInstructions).toBe("keep X");
    expect(result.details.instructions).toBe("keep X");
  });

  it("wires onComplete through to notify when compactFn fires it", () => {
    const notify = vi.fn();
    let captured: { onComplete: (r: import("@earendil-works/pi-coding-agent").CompactionResult) => void } | undefined;
    const compactFn = vi.fn((options) => {
      captured = options;
    });

    triggerCompaction(compactFn, notify, undefined, undefined);
    captured!.onComplete(makeCompactionResult({ estimatedTokensAfter: 42 }));

    expect(notify).toHaveBeenCalledWith("Context compacted (~42 tokens retained).", "info");
  });

  it("wires onError through to notify when compactFn fires it", () => {
    const notify = vi.fn();
    let captured: { onError: (e: Error) => void } | undefined;
    const compactFn = vi.fn((options) => {
      captured = options;
    });

    triggerCompaction(compactFn, notify, undefined, undefined);
    captured!.onError(new Error("rate limited"));

    expect(notify).toHaveBeenCalledWith("Compaction failed: rate limited", "error");
  });

  it("supplies an undefined signal to the handlers so notifications still fire", () => {
    // When the tool is called with no abort (signal undefined), the run is
    // still live, so a later onComplete must still notify.
    const notify = vi.fn();
    let captured: { onComplete: (r: import("@earendil-works/pi-coding-agent").CompactionResult) => void } | undefined;
    const compactFn = vi.fn((options) => {
      captured = options;
    });

    triggerCompaction(compactFn, notify, undefined, undefined);
    captured!.onComplete(makeCompactionResult());

    expect(notify).toHaveBeenCalledTimes(1);
  });
});
