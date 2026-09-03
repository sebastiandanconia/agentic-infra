import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import {
  CONFIG_DIR_NAME,
  getAgentDir,
} from "@earendil-works/pi-coding-agent";
import * as fs from "fs";
import * as path from "path";

import { resolveLoadout, resolveLoadoutPath, type FsOp } from "./lib";

// The real filesystem adapter handed to the testable resolver. Kept here so
// tests can swap it without importing node:fs from lib.
const realFs: FsOp = {
  existsSync: (p) => fs.existsSync(p),
  readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
};

/**
 * Read the `loadouts` array from a settings file. Missing files and JSON
 * errors return an empty list plus a warning rather than throwing.
 */
function readLoadoutPaths(
  settingsFile: string,
  fsop: FsOp,
): { paths: string[]; warnings: string[] } {
  if (!fsop.existsSync(settingsFile)) {
    return { paths: [], warnings: [] };
  }
  try {
    const raw = JSON.parse(fsop.readFileSync(settingsFile, "utf-8"));
    const entries: unknown[] = Array.isArray(raw?.loadouts) ? raw.loadouts : [];
    const paths = entries.filter((p): p is string => typeof p === "string");
    const dropped = entries.length - paths.length;
    const warnings =
      dropped > 0 ? [`dropped ${dropped} non-string loadouts entry in ${settingsFile}`] : [];
    return { paths, warnings };
  } catch (e) {
    return {
      paths: [],
      warnings: [
        `could not read settings ${settingsFile}: ${(e as Error).message}`,
      ],
    };
  }
}

/** Deduplicate a string array, preserving first-seen order. */
function dedupeOrdered(items: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const it of items) {
    if (!seen.has(it)) {
      seen.add(it);
      out.push(it);
    }
  }
  return out;
}

// Cached, per-scope policy fragments already wrapped in the same
// <project_instructions>...</project_instructions> wrapper pi uses for
// AGENTS.md. Read once per resources_discover (startup | reload) — NOT
// re-read per turn — so policies follow AGENTS.md semantics exactly: an edit
// to a fragment between turns has no effect until /reload. The cache is
// consumed by the before_agent_start handler, which re-splices it into the
// (per-turn-reset) system prompt. Global-scope policies (from
// ~/.pi/agent/settings.json) sequence as if they were an AGENTS.md high in
// the tree; project-scope policies (from <cwd>/.pi/settings.json) sequence as
// if they were the AGENTS.md closest to the working directory. See the README
// for the rationale.
let cachedGlobalEntries: string[] = [];
let cachedProjectEntries: string[] = [];

/** Read a policy fragment, returning null (and a warning) if missing or
 *  unreadable so one bad policy never breaks discovery. */
function readPolicyFragment(p: string, warnings: string[]): string | null {
  if (!realFs.existsSync(p)) {
    warnings.push(`policy file not found: ${p}`);
    return null;
  }
  try {
    return realFs.readFileSync(p, "utf-8");
  } catch (e) {
    warnings.push(`could not read policy ${p}: ${(e as Error).message}`);
    return null;
  }
}

/** Wrap a policy fragment in the same <project_instructions> wrapper pi uses
 *  for AGENTS.md entries, so policies are fed to the model through the same
 *  context channel. */
function wrapPolicy(p: string, content: string): string {
  const body = content.replace(/\r\n?/g, "\n").replace(/\n+$/, "");
  return `<project_instructions path="${p}">\n${body}\n</project_instructions>`;
}

