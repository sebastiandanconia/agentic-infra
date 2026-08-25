// Testable internals for the loadout-mgr pi extension.
//
// A loadout is a TOML manifest naming a subset of skills, roles, and
// workflows that live in fixed subdirectories relative to the loadout file's
// file. The factory in index.ts stays thin (it touches the ExtensionAPI
// surface and the real filesystem) and delegates everything unit-testable to
// here. Every function that would touch the filesystem takes an injectable
// fs/op object so behavior can be tested deterministically against an
// in-memory tree.

import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A single resource section. `includes` are names to load; `excludes` are
 *  names explicitly removed (only expressible in the boolean-table form, and
 *  only meaningful under inheritance). */
export interface LoadoutSection {
  includes: string[];
  excludes: string[];
}

/** Parsed loadout. The three sections resolve from subdirectories of the
 *  loadout file's parent. `inherits` names a parent loadout (stem, no `.toml`)
 *  in the same `loadouts/` directory. */
export interface Loadout {
  skills: LoadoutSection;
  roles: LoadoutSection;
  workflows: LoadoutSection;
  inherits?: string;
  description?: string;
}

/** Result of resolving one loadout file into concrete skill paths. */
export interface ResolvedLoadout {
  skillPaths: string[];
  warnings: string[];
}

/** Minimal filesystem surface the resolver needs. Injectable for tests. */
export interface FsOp {
  existsSync(p: string): boolean;
  readFileSync(p: string, encoding: "utf-8"): string;
}

export class TomlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TomlParseError";
  }
}

// The three resource sections, in resolution order.
const SECTION_NAMES = ["skills", "roles", "workflows"] as const;
type SectionName = (typeof SECTION_NAMES)[number];

// ---------------------------------------------------------------------------
// TOML subset parser
// ---------------------------------------------------------------------------
//
// We implement a focused subset of TOML 1.0.0 rather than taking a runtime
// dependency, to match the house style of zero runtime deps. The subset
// covers exactly what a loadout manifest needs:
//
//   - Top-level `key = ["a", "b", ...]` arrays of strings (canonical form).
//   - `[table]` headers with `key = true | false` boolean entries (the
//     alternative form, the only way to express exclusions).
//   - `[meta]` table with `inherits = "name"` and `description = "..."`.
//   - Basic (`"..."`) and literal (`'...'`) strings, `#` comments (line and
//     trailing), multi-line arrays, and trailing commas inside arrays.
//
// Unknown tables and keys are not errors; they are returned as warnings so a
// loadout can carry `[meta] description = "..."` annotations without breaking
// the parser.

type TomlValue = string | boolean | string[];
interface RawToml {
  [table: string]: { [key: string]: TomlValue };
}

/** Strip a `#` comment from a line, ignoring `#` inside strings. */
function stripComment(line: string): string {
  let inStr = false;
  let quote = "";
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (inStr) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === "#") return line.slice(0, j);
  }
  return line;
}

/** Whether the bracket depth of `s` is balanced, ignoring brackets inside
 *  strings. Used to detect when a multi-line array has been fully consumed. */
function bracketsBalanced(s: string): boolean {
  let depth = 0;
  let inStr = false;
  let quote = "";
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      continue;
    }
    if (ch === "[") depth++;
    else if (ch === "]") depth--;
  }
  return depth === 0;
}

/** Parse a basic (double-quoted) TOML string with `\\` and `\"` escapes. */
function parseBasicString(s: string): string {
  const t = s.trim();
  if (!t.startsWith('"') || !t.endsWith('"') || t.length < 2) {
    throw new TomlParseError(`malformed string: ${s}`);
  }
  let out = "";
  for (let j = 1; j < t.length - 1; j++) {
    const ch = t[j];
    if (ch === "\\") {
      const next = t[j + 1];
      if (next === '"') out += '"';
      else if (next === "\\") out += "\\";
      else if (next === "n") out += "\n";
      else if (next === "t") out += "\t";
      else out += next;
      j++;
      continue;
    }
    out += ch;
  }
  return out;
}

/** Parse a literal (single-quoted) TOML string with no escapes. */
function parseLiteralString(s: string): string {
  const t = s.trim();
  if (!t.startsWith("'") || !t.endsWith("'") || t.length < 2) {
    throw new TomlParseError(`malformed literal string: ${s}`);
  }
  return t.slice(1, -1);
}

/** Split `s` on top-level commas, ignoring commas inside strings. Empty
 *  pieces (from a trailing comma) are dropped. */
