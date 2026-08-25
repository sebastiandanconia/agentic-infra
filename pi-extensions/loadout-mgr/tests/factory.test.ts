import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import factory from "../index";
import {
  makeSkillDir,
  makeLoadoutFile,
  loadoutPath,
  sectionRoot,
} from "./fixtures";

// The factory reads global settings via getAgentDir(), which honors
// PI_CODING_AGENT_DIR; project settings via <cwd>/.pi/settings.json; and ~ via
// HOME. We point all three at temp directories so the wiring test is hermetic.

interface CapturedHandler {
  (event: { type: "resources_discover"; cwd: string; reason: "startup" | "reload" }, ctx: any):
    Promise<{ skillPaths?: string[] } | void> | { skillPaths?: string[] } | void;
}

function createMockPi(trusted: boolean) {
  let handler: CapturedHandler | null = null;
  const on = vi.fn((event: string, h: CapturedHandler) => {
    if (event === "resources_discover") handler = h;
  });
  const pi = { on } as any;
  const invoke = async (cwd: string) => {
    if (!handler) throw new Error("resources_discover handler not registered");
    const ctx = {
      ui: { notify: vi.fn() },
      cwd,
      isProjectTrusted: () => trusted,
    };
    const result = await handler(
      { type: "resources_discover", cwd, reason: "startup" },
      ctx,
    );
    return { result, ctx };
  };
  return { pi, invoke };
}

describe("loadout-mgr factory", () => {
  let tmpRoot: string;
  let agentDir: string;
  let homeDir: string;
  let projectDir: string;
  const origAgentDir = process.env.PI_CODING_AGENT_DIR;
  const origHome = process.env.HOME;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-factory-"));
    agentDir = path.join(tmpRoot, "agent");
    homeDir = path.join(tmpRoot, "home");
    projectDir = path.join(tmpRoot, "project");
    fs.mkdirSync(agentDir, { recursive: true });
    fs.mkdirSync(homeDir, { recursive: true });
    fs.mkdirSync(projectDir, { recursive: true });
    process.env.PI_CODING_AGENT_DIR = agentDir;
    process.env.HOME = homeDir;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
    if (origAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = origAgentDir;
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
  });

  function writeGlobalSettings(loadouts: string[]) {
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ loadouts }),
    );
  }

  function writeProjectSettings(loadouts: string[]) {
    const piDir = path.join(projectDir, ".pi");
    fs.mkdirSync(piDir, { recursive: true });
    fs.writeFileSync(
      path.join(piDir, "settings.json"),
      JSON.stringify({ loadouts }),
    );
  }

  it("registers a resources_discover handler", () => {
    const { pi, invoke: _invoke } = createMockPi(true);
    void _invoke;
    factory(pi);
    // The mock captures the handler in `on`; reaching invoke means it was set.
    expect((pi.on as any)).toHaveBeenCalledWith(
      "resources_discover",
      expect.any(Function),
    );
  });

  it("resolves a loadout referenced by absolute path from global settings", async () => {
    const { pi, invoke } = createMockPi(true);
    // Skills tree lives under homeDir so the absolute path is stable.
    makeSkillDir(homeDir, "skills", "commits");
    makeLoadoutFile(homeDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    const { result, ctx } = await invoke(projectDir);

    expect(result?.skillPaths).toEqual([
      `${sectionRoot(homeDir, "skills")}/commits`,
    ]);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("expands ~ in a loadout path relative to HOME", async () => {
    const { pi, invoke } = createMockPi(true);
    makeSkillDir(homeDir, "skills", "commits");
    makeLoadoutFile(homeDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings(["~/agents/loadouts/ds.toml"]);

    factory(pi);
    const { result } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([
      `${sectionRoot(homeDir, "skills")}/commits`,
    ]);
  });

  it("resolves a relative loadout path against the global settings directory", async () => {
    const { pi, invoke } = createMockPi(true);
    // Place a loadout tree inside the agent dir so a relative path resolves.
    makeSkillDir(agentDir, "skills", "commits");
    fs.mkdirSync(path.join(agentDir, "agents", "loadouts"), { recursive: true });
    makeLoadoutFile(agentDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings(["agents/loadouts/ds.toml"]);

    factory(pi);
    const { result } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([
      `${sectionRoot(agentDir, "skills")}/commits`,
    ]);
  });

  it("reads project settings only when the project is trusted", async () => {
    // Project-only loadout; untrusted run should contribute nothing.
    makeSkillDir(projectDir, "skills", "commits");
    makeLoadoutFile(projectDir, "ds", `skills = ["commits"]`);
    writeProjectSettings([loadoutPath(projectDir, "ds")]);

    const { pi, invoke } = createMockPi(false);
    factory(pi);
    const { result } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([]);
  });

  it("resolves a loadout from trusted project settings", async () => {
    makeSkillDir(projectDir, "skills", "commits");
    makeLoadoutFile(projectDir, "ds", `skills = ["commits"]`);
    writeProjectSettings([loadoutPath(projectDir, "ds")]);

    const { pi, invoke } = createMockPi(true);
    factory(pi);
    const { result } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([
      `${sectionRoot(projectDir, "skills")}/commits`,
    ]);
  });

  it("deduplicates skill paths contributed by both global and project settings", async () => {
    makeSkillDir(homeDir, "skills", "commits");
    makeLoadoutFile(homeDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    makeSkillDir(projectDir, "skills", "commits");
    makeLoadoutFile(projectDir, "ds", `skills = ["commits"]`);
    writeProjectSettings([loadoutPath(projectDir, "ds")]);

    const { pi, invoke } = createMockPi(true);
    factory(pi);
    const { result } = await invoke(projectDir);
    // Two distinct directories (home vs project), so both appear, but neither
    // is listed twice within its own scope.
    expect(result?.skillPaths).toEqual([
      `${sectionRoot(homeDir, "skills")}/commits`,
      `${sectionRoot(projectDir, "skills")}/commits`,
    ]);
  });

  it("warns via ctx.ui.notify when a referenced loadout file is missing", async () => {
    const { pi, invoke } = createMockPi(true);
    writeGlobalSettings(["/does/not/exist.toml"]);

    factory(pi);
    const { ctx } = await invoke(projectDir);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("loadout file not found"),
      "warning",
    );
  });

  it("warns when a settings file is unreadable JSON but still returns", async () => {
    const { pi, invoke } = createMockPi(true);
    fs.writeFileSync(path.join(agentDir, "settings.json"), "{not json");
    factory(pi);
    const { result, ctx } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([]);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("could not read settings"),
      "warning",
    );
  });

  it("treats a settings file with no loadouts key as a no-op", async () => {
    const { pi, invoke } = createMockPi(true);
    fs.writeFileSync(
      path.join(agentDir, "settings.json"),
      JSON.stringify({ defaultModel: "x" }),
    );
    factory(pi);
    const { result, ctx } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([]);
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("warns and skips non-string entries in the loadouts array", async () => {
    const { pi, invoke } = createMockPi(true);
    makeSkillDir(homeDir, "skills", "commits");
    makeLoadoutFile(homeDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings([42, loadoutPath(homeDir, "ds")] as any);

    factory(pi);
    const { result, ctx } = await invoke(projectDir);
    expect(result?.skillPaths).toEqual([
      `${sectionRoot(homeDir, "skills")}/commits`,
    ]);
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("dropped 1 non-string loadouts entry"),
      "warning",
    );
  });
});
