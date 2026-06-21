import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

import {
  mapVeniceModel,
  loadCachedModels,
  saveCachedModels,
  fetchVeniceModels,
  CACHE_TTL_MS,
  FETCH_TIMEOUT_MS,
} from "../lib";
import { makeModel } from "./fixtures";

describe("mapVeniceModel", () => {
  it("maps a vision-capable model to text+image inputs", () => {
    const mapped = mapVeniceModel(makeModel({ supportsVision: true }));
    expect(mapped.input).toEqual(["text", "image"]);
  });

  it("maps a text-only model to text-only input", () => {
    const mapped = mapVeniceModel(makeModel({ supportsVision: false }));
    expect(mapped.input).toEqual(["text"]);
  });

  it("defaults cache read/write cost to 0 when pricing is absent", () => {
    const mapped = mapVeniceModel(makeModel());
    expect(mapped.cost.cacheRead).toBe(0);
    expect(mapped.cost.cacheWrite).toBe(0);
  });

  it("carries through cache pricing when present", () => {
    const mapped = mapVeniceModel(
      makeModel({ cacheInputUsd: 0.0005, cacheWriteUsd: 0.001 }),
    );
    expect(mapped.cost.cacheRead).toBe(0.0005);
    expect(mapped.cost.cacheWrite).toBe(0.001);
  });

  it("carries through input and output pricing", () => {
    const mapped = mapVeniceModel(makeModel({ inputUsd: 1.5, outputUsd: 3 }));
    expect(mapped.cost.input).toBe(1.5);
    expect(mapped.cost.output).toBe(3);
  });

  it("sets reasoning true when the model supports reasoning", () => {
    expect(mapVeniceModel(makeModel({ supportsReasoning: true })).reasoning).toBe(true);
  });

  it("sets reasoning false when the model does not support reasoning", () => {
    expect(mapVeniceModel(makeModel({ supportsReasoning: false })).reasoning).toBe(false);
  });

  it("mirrors supportsReasoningEffort into compat", () => {
    expect(
      mapVeniceModel(makeModel({ supportsReasoningEffort: true })).compat
        .supportsReasoningEffort,
    ).toBe(true);
    expect(
      mapVeniceModel(makeModel({ supportsReasoningEffort: false })).compat
        .supportsReasoningEffort,
    ).toBe(false);
  });

  it("always sets supportsDeveloperRole true and supportsLongCacheRetention false", () => {
    const mapped = mapVeniceModel(makeModel());
    expect(mapped.compat.supportsDeveloperRole).toBe(true);
    expect(mapped.compat.supportsLongCacheRetention).toBe(false);
  });

  it("carries context window, max tokens, id, and display name through", () => {
    const mapped = mapVeniceModel(
      makeModel({
        id: "venice-pro",
        name: "Venice Pro",
        contextTokens: 200_000,
        maxCompletion: 16_384,
      }),
    );
    expect(mapped.id).toBe("venice-pro");
    expect(mapped.name).toBe("Venice Pro");
    expect(mapped.contextWindow).toBe(200_000);
    expect(mapped.maxTokens).toBe(16_384);
  });
});

describe("loadCachedModels", () => {
  let tmpDir: string;
  let cacheFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "venice-cache-"));
    cacheFile = path.join(tmpDir, "cache.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns null when the cache file does not exist", () => {
    expect(loadCachedModels(path.join(tmpDir, "nope.json"))).toBeNull();
  });

  it("returns the cached models within the TTL window", () => {
    const models = [makeModel({ id: "x" })];
    saveCachedModels(models, cacheFile, 1_000);
    // age = (1000 + TTL - 1) - 1000 = TTL - 1, still fresh.
    expect(loadCachedModels(cacheFile, 1_000 + CACHE_TTL_MS - 1)).toEqual(models);
  });

  it("returns null once the cache age reaches the TTL", () => {
    const models = [makeModel({ id: "x" })];
    saveCachedModels(models, cacheFile, 1_000);
    // age = TTL exactly, not < TTL, so expired.
    expect(loadCachedModels(cacheFile, 1_000 + CACHE_TTL_MS)).toBeNull();
  });

  it("returns null when the cache file contains corrupt JSON", () => {
    fs.writeFileSync(cacheFile, "{not valid json");
    expect(loadCachedModels(cacheFile)).toBeNull();
  });
});