export default function loadoutMgr(pi: ExtensionAPI) {
  pi.on("resources_discover", async (event, ctx) => {
    const home = process.env.HOME ?? process.cwd();
    const warnings: string[] = [];
    const skillPaths: string[] = [];
    const seenSkills = new Set<string>();

    // Policy paths gathered per scope, in the order the loadouts are listed in
    // each settings file and, within a loadout, in the order the policies are
    // listed. We do not dedupe across loadouts yet; that happens once both
    // scopes have been collected, so a policy referenced by both a global and
    // a project loadout is emitted once, in its earliest (global) position.
    const globalPolicies: string[] = [];
    const projectPolicies: string[] = [];

    // Global settings first, then project settings. Project entries are only
    // read once the project is trusted, matching how pi gates .pi resources.
    const settingsFiles = [path.join(getAgentDir(), "settings.json")];
    if (ctx.isProjectTrusted()) {
      settingsFiles.push(path.join(event.cwd, CONFIG_DIR_NAME, "settings.json"));
    }

    for (let i = 0; i < settingsFiles.length; i++) {
      const settingsFile = settingsFiles[i];
      const isProjectScope = i > 0;
      const { paths: rawPaths, warnings: fileWarnings } = readLoadoutPaths(
        settingsFile,
        realFs,
      );
      warnings.push(...fileWarnings);

      for (const rawPath of rawPaths) {
        const loadoutFile = resolveLoadoutPath(rawPath, settingsFile, home);
        const result = resolveLoadout(loadoutFile, realFs);
        warnings.push(...result.warnings);
        for (const skillPath of result.skillPaths) {
          if (!seenSkills.has(skillPath)) {
            seenSkills.add(skillPath);
            skillPaths.push(skillPath);
          }
        }
        // Policies keep their within-loadout order; cross-loadout dedupe is
        // applied after both scopes are gathered.
        (isProjectScope ? projectPolicies : globalPolicies).push(
          ...result.policyPaths,
        );
      }
    }

    // Dedupe policy paths. Within each scope, duplicates (e.g. two loadouts
    // in the same settings file naming the same policy) collapse to their
    // first occurrence, preserving the listed order. A policy named by both a
    // global and a project loadout is emitted once, in its global position —
    // mirroring how a higher AGENTS.md is read before a closer one and a
    // closer file does not re-append content already supplied from above.
    const globalPolicyPaths = dedupeOrdered(globalPolicies);
    const projectPolicyPaths = dedupeOrdered(projectPolicies).filter(
      (p) => !globalPolicyPaths.includes(p),
    );

    // Read each policy fragment ONCE, here at discovery time (startup |
    // reload), and cache the wrapped entries. This mirrors pi's own handling
    // of AGENTS.md (read once during load(), cached, not re-read per turn),
    // so editing a fragment mid-session has no effect until /reload — no
    // surprise relative to AGENTS.md. Missing/unreadable fragments warn and
    // are skipped, never breaking discovery.
    cachedGlobalEntries = globalPolicyPaths
      .map((p) => {
        const content = readPolicyFragment(p, warnings);
        return content === null ? null : wrapPolicy(p, content);
      })
      .filter((e): e is string => e !== null);
    cachedProjectEntries = projectPolicyPaths
      .map((p) => {
        const content = readPolicyFragment(p, warnings);
        return content === null ? null : wrapPolicy(p, content);
      })
      .filter((e): e is string => e !== null);

    for (const w of warnings) {
      ctx.ui.notify(`loadout-mgr: ${w}`, "warning");
    }

    return { skillPaths };
  });

  pi.on("before_agent_start", async (event, _ctx) => {
    // Re-splice the cached (discovery-time) policy entries into this turn's
    // system prompt. Pi resets systemPrompt to _baseSystemPrompt each turn
    // when no extension modifies it, so the splice must run every turn to
    // keep policies present — but it operates purely on the cache, with no
    // filesystem reads, so it does not make policies any fresher than
    // AGENTS.md. Edits take effect only at the next /reload.
    if (cachedGlobalEntries.length === 0 && cachedProjectEntries.length === 0) {
      return;
    }

    const agentDir = getAgentDir();
    const newPrompt = injectPolicies(
      event.systemPrompt,
      cachedGlobalEntries,
      cachedProjectEntries,
      agentDir,
    );

    return { systemPrompt: newPrompt };
  });
}

