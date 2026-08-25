import { describe, it, expect } from "vitest";

import {
  parseLoadout,
  expandHome,
  resolveLoadoutPath,
  resourceRoots,
  resolveResourceCandidates,
  selectExisting,
  mergeSections,
  mergeLoadouts,
  resolveInheritanceChain,
  resolveLoadout,
  emptyLoadout,
  TomlParseError,
} from "../lib";
import {
  makeTempFs,
  writeFile,
  makeSkillDir,
  makeSkillFile,
  makeLoadoutFile,
  loadoutPath,
  sectionRoot,
} from "./fixtures";

// ---------------------------------------------------------------------------
// parseLoadout
// ---------------------------------------------------------------------------

describe("parseLoadout", () => {
  it("parses the canonical array form", () => {
    const { loadout, warnings } = parseLoadout(`\
skills = ["commits", "herdr"]
roles = ["architect"]
workflows = ["autopilot"]
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
    expect(loadout.roles.includes).toEqual(["architect"]);
    expect(loadout.workflows.includes).toEqual(["autopilot"]);
    expect(loadout.skills.excludes).toEqual([]);
    expect(warnings).toEqual([]);
  });

  it("parses the boolean-table form, mapping false to excludes", () => {
    const { loadout, warnings } = parseLoadout(`\
[skills]
commits = true
relay = false
herdr = true
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
    expect(loadout.skills.excludes).toEqual(["relay"]);
    expect(warnings).toEqual([]);
  });

  it("allows the array form for one section and the table form for another", () => {
    // Top-level array for `skills` must precede the first table header; once
    // `[roles]` opens, subsequent keys belong to that table until the next
    // header, so you cannot return to the root to add another array.
    const { loadout, warnings } = parseLoadout(`\
skills = ["commits", "herdr"]
[roles]
architect = true
critic = false
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
    expect(loadout.roles.includes).toEqual(["architect"]);
    expect(loadout.roles.excludes).toEqual(["critic"]);
    expect(warnings).toEqual([]);
  });

  it("supports multi-line arrays with a trailing comma", () => {
    const { loadout } = parseLoadout(`\
skills = [
  "commits",
  "herdr",
  "relay",
]
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr", "relay"]);
  });

  it("supports literal (single-quoted) strings", () => {
    const { loadout } = parseLoadout(`skills = ['commits', 'herdr']`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
  });

  it("supports basic-string escapes", () => {
    const { loadout } = parseLoadout(`skills = ["a\\"b"]`);
    expect(loadout.skills.includes).toEqual(['a"b']);
  });

  it("strips line and trailing comments, ignoring # inside strings", () => {
    const { loadout } = parseLoadout(`\
# a leading comment
skills = ["commits", "herdr"]   # trailing comment
roles = ["a#b"]  # the # inside the string is not a comment
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
    expect(loadout.roles.includes).toEqual(["a#b"]);
  });

  it("parses [meta] inherits and description", () => {
    // The skills array must precede the [meta] header; once [meta] is open,
    // subsequent keys belong to that table until the next header.
    const { loadout, warnings } = parseLoadout(`\
skills = ["commits"]
[meta]
inherits = "complex-coding"
description = "data science loadout"
`);
    expect(loadout.inherits).toBe("complex-coding");
    expect(loadout.description).toBe("data science loadout");
    expect(loadout.skills.includes).toEqual(["commits"]);
    expect(warnings).toEqual([]);
  });

  it("treats keys after [meta] as members of that table, not top-level", () => {
    // `skills` appearing under [meta] is meta.skills, an unknown meta key,
    // not the resource section.
    const { loadout, warnings } = parseLoadout(`\
[meta]
inherits = "parent"
skills = ["commits"]
`);
    expect(loadout.skills.includes).toEqual([]);
    expect(warnings).toContain("unknown [meta] key 'skills', ignoring");
  });

  it("warns on unknown tables and top-level keys, ignoring them", () => {
    const { loadout, warnings } = parseLoadout(`\
skills = ["commits"]
bogus = "ignored"
[other]
x = true
`);
    expect(loadout.skills.includes).toEqual(["commits"]);
    expect(warnings).toContain("unknown top-level key 'bogus', ignoring");
    expect(warnings).toContain("unknown table '[other]', ignoring");
  });

  it("warns on unknown [meta] keys and non-string meta values", () => {
    const { loadout, warnings } = parseLoadout(`\
[meta]
inherits = "parent"
extra = "ignored"
description = true
`);
    expect(loadout.inherits).toBe("parent");
    expect(warnings).toContain("unknown [meta] key 'extra', ignoring");
    expect(warnings).toContain("meta.description must be a string, ignoring");
  });

  it("warns when a [section] entry is not a boolean", () => {
    const { loadout, warnings } = parseLoadout(`\
[skills]
commits = true
herdr = "oops"
`);
    expect(loadout.skills.includes).toEqual(["commits"]);
    expect(warnings).toContain("[skills] 'herdr' must be true or false, ignoring");
  });

  it("warns when a top-level section is not an array", () => {
    const { loadout, warnings } = parseLoadout(`\
skills = "not an array"
`);
    expect(loadout.skills.includes).toEqual([]);
    expect(warnings).toContain(
      "top-level 'skills' must be an array of strings, ignoring",
    );
  });

  it("deduplicates names within a section, keeping first order", () => {
    const { loadout } = parseLoadout(`\
[skills]
commits = true
commits = true
herdr = true
`);
    expect(loadout.skills.includes).toEqual(["commits", "herdr"]);
  });

  it("throws TomlParseError on a line without =", () => {
    expect(() => parseLoadout("just some text")).toThrow(TomlParseError);
  });

  it("throws TomlParseError on an unterminated array", () => {
    expect(() => parseLoadout('skills = ["commits",')).toThrow(TomlParseError);
  });

  it("throws TomlParseError on a non-string array element", () => {
    expect(() => parseLoadout("skills = [true]")).toThrow(TomlParseError);
  });

  it("ignores blank lines and CRLF line endings", () => {
    const { loadout } = parseLoadout(
      "skills = [\"commits\"]\r\n\r\nroles = [\"architect\"]\r\n",
    );
    expect(loadout.skills.includes).toEqual(["commits"]);
    expect(loadout.roles.includes).toEqual(["architect"]);
  });
});

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

describe("expandHome", () => {
  it("expands a bare ~", () => {
    expect(expandHome("~", "/home/user")).toBe("/home/user");
  });

  it("expands ~/ to home", () => {
    expect(expandHome("~/agents", "/home/user")).toBe(
      "/home/user/agents",
    );
  });

  it("expands $HOME and ${HOME}", () => {
    expect(expandHome("$HOME/agents", "/home/user")).toBe(
      "/home/user/agents",
    );
    expect(expandHome("${HOME}/agents", "/home/user")).toBe(
      "/home/user/agents",
    );
  });

  it("leaves other env-var-like tokens untouched", () => {
    expect(expandHome("$FOO/bar", "/home/user")).toBe("$FOO/bar");
  });
});

describe("resolveLoadoutPath", () => {
  it("resolves a relative path against the settings file's directory", () => {
    const p = resolveLoadoutPath(
      "agents/loadouts/x.toml",
      "/home/user/.pi/settings.json",
      "/home/user",
    );
    expect(p).toBe("/home/user/.pi/agents/loadouts/x.toml");
  });

  it("expands ~ before resolving", () => {
    const p = resolveLoadoutPath(
      "~/agents/loadouts/x.toml",
      "/somewhere/.pi/settings.json",
      "/home/user",
    );
    expect(p).toBe("/home/user/agents/loadouts/x.toml");
  });

  it("keeps an absolute path as-is", () => {
    const p = resolveLoadoutPath(
      "/srv/agents/loadouts/x.toml",
      "/home/user/.pi/settings.json",
      "/home/user",
    );
    expect(p).toBe("/srv/agents/loadouts/x.toml");
  });
});

describe("resourceRoots", () => {
  it("derives skills/ and the nested skills/roles/ and skills/workflows/ roots", () => {
    const roots = resourceRoots("/srv/agents/loadouts/x.toml");
    expect(roots.skills).toBe("/srv/agents/skills");
    expect(roots.roles).toBe("/srv/agents/skills/roles");
    expect(roots.workflows).toBe("/srv/agents/skills/workflows");
  });
});

describe("resolveResourceCandidates", () => {
  it("returns the directory form first, then the .md form", () => {
    expect(resolveResourceCandidates("/srv/agents/skills", "commits")).toEqual([
      "/srv/agents/skills/commits",
      "/srv/agents/skills/commits.md",
    ]);
  });
});

describe("selectExisting", () => {
  const exists = (p: string) => p === "/a/commits";
  it("returns the first existing candidate", () => {
    expect(
      selectExisting(["/a/commits", "/a/commits.md"], exists),
    ).toBe("/a/commits");
  });

  it("returns null when no candidate exists", () => {
    expect(selectExisting(["/a/missing", "/a/missing.md"], exists)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Inheritance
// ---------------------------------------------------------------------------

describe("mergeSections", () => {
  it("applies parent then child, with child false subtracting", () => {
    const merged = mergeSections(
      { includes: ["a", "b", "c"], excludes: [] },
      { includes: ["d"], excludes: ["b"] },
    );
    expect(merged.includes.sort()).toEqual(["a", "c", "d"]);
    expect(merged.excludes).toEqual(["b"]);
  });

  it("lets child true re-add a parent-excluded item", () => {
    const merged = mergeSections(
      { includes: ["a"], excludes: ["a"] },
      { includes: ["a"], excludes: [] },
    );
    expect(merged.includes).toEqual(["a"]);
  });

  it("accumulates excludes from both parent and child", () => {
    const merged = mergeSections(
      { includes: ["a"], excludes: ["x"] },
      { includes: [], excludes: ["y"] },
    );
    expect(merged.excludes).toEqual(["x", "y"]);
  });
});

describe("mergeLoadouts", () => {
  it("merges all three sections and lets the child description win", () => {
    const merged = mergeLoadouts(
      {
        skills: { includes: ["s1"], excludes: [] },
        roles: { includes: ["r1"], excludes: [] },
        workflows: { includes: ["w1"], excludes: [] },
        description: "parent",
      },
      {
        skills: { includes: ["s2"], excludes: [] },
        roles: { includes: [], excludes: ["r1"] },
        workflows: { includes: [], excludes: [] },
        description: "child",
      },
    );
    expect(merged.skills.includes).toEqual(["s1", "s2"]);
    expect(merged.roles.includes).toEqual([]);
    expect(merged.workflows.includes).toEqual(["w1"]);
    expect(merged.description).toBe("child");
    expect(merged.inherits).toBeUndefined();
  });
});

describe("resolveInheritanceChain", () => {
  it("resolves a single parent, merging its sections", () => {
    const loader = (name: string) => {
      if (name === "parent") {
        return {
          loadout: {
            skills: { includes: ["p1"], excludes: [] },
            roles: { includes: [], excludes: [] },
            workflows: { includes: [], excludes: [] },
          },
          warnings: [],
        };
      }
      return null;
    };
    const child = {
      skills: { includes: ["c1"], excludes: [] },
      roles: { includes: [], excludes: [] },
      workflows: { includes: [], excludes: [] },
      inherits: "parent",
    };
    const { loadout, warnings } = resolveInheritanceChain(child, loader);
    expect(loadout.skills.includes).toEqual(["p1", "c1"]);
    expect(loadout.inherits).toBeUndefined();
    expect(warnings).toEqual([]);
  });

  it("warns and keeps the child when the parent is missing", () => {
    const child = { ...emptyLoadout(), skills: { includes: ["c1"], excludes: [] }, inherits: "ghost" };
    const { loadout, warnings } = resolveInheritanceChain(child, () => null);
    expect(loadout.skills.includes).toEqual(["c1"]);
    expect(warnings).toContain("parent loadout 'ghost' not found");
  });

  it("detects a cycle and warns instead of looping", () => {
    const loader = (name: string) => {
      // a -> b -> a
      if (name === "a") {
        return {
          loadout: { ...emptyLoadout(), inherits: "b" },
          warnings: [],
        };
      }
      if (name === "b") {
        return {
          loadout: { ...emptyLoadout(), inherits: "a" },
          warnings: [],
        };
      }
      return null;
    };
    const child = { ...emptyLoadout(), inherits: "a" };
    const { warnings } = resolveInheritanceChain(child, loader);
    expect(warnings.some((w) => w.includes("cycle"))).toBe(true);
  });

  it("propagates parent parse warnings", () => {
    const loader = (name: string) => {
      if (name === "parent") {
        return {
          loadout: emptyLoadout(),
          warnings: ["parent warned about something"],
        };
      }
      return null;
    };
    const child = { ...emptyLoadout(), inherits: "parent" };
    const { warnings } = resolveInheritanceChain(child, loader);
    expect(warnings).toContain("parent warned about something");
  });
});

// ---------------------------------------------------------------------------
// resolveLoadout (end-to-end against a temp fs)
// ---------------------------------------------------------------------------

describe("resolveLoadout", () => {
  it("resolves directory-form and file-form skills across all three sections", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      makeSkillFile(root, "roles", "architect");
      makeSkillDir(root, "workflows", "autopilot");
      makeLoadoutFile(
        root,
        "ds",
        `\
skills = ["commits"]
roles = ["architect"]
workflows = ["autopilot"]
`,
      );

      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "ds"),
        fsop,
      );

      expect(skillPaths).toEqual([
        `${sectionRoot(root, "skills")}/commits`,
        `${sectionRoot(root, "roles")}/architect.md`,
        `${sectionRoot(root, "workflows")}/autopilot`,
      ]);
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });

  it("warns once per missing resource without failing", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      makeLoadoutFile(root, "ds", `skills = ["commits", "ghost"]`);
      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "ds"),
        fsop,
      );
      expect(skillPaths).toEqual([`${sectionRoot(root, "skills")}/commits`]);
      expect(warnings.some((w) => w.includes("resource not found: ghost"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("warns when the loadout file itself is missing", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "nope"),
        fsop,
      );
      expect(skillPaths).toEqual([]);
      expect(warnings.some((w) => w.includes("loadout file not found"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("warns on a TOML parse error instead of throwing", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeLoadoutFile(root, "bad", "this is not toml at all");
      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "bad"),
        fsop,
      );
      expect(skillPaths).toEqual([]);
      expect(warnings.some((w) => w.includes("could not parse loadout"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("resolves an inherits chain, merging the parent's skills", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      makeSkillDir(root, "skills", "herdr");
      makeLoadoutFile(root, "coding", `skills = ["commits"]`);
      makeLoadoutFile(
        root,
        "ds",
        `\
skills = ["herdr"]
[meta]
inherits = "coding"
`,
      );

      const { skillPaths } = resolveLoadout(loadoutPath(root, "ds"), fsop);
      expect(skillPaths).toEqual([
        `${sectionRoot(root, "skills")}/commits`,
        `${sectionRoot(root, "skills")}/herdr`,
      ]);
    } finally {
      cleanup();
    }
  });

  it("applies child excludes to an inherited parent section", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      makeSkillDir(root, "skills", "herdr");
      makeLoadoutFile(
        root,
        "coding",
        `\
[skills]
commits = true
herdr = true
`,
      );
      makeLoadoutFile(
        root,
        "ds",
        `\
[meta]
inherits = "coding"
[skills]
herdr = false
`,
      );

      const { skillPaths } = resolveLoadout(loadoutPath(root, "ds"), fsop);
      expect(skillPaths).toEqual([`${sectionRoot(root, "skills")}/commits`]);
    } finally {
      cleanup();
    }
  });

  it("warns on an inheritance cycle and keeps what it has", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      // a inherits b, b inherits a. The skills array precedes [meta] so it
      // is a top-level resource section, not meta.skills.
      makeLoadoutFile(
        root,
        "a",
        `skills = ["commits"]\n[meta]\ninherits = "b"\n`,
      );
      makeLoadoutFile(
        root,
        "b",
        `skills = ["commits"]\n[meta]\ninherits = "a"\n`,
      );

      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "a"),
        fsop,
      );
      // commits is still resolved; cycle is reported.
      expect(skillPaths).toEqual([`${sectionRoot(root, "skills")}/commits`]);
      expect(warnings.some((w) => w.includes("cycle"))).toBe(true);
    } finally {
      cleanup();
    }
  });

  it("ignores a resource named in excludes only", () => {
    const { root, fsop, cleanup } = makeTempFs();
    try {
      makeSkillDir(root, "skills", "commits");
      makeLoadoutFile(
        root,
        "ds",
        `[skills]\ncommits = true\nherdr = false\n`,
      );
      const { skillPaths, warnings } = resolveLoadout(
        loadoutPath(root, "ds"),
        fsop,
      );
      // herdr is excluded, so no missing-resource warning is emitted for it.
      expect(skillPaths).toEqual([`${sectionRoot(root, "skills")}/commits`]);
      expect(warnings).toEqual([]);
    } finally {
      cleanup();
    }
  });
});
