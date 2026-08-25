import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import type { FsOp } from "../lib";

/**
 * Build an in-memory filesystem backed by a real temp directory. The resolver
 * only needs `existsSync` and `readFileSync`, so this is a thin typed wrapper
 * around node:fs scoped to a temp tree that gets cleaned up per-test.
 */
export function makeTempFs(): {
  root: string;
  fsop: FsOp;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "loadout-mgr-"));
  const fsop: FsOp = {
    existsSync: (p) => fs.existsSync(p),
    readFileSync: (p, encoding) => fs.readFileSync(p, encoding),
  };
  const cleanup = () => fs.rmSync(root, { recursive: true, force: true });
  return { root, fsop, cleanup };
}

/** Write a file under `root`, creating parent directories as needed. */
export function writeFile(root: string, rel: string, content: string): string {
  const abs = path.join(root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
  return abs;
}

/** Relative path to a section root within the agents tree. Skills sit at
 *  `agents/skills/`; roles and workflows are nested under it at
 *  `agents/skills/roles/` and `agents/skills/workflows/`. */
function sectionRelative(section: "skills" | "roles" | "workflows"): string {
  if (section === "skills") return path.join("agents", "skills");
  return path.join("agents", "skills", section);
}

/** Create a skill directory with a minimal `SKILL.md`. */
export function makeSkillDir(
  root: string,
  section: "skills" | "roles" | "workflows",
  name: string,
): string {
  return writeFile(
    root,
    path.join(sectionRelative(section), name, "SKILL.md"),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`,
  );
}

/** Create a single-file skill `<name>.md`. */
export function makeSkillFile(
  root: string,
  section: "skills" | "roles" | "workflows",
  name: string,
): string {
  return writeFile(
    root,
    path.join(sectionRelative(section), `${name}.md`),
    `---\nname: ${name}\ndescription: ${name} skill\n---\n# ${name}\n`,
  );
}

/** Write a loadout manifest at `agents/loadouts/<name>.toml`. */
export function makeLoadoutFile(
  root: string,
  name: string,
  content: string,
): string {
  return writeFile(root, path.join("agents", "loadouts", `${name}.toml`), content);
}

/** Absolute path to the loadout file (without writing it). */
export function loadoutPath(root: string, name: string): string {
  return path.join(root, "agents", "loadouts", `${name}.toml`);
}

/** Absolute path to a section root. */
export function sectionRoot(
  root: string,
  section: "skills" | "roles" | "workflows",
): string {
  return path.join(root, sectionRelative(section));
}