/**
 * Splice policy entries into the system prompt's `<project_context>` block,
 * or append a fresh block when none exists.
 *
 * `globalEntries` are inserted as if they were an AGENTS.md high in the tree:
 * right after the global context file (the entry whose directory is the pi
 * agent dir), or at the head of the block when no global context file is
 * present. `projectEntries` are inserted as if they were the AGENTS.md closest
 * to the working directory: at the end of the block, after every existing
 * entry. The entries reuse pi's `<project_instructions>` wrapper so policies
 * are inferred from in exactly the same way as AGENTS.md content.
 */
function injectPolicies(
  systemPrompt: string,
  globalEntries: string[],
  projectEntries: string[],
  agentDir: string,
): string {
  const blockOpen = "<project_context>";
  const blockClose = "</project_context>";
  const openIdx = systemPrompt.indexOf(blockOpen);
  const closeIdx = systemPrompt.indexOf(blockClose);

  // No existing context block: append a fresh one containing the policy
  // entries in scope order (global first, then project).
  if (openIdx === -1 || closeIdx === -1 || closeIdx < openIdx) {
    const entries = [...globalEntries, ...projectEntries];
    if (entries.length === 0) return systemPrompt;
    const block =
      `\n\n${blockOpen}\n\nProject-specific instructions and guidelines:\n\n` +
      entries.join("\n\n") +
      `\n\n${blockClose}\n`;
    return systemPrompt + block;
  }

  const innerStart = openIdx + blockOpen.length;
  const innerEnd = closeIdx;
  const inner = systemPrompt.slice(innerStart, innerEnd);

  // Split the existing block body into leading prose and the sequence of
  // <project_instructions>...</project_instructions> entries, preserving
  // original formatting.
  const firstEntryMatch = inner.indexOf("<project_instructions ");
  if (firstEntryMatch === -1) {
    // Block present but empty of entries: append entries before the closing
    // tag, after whatever prose is there.
    const prefix = inner;
    const entries = [...globalEntries, ...projectEntries];
    const newInner =
      prefix +
      (prefix.endsWith("\n") ? "" : "\n") +
      entries.join("\n\n") +
      "\n\n";
    return (
      systemPrompt.slice(0, innerStart) +
      newInner +
      systemPrompt.slice(innerEnd)
    );
  }

  const prose = inner.slice(0, firstEntryMatch);
  const entriesRegion = inner.slice(firstEntryMatch);

  // Capture each existing entry as a full <project_instructions ...>...
  // </project_instructions> block, in order.
  const existingEntries: string[] = [];
  let cursor = 0;
  while (cursor < entriesRegion.length) {
    const start = entriesRegion.indexOf("<project_instructions ", cursor);
    if (start === -1) break;
    const endTag = "</project_instructions>";
    const end = entriesRegion.indexOf(endTag, start);
    if (end === -1) break;
    const entryEnd = end + endTag.length;
    existingEntries.push(entriesRegion.slice(start, entryEnd));
    cursor = entryEnd;
  }

  // Locate the global context file's entry (the one whose path is inside the
  // pi agent dir) so global-scope policies are inserted right after it,
  // mirroring where an AGENTS.md near the top of the tree would land.
  const globalEntryIdx = existingEntries.findIndex((entry) => {
    const m = entry.match(/path="([^"]+)"/);
    if (!m) return false;
    try {
      return path.dirname(m[1]) === agentDir;
    } catch {
      return false;
    }
  });

  const merged: string[] = [];
  if (globalEntryIdx === -1) {
    // No global context file present: global-scope policies go first, before
    // any ancestor/project entries.
    merged.push(...globalEntries, ...existingEntries, ...projectEntries);
  } else {
    for (let i = 0; i < existingEntries.length; i++) {
      merged.push(existingEntries[i]);
      if (i === globalEntryIdx) merged.push(...globalEntries);
    }
    merged.push(...projectEntries);
  }

  const newEntriesRegion = merged.join("\n\n") + "\n\n";
  const newInner = prose + newEntriesRegion;
  return (
    systemPrompt.slice(0, innerStart) +
    newInner +
    systemPrompt.slice(innerEnd)
  );
}
