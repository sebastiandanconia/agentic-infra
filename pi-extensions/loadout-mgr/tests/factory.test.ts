import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import factory from "../index";
import {
  makeSkillDir,
  makePolicyFile,
  makeLoadoutFile,
  loadoutPath,
  sectionRoot,
  policyPath,
} from "./fixtures";

// The factory reads global settings via getAgentDir(), which honors
// PI_CODING_AGENT_DIR; project settings via <cwd>/.pi/settings.json; and ~ via
// HOME. We point all three at temp directories so the wiring test is hermetic.

interface CapturedHandler {
  (event: { type: "resources_discover"; cwd: string; reason: "startup" | "reload" }, ctx: any):
    Promise<{ skillPaths?: string[] } | void> | { skillPaths?: string[] } | void;
}
interface CapturedBeforeAgentStartHandler {
  (event: {
    type: "before_agent_start";
    prompt: string;
    images?: unknown[];
    systemPrompt: string;
    systemPromptOptions: { contextFiles?: Array<{ path: string; content: string }> };
  }, ctx: any):
    Promise<{ systemPrompt?: string } | void> | { systemPrompt?: string } | void;
}

function createMockPi(trusted: boolean) {
  let handler: CapturedHandler | null = null;
  let beforeAgentStartHandler: CapturedBeforeAgentStartHandler | null = null;
  const on = vi.fn((event: string, h: CapturedHandler | CapturedBeforeAgentStartHandler) => {
    if (event === "resources_discover") handler = h as CapturedHandler;
    if (event === "before_agent_start")
      beforeAgentStartHandler = h as CapturedBeforeAgentStartHandler;
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
  // Drive the before_agent_start handler with a caller-supplied base system
  // prompt so the policy-injection splice can be asserted without rebuilding
  // pi's full system prompt.
  const invokeAgent = async (
    cwd: string,
    systemPrompt: string,
    contextFiles: Array<{ path: string; content: string }> = [],
  ) => {
    if (!beforeAgentStartHandler)
      throw new Error("before_agent_start handler not registered");
    const ctx = {
      ui: { notify: vi.fn() },
      cwd,
      isProjectTrusted: () => trusted,
    };
    const result = await beforeAgentStartHandler(
      {
        type: "before_agent_start",
        prompt: "",
        systemPrompt,
        systemPromptOptions: { contextFiles },
      },
      ctx,
    );
    return { result, ctx };
  };
  return { pi, invoke, invokeAgent };
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

  // -------------------------------------------------------------------------
  // Policies: concatenation into the system prompt via before_agent_start.
  // The resources_discover handler gathers policy fragment paths per scope;
  // the before_agent_start handler reads them and splices them into the
  // prompt's <project_context> block using the same <project_instructions>
  // wrapper pi uses for AGENTS.md, so policies are inferred from in exactly
  // the same way as AGENTS.md content.
  // -------------------------------------------------------------------------

  it("leaves the system prompt untouched when no policies are configured", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    makeSkillDir(homeDir, "skills", "commits");
    makeLoadoutFile(homeDir, "ds", `skills = ["commits"]`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    await invoke(projectDir);
    const base = "BASE PROMPT";
    const { result } = await invokeAgent(projectDir, base);
    // No systemPrompt returned means pi keeps its base prompt unchanged.
    expect(result?.systemPrompt).toBeUndefined();
  });

  it("appends a fresh <project_context> block when the prompt has none", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    makePolicyFile(homeDir, "secrets", "# Secrets\n\nnever read secrets\n");
    makeLoadoutFile(homeDir, "ds", `policies = ["secrets"]\n`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    await invoke(projectDir);
    const { result } = await invokeAgent(projectDir, "BASE PROMPT");
    const prompt = result?.systemPrompt ?? "";
    expect(prompt).toContain("<project_context>");
    expect(prompt).toContain("</project_context>");
    expect(prompt).toContain(
      `<project_instructions path="${policyPath(homeDir, "secrets")}">`,
    );
    expect(prompt).toContain("never read secrets");
    expect(prompt.startsWith("BASE PROMPT")).toBe(true);
  });

  it("inserts global policies after the global AGENTS.md and project policies at the end", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    // Global-scope loadout supplies the "secrets" policy.
    makePolicyFile(homeDir, "secrets", "# Secrets\n");
    makeLoadoutFile(homeDir, "global", `policies = ["secrets"]\n`);
    writeGlobalSettings([loadoutPath(homeDir, "global")]);
    // Project-scope loadout supplies the "whitespace" policy.
    makePolicyFile(projectDir, "whitespace", "# Whitespace\n");
    makeLoadoutFile(projectDir, "proj", `policies = ["whitespace"]\n`);
    writeProjectSettings([loadoutPath(projectDir, "proj")]);

    factory(pi);
    await invoke(projectDir);

    // A realistic base prompt: a global AGENTS.md (in the agent dir) followed
    // by a project AGENTS.md (in the project dir), as pi would assemble them.
    const globalAgents = path.join(agentDir, "AGENTS.md");
    const projectAgents = path.join(projectDir, "AGENTS.md");
    const base =
      `BASE\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n` +
      `<project_instructions path="${globalAgents}">\nglobal-agents\n</project_instructions>\n\n` +
      `<project_instructions path="${projectAgents}">\nproject-agents\n</project_instructions>\n\n` +
      `</project_context>`;
    const { result } = await invokeAgent(projectDir, base);
    const prompt = result?.systemPrompt ?? "";

    const secretsIdx = prompt.indexOf(
      `<project_instructions path="${policyPath(homeDir, "secrets")}">`,
    );
    const wsIdx = prompt.indexOf(
      `<project_instructions path="${policyPath(projectDir, "whitespace")}">`,
    );
    const globalAgentsIdx = prompt.indexOf(`path="${globalAgents}"`);
    const projectAgentsIdx = prompt.indexOf(`path="${projectAgents}"`);
    const closeIdx = prompt.indexOf("</project_context>");

    // Global policy lands right after the global AGENTS.md, before the
    // project AGENTS.md.
    expect(secretsIdx).toBeGreaterThan(globalAgentsIdx);
    expect(secretsIdx).toBeLessThan(projectAgentsIdx);
    // Project policy lands after the project AGENTS.md and before the block
    // closes (closest-to-cwd AGENTS.md position).
    expect(wsIdx).toBeGreaterThan(projectAgentsIdx);
    expect(wsIdx).toBeLessThan(closeIdx);
  });

  it("warns and skips a missing policy file while still injecting the rest", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    makePolicyFile(homeDir, "secrets", "# Secrets\n");
    // "ghost" policy is referenced but never written.
    makeLoadoutFile(homeDir, "ds", `policies = ["secrets", "ghost"]\n`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    const discoverCtx = (await invoke(projectDir)).ctx;
    // The missing policy is reported during discovery, so it never reaches
    // agent-start as a path to read.
    expect(discoverCtx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("policy not found: ghost"),
      "warning",
    );
    const { result, ctx } = await invokeAgent(projectDir, "BASE");
    const prompt = result?.systemPrompt ?? "";
    expect(prompt).toContain(
      `<project_instructions path="${policyPath(homeDir, "secrets")}">`,
    );
    expect(prompt).not.toContain("ghost");
    // No additional warning at agent-start: secrets reads cleanly.
    expect(ctx.ui.notify).not.toHaveBeenCalled();
  });

  it("warns at agent-start when a policy file disappears after discovery", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    makePolicyFile(homeDir, "secrets", "# Secrets\n");
    makeLoadoutFile(homeDir, "ds", `policies = ["secrets"]\n`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    await invoke(projectDir);
    // Remove the policy file after discovery so agent-start can't read it.
    fs.rmSync(policyPath(homeDir, "secrets"));
    const { result, ctx } = await invokeAgent(projectDir, "BASE");
    // No systemPrompt is returned because no policy entries survived to inject.
    expect(result?.systemPrompt).toBeUndefined();
    expect(ctx.ui.notify).toHaveBeenCalledWith(
      expect.stringContaining("policy file not found"),
      "warning",
    );
  });

  it("fills an empty <project_context> block (prose only, no AGENTS.md entries)", async () => {
    const { pi, invoke, invokeAgent } = createMockPi(true);
    makePolicyFile(homeDir, "secrets", "# Secrets\n");
    makeLoadoutFile(homeDir, "ds", `policies = ["secrets"]\n`);
    writeGlobalSettings([loadoutPath(homeDir, "ds")]);

    factory(pi);
    await invoke(projectDir);
    // A block pi might emit when no AGENTS.md files are present: header prose,
    // no <project_instructions> entries.
    const base =
      "BASE\n\n<project_context>\n\nProject-specific instructions and guidelines:\n\n</project_context>";
    const { result } = await invokeAgent(projectDir, base);
    const prompt = result?.systemPrompt ?? "";
    expect(prompt).toContain("<project_context>");
    expect(prompt).toContain(
      `<project_instructions path="${policyPath(homeDir, "secrets")}">`,
    );
    // The injected entry sits between the prose and the closing tag.
    const entryIdx = prompt.indexOf("<project_instructions ");
    const closeIdx = prompt.indexOf("</project_context>");
    expect(entryIdx).toBeGreaterThan(prompt.indexOf("guidelines:"));
    expect(entryIdx).toBeLessThan(closeIdx);
  });
});