function splitCommas(s: string): string[] {
  const parts: string[] = [];
  let inStr = false;
  let quote = "";
  let depth = 0;
  let buf = "";
  for (let j = 0; j < s.length; j++) {
    const ch = s[j];
    if (inStr) {
      buf += ch;
      if (ch === "\\") {
        buf += s[j + 1] ?? "";
        j++;
        continue;
      }
      if (ch === quote) inStr = false;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inStr = true;
      quote = ch;
      buf += ch;
      continue;
    }
    if (ch === "[") {
      depth++;
      buf += ch;
      continue;
    }
    if (ch === "]") {
      depth--;
      buf += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      parts.push(buf);
      buf = "";
      continue;
    }
    buf += ch;
  }
  if (buf.trim() !== "") parts.push(buf);
  return parts;
}

/** Parse a TOML array-of-strings value. */
function parseArray(s: string): string[] {
  const t = s.trim();
  if (!t.startsWith("[") || !t.endsWith("]")) {
    throw new TomlParseError(`malformed array: ${s}`);
  }
  const inner = t.slice(1, -1).trim();
  if (inner === "") return [];
  return splitCommas(inner).map((item) => {
    const it = item.trim();
    if (it.startsWith('"')) return parseBasicString(it);
    if (it.startsWith("'")) return parseLiteralString(it);
    throw new TomlParseError(
      `array elements must be strings, got: ${it}`,
    );
  });
}

/** Parse a single TOML value (string, boolean, or array of strings). */
function parseValue(s: string): TomlValue {
  const t = s.trim();
  if (t.startsWith("[")) return parseArray(t);
  if (t === "true") return true;
  if (t === "false") return false;
  if (t.startsWith('"')) return parseBasicString(t);
  if (t.startsWith("'")) return parseLiteralString(t);
  throw new TomlParseError(`unsupported value: ${s}`);
}

/** Parse the TOML subset into a raw table structure. Throws TomlParseError on
 *  malformed input. */
function parseTomlSubset(content: string): RawToml {
  const raw: RawToml = { "": {} };
  let current = "";
  const lines = content.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;

  while (i < lines.length) {
    const line = stripComment(lines[i]).trim();
    i++;
    if (line === "") continue;

    const headerMatch = line.match(/^\[([A-Za-z0-9_.-]+)\]$/);
    if (headerMatch) {
      current = headerMatch[1];
      if (!raw[current]) raw[current] = {};
      continue;
    }

    const eqIdx = line.indexOf("=");
    if (eqIdx === -1) {
      throw new TomlParseError(`expected 'key = value', got: ${line}`);
    }
    const key = line.slice(0, eqIdx).trim();
    let valuePart = line.slice(eqIdx + 1).trim();
    if (key === "") {
      throw new TomlParseError(`empty key in: ${line}`);
    }

    // Multi-line array: keep consuming lines until brackets balance.
    if (valuePart.startsWith("[") && !bracketsBalanced(valuePart)) {
      while (i < lines.length && !bracketsBalanced(valuePart)) {
        valuePart += "\n" + stripComment(lines[i]).trim();
        i++;
      }
      if (!bracketsBalanced(valuePart)) {
        throw new TomlParseError(`unterminated array for key '${key}'`);
      }
    }

    raw[current][key] = parseValue(valuePart);
  }

  return raw;
}

