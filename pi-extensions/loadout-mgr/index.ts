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

export default function loadoutMgr(pi: ExtensionAPI) {
  pi.on("resources_discover", async (event, ctx) => {
    const home = process.env.HOME ?? process.cwd();
    const warnings: string[] = [];
    const skillPaths: string[] = [];
    const seen = new Set<string>();

    // Global settings first, then project settings. Project entries are only
    // read once the project is trusted, matching how pi gates .pi resources.
    const settingsFiles = [path.join(getAgentDir(), "settings.json")];
    if (ctx.isProjectTrusted()) {
      settingsFiles.push(path.join(event.cwd, CONFIG_DIR_NAME, "settings.json"));
    }

    for (const settingsFile of settingsFiles) {
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
          if (!seen.has(skillPath)) {
            seen.add(skillPath);
            skillPaths.push(skillPath);
          }
        }
      }
    }

    for (const w of warnings) {
      ctx.ui.notify(`loadout-mgr: ${w}`, "warning");
    }

    return { skillPaths };
  });
}