describe("saveCachedModels", () => {
  let tmpDir: string;
  let cacheFile: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "venice-save-"));
    cacheFile = path.join(tmpDir, "cache.json");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("round-trips models through save then load", () => {
    const models = [makeModel({ id: "rt" }), makeModel({ id: "rt2" })];
    saveCachedModels(models, cacheFile, 5_000);
    expect(loadCachedModels(cacheFile, 5_000)).toEqual(models);
  });

  it("writes the supplied now value as the cache timestamp", () => {
    saveCachedModels([makeModel({ id: "t" })], cacheFile, 42_000);
    const written = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    expect(written.timestamp).toBe(42_000);
  });

  it("swallows write failures silently when the cache path is not writable", () => {
    const badPath = path.join(tmpDir, "does-not-exist", "cache.json");
    expect(() => saveCachedModels([makeModel()], badPath, 1)).not.toThrow();
    expect(fs.existsSync(badPath)).toBe(false);
  });
});

describe("fetchVeniceModels", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "venice-fetch-"));
    vi.unstubAllGlobals();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("returns models from the network and persists them to the cache on success", async () => {
    const models = [makeModel({ id: "a" }), makeModel({ id: "b" })];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: models }),
      }),
    );
    const cacheFile = path.join(tmpDir, "success.json");

    const result = await fetchVeniceModels("key", false, cacheFile);

    expect(result).toEqual(models);
    const written = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    expect(written.models).toEqual(models);
    expect(typeof written.timestamp).toBe("number");
  });

  it("returns an empty array and does not write the cache when the response is not ok", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 401, json: async () => ({}) }),
    );
    const cacheFile = path.join(tmpDir, "notok.json");

    const result = await fetchVeniceModels("key", false, cacheFile);

    expect(result).toEqual([]);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("returns an empty array and does not write the cache when fetch rejects", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    const cacheFile = path.join(tmpDir, "err.json");

    const result = await fetchVeniceModels("key", false, cacheFile);

    expect(result).toEqual([]);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("aborts the request and returns an empty array when the fetch exceeds the timeout", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "Date"],
    });
    let aborted = false;
    vi.stubGlobal(
      "fetch",
      vi.fn((_url, init) =>
        new Promise((_resolve, reject) => {
          (init as any).signal.addEventListener("abort", () => {
            aborted = true;
            reject(new Error("aborted"));
          });
        }),
      ),
    );
    const cacheFile = path.join(tmpDir, "timeout.json");

    const promise = fetchVeniceModels("key", false, cacheFile);
    await vi.advanceTimersByTimeAsync(FETCH_TIMEOUT_MS);
    const result = await promise;

    expect(result).toEqual([]);
    expect(aborted).toBe(true);
    expect(fs.existsSync(cacheFile)).toBe(false);
  });

  it("falls through to the network and caches the result when useCache is true but the cache is empty", async () => {
    const models = [makeModel({ id: "miss" })];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ data: models }),
      }),
    );
    const cacheFile = path.join(tmpDir, "miss.json");

    const result = await fetchVeniceModels("key", true, cacheFile);

    expect(result).toEqual(models);
    expect(fetch).toHaveBeenCalledTimes(1);
    const written = JSON.parse(fs.readFileSync(cacheFile, "utf-8"));
    expect(written.models).toEqual(models);
  });

  it("returns cached models immediately and re-fetches in the background on a cache hit", async () => {
    vi.useFakeTimers({
      toFake: ["setTimeout", "clearTimeout", "setImmediate", "clearImmediate", "Date"],
    });
    const cacheFile = path.join(tmpDir, "bg.json");
    const cached = [makeModel({ id: "cached-one" })];
    // Save with the fake clock's now so the cache is fresh when read.
    saveCachedModels(cached, cacheFile);

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ data: [makeModel({ id: "fresh-one" })] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchVeniceModels("key", true, cacheFile);

    // Cache hit: immediate return, no network call yet.
    expect(result).toEqual(cached);
    expect(fetchMock).not.toHaveBeenCalled();

    // Flush the setImmediate-scheduled background re-fetch.
    await vi.runAllTimersAsync();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