/** Deduplicate a string array, preserving first-seen order. */
function dedupe(names: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const n of names) {
    if (!seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/**
 * Parse a loadout manifest. Returns the loadout plus warnings for unknown
 * sections/keys and type mismatches. Throws `TomlParseError` on malformed
 * TOML the subset parser cannot recover from.
 */
export function parseLoadout(content: string): {
  loadout: Loadout;
  warnings: string[];
} {
  const raw = parseTomlSubset(content);
  const warnings: string[] = [];
  const loadout: Loadout = {
    skills: { includes: [], excludes: [] },
    roles: { includes: [], excludes: [] },
    workflows: { includes: [], excludes: [] },
  };

  // Top-level array form: skills = ["a", "b", ...].
  for (const section of SECTION_NAMES) {
    const rootVal = raw[""][section];
    if (rootVal !== undefined) {
      if (Array.isArray(rootVal)) {
        loadout[section].includes.push(
          ...rootVal.filter((x): x is string => typeof x === "string"),
        );
      } else {
        warnings.push(
          `top-level '${section}' must be an array of strings, ignoring`,
        );
      }
    }
  }

  // Tables: [skills], [roles], [workflows], [meta], and anything else.
  for (const tableName of Object.keys(raw)) {
    if (tableName === "") {
      for (const k of Object.keys(raw[""])) {
        if (!(SECTION_NAMES as readonly string[]).includes(k)) {
          warnings.push(`unknown top-level key '${k}', ignoring`);
        }
      }
      continue;
    }

    if (tableName === "meta") {
      for (const [k, v] of Object.entries(raw["meta"])) {
        if (k === "inherits") {
          if (typeof v === "string") loadout.inherits = v;
          else warnings.push("meta.inherits must be a string, ignoring");
        } else if (k === "description") {
          if (typeof v === "string") loadout.description = v;
          else warnings.push("meta.description must be a string, ignoring");
        } else {
          warnings.push(`unknown [meta] key '${k}', ignoring`);
        }
      }
      continue;
    }

    if ((SECTION_NAMES as readonly string[]).includes(tableName)) {
      const table = raw[tableName];
      const section = tableName as SectionName;
      for (const [k, v] of Object.entries(table)) {
        if (v === true) loadout[section].includes.push(k);
        else if (v === false) loadout[section].excludes.push(k);
        else warnings.push(`[${tableName}] '${k}' must be true or false, ignoring`);
      }
      continue;
    }

    warnings.push(`unknown table '[${tableName}]', ignoring`);
  }

  loadout.skills.includes = dedupe(loadout.skills.includes);
  loadout.skills.excludes = dedupe(loadout.skills.excludes);
  loadout.roles.includes = dedupe(loadout.roles.includes);
  loadout.roles.excludes = dedupe(loadout.roles.excludes);
  loadout.workflows.includes = dedupe(loadout.workflows.includes);
  loadout.workflows.excludes = dedupe(loadout.workflows.excludes);

  return { loadout, warnings };
}

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * Expand a leading `~` and `$HOME` / `${HOME}` references to `home`. Only the
 * documented expansions are applied; other env vars are left untouched so the
 * behavior is predictable and dependency-free.
 */
export function expandHome(p: string, home: string): string {
  let s = p;
  if (s.startsWith("~/") || s === "~") {
    s = (s === "~" ? home : path.join(home, s.slice(2))) as string;
  }
  // `$HOME` and `${HOME}` only, per the README.
  s = s.replace(/\$\{HOME\}/g, home).replace(/\$HOME\b/g, home);
  return s;
}

/**
 * Resolve a loadout path entry from a settings file. `~` and `$HOME` are
 * expanded first; relative paths are resolved against the settings file's
 * directory (mirroring how pi resolves local package paths), and absolute
 * paths are kept as-is.
 */
export function resolveLoadoutPath(
  raw: string,
  settingsFile: string,
  home: string,
): string {
  const expanded = expandHome(raw, home);
  if (path.isAbsolute(expanded)) return expanded;
  return path.resolve(path.dirname(settingsFile), expanded);
}

/**
 * The fixed resource roots for a loadout file. From `<agents>/loadouts/<name>
 * .toml`:
 *   - skills    -> `<agents>/skills/`
 *   - roles     -> `<agents>/skills/roles/`
 *   - workflows -> `<agents>/skills/workflows/`
 */
export function resourceRoots(loadoutFile: string): {
  skills: string;
  roles: string;
  workflows: string;
} {
  const loadoutsDir = path.dirname(loadoutFile);
  const agentsDir = path.resolve(loadoutsDir, "..");
  return {
    skills: path.join(agentsDir, "skills"),
    roles: path.join(agentsDir, "skills", "roles"),
    workflows: path.join(agentsDir, "skills", "workflows"),
  };
}

/**
 * Candidate filesystem paths for a named resource: the directory form
 * (`<root>/<name>/`) first, then the single-file form (`<root>/<name>.md`).
 * The caller picks whichever exists.
 */
export function resolveResourceCandidates(
  root: string,
  name: string,
): string[] {
  return [path.join(root, name), path.join(root, `${name}.md`)];
}

/** Return the first candidate that exists, or null if none do. */
export function selectExisting(
  candidates: string[],
  exists: (p: string) => boolean,
): string | null {
  for (const c of candidates) {
    if (exists(c)) return c;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

/**
 * Merge two loadout sections: apply the parent's includes, then the parent's
 * excludes, then the child's includes, then the child's excludes. Later
 * operations win, so a child `true` re-adds a parent-excluded item and a child
 * `false` removes a parent-included one. Cumulative excludes are preserved so
 * a merged section can itself be used as a parent.
 */
export function mergeSections(
  parent: LoadoutSection,
  child: LoadoutSection,
): LoadoutSection {
  const set = new Set<string>(parent.includes);
  for (const n of parent.excludes) set.delete(n);
  for (const n of child.includes) set.add(n);
  for (const n of child.excludes) set.delete(n);
  const excludes = dedupe([...parent.excludes, ...child.excludes]);
  return { includes: [...set], excludes };
}

/** Merge a parent loadout into a child. The result carries no `inherits`
 *  (the chain is resolved by the caller) and the child's description wins. */
export function mergeLoadouts(parent: Loadout, child: Loadout): Loadout {
  return {
    skills: mergeSections(parent.skills, child.skills),
    roles: mergeSections(parent.roles, child.roles),
    workflows: mergeSections(parent.workflows, child.workflows),
    description: child.description ?? parent.description,
  };
}

/** Loadout with empty sections, used as a safe fallback for unreadable
 *  parents. */
export function emptyLoadout(): Loadout {
  return {
    skills: { includes: [], excludes: [] },
    roles: { includes: [], excludes: [] },
    workflows: { includes: [], excludes: [] },
  };
}

/**
 * Resolve a loadout's `inherits` chain. `loader` resolves a parent name to its
 * parsed loadout (or null when missing); the caller supplies it so filesystem
 * access stays injectable. Cycles are detected and reported as warnings rather
 * than throwing.
 */
export function resolveInheritanceChain(
  loadout: Loadout,
  loader: (name: string) => { loadout: Loadout; warnings: string[] } | null,
  visited: Set<string> = new Set(),
): { loadout: Loadout; warnings: string[] } {
  const warnings: string[] = [];
  if (!loadout.inherits) return { loadout, warnings };

  const parentName = loadout.inherits;
  if (visited.has(parentName)) {
    warnings.push(`inheritance cycle detected at '${parentName}'`);
    return { loadout: { ...loadout, inherits: undefined }, warnings };
  }

  const parentLoaded = loader(parentName);
  if (!parentLoaded) {
    warnings.push(`parent loadout '${parentName}' not found`);
    return { loadout: { ...loadout, inherits: undefined }, warnings };
  }
  warnings.push(...parentLoaded.warnings);

  const nextVisited = new Set(visited);
  nextVisited.add(parentName);
  const parentResolved = resolveInheritanceChain(
    parentLoaded.loadout,
    loader,
    nextVisited,
  );
  warnings.push(...parentResolved.warnings);

  const merged = mergeLoadouts(parentResolved.loadout, loadout);
  return { loadout: merged, warnings };
}

// ---------------------------------------------------------------------------
// Full loadout resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a single loadout file into concrete skill paths. Reads and parses
 * the file, resolves its inheritance chain, then resolves each included name
 * against its section root. Missing files, parse errors, and missing resources
 * produce warnings rather than throwing, so one bad loadout never breaks pi
 * startup.
 */
export function resolveLoadout(
  loadoutFile: string,
  fsop: FsOp,
): ResolvedLoadout {
  const warnings: string[] = [];

  if (!fsop.existsSync(loadoutFile)) {
    return {
      skillPaths: [],
      warnings: [`loadout file not found: ${loadoutFile}`],
    };
  }

  let content: string;
  try {
    content = fsop.readFileSync(loadoutFile, "utf-8");
  } catch (e) {
    return {
      skillPaths: [],
      warnings: [
        `could not read loadout ${loadoutFile}: ${(e as Error).message}`,
      ],
    };
  }

  let parsed: { loadout: Loadout; warnings: string[] };
  try {
    parsed = parseLoadout(content);
  } catch (e) {
    return {
      skillPaths: [],
      warnings: [
        `could not parse loadout ${loadoutFile}: ${(e as Error).message}`,
      ],
    };
  }
  warnings.push(...parsed.warnings);

  // Parents live next to this loadout in the same loadouts/ directory.
  const loadoutsDir = path.dirname(loadoutFile);
  const loader = (
    name: string,
  ): { loadout: Loadout; warnings: string[] } | null => {
    const parentFile = path.join(loadoutsDir, `${name}.toml`);
    if (!fsop.existsSync(parentFile)) return null;
    try {
      const c = fsop.readFileSync(parentFile, "utf-8");
      const r = parseLoadout(c);
      return { loadout: r.loadout, warnings: r.warnings };
    } catch (e) {
      return {
        loadout: emptyLoadout(),
        warnings: [
          `could not parse parent '${name}': ${(e as Error).message}`,
        ],
      };
    }
  };

  const resolved = resolveInheritanceChain(
    parsed.loadout,
    loader,
    new Set(),
  );
  warnings.push(...resolved.warnings);

  const roots = resourceRoots(loadoutFile);
  const sections: { root: string; section: LoadoutSection }[] = [
    { root: roots.skills, section: resolved.loadout.skills },
    { root: roots.roles, section: resolved.loadout.roles },
    { root: roots.workflows, section: resolved.loadout.workflows },
  ];

  const skillPaths: string[] = [];
  for (const { root, section } of sections) {
    for (const name of section.includes) {
      const candidates = resolveResourceCandidates(root, name);
      const found = selectExisting(candidates, (p) => fsop.existsSync(p));
      if (found) {
        skillPaths.push(found);
      } else {
        warnings.push(
          `resource not found: ${name} (looked under ${root})`,
        );
      }
    }
  }

  return { skillPaths, warnings };
}
