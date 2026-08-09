import { describe, expect, it } from "vitest";
// @ts-expect-error - plain ESM module, no types, shipped as-is to Actions runners
import {
  addedDependencies,
  concerns,
  highestSeverity,
  manifestFor,
  parseCargoToml,
  pinnedVersion,
  parsePackageJson,
  parseRequirements,
  shouldFail,
} from "../action/parse.mjs";

/**
 * The action's failure modes are quiet: a dependency the parser misses is
 * indistinguishable from one that came back clean, and a bad threshold either
 * blocks every PR or none. Both are asserted here rather than discovered in
 * somebody else's CI.
 */

describe("manifest detection", () => {
  it("recognises the three supported manifests, nested or not", () => {
    expect(manifestFor("package.json")?.ecosystem).toBe("npm");
    expect(manifestFor("apps/web/package.json")?.ecosystem).toBe("npm");
    expect(manifestFor("requirements.txt")?.ecosystem).toBe("pypi");
    expect(manifestFor("requirements-dev.txt")?.ecosystem).toBe("pypi");
    expect(manifestFor("Cargo.toml")?.ecosystem).toBe("crates");
    expect(manifestFor("crates/core/Cargo.toml")?.ecosystem).toBe("crates");
  });

  it("ignores files that merely look similar", () => {
    // package-lock.json is not a manifest we read; treating it as one would
    // report every transitive dependency as newly added.
    expect(manifestFor("package-lock.json")).toBeNull();
    expect(manifestFor("Cargo.lock")).toBeNull();
    expect(manifestFor("src/package.json.bak")).toBeNull();
  });
});

describe("package.json", () => {
  it("collects every dependency section", () => {
    const names = parsePackageJson(
      JSON.stringify({
        dependencies: { express: "^5" },
        devDependencies: { vitest: "^4" },
        optionalDependencies: { fsevents: "*" },
        peerDependencies: { react: "^19" },
      }),
    );
    expect([...names.keys()].sort()).toEqual(["express", "fsevents", "react", "vitest"]);
  });

  it("keeps scoped names intact", () => {
    expect([...parsePackageJson(JSON.stringify({ dependencies: { "@types/node": "^22" } })).keys()]).toEqual([
      "@types/node",
    ]);
  });

  it("returns nothing for malformed JSON rather than throwing", () => {
    // A syntax error mid-PR must not crash the action for the whole repo.
    expect(parsePackageJson("{ not json").size).toBe(0);
  });
});

describe("requirements.txt", () => {
  it("strips version specifiers, extras and markers", () => {
    const names = parseRequirements(
      [
        "requests==2.31.0",
        "django>=4.2,<5",
        "urllib3 ~= 2.0",
        "celery[redis]==5.3",
        'pytest; python_version >= "3.9"',
        "  flask  ",
      ].join("\n"),
    );
    expect([...names.keys()].sort()).toEqual(["celery", "django", "flask", "pytest", "requests", "urllib3"]);
  });

  it("skips comments, flags, includes and URLs", () => {
    // These are not package names; looking them up would produce noise rows
    // that read as "not found" and erode trust in the report.
    const names = parseRequirements(
      [
        "# a comment",
        "-r base.txt",
        "--index-url https://example.com/simple",
        "-e git+https://github.com/x/y#egg=y",
        "https://example.com/pkg.whl",
        "real-package==1.0",
      ].join("\n"),
    );
    expect([...names.keys()]).toEqual(["real-package"]);
  });
});

describe("Cargo.toml", () => {
  it("reads plain and table-valued dependencies", () => {
    const names = parseCargoToml(
      [
        "[package]",
        'name = "my-crate"',
        'version = "0.1.0"',
        "",
        "[dependencies]",
        'serde = "1.0"',
        'tokio = { version = "1", features = ["full"] }',
        "",
        "[dev-dependencies]",
        'criterion = "0.5"',
      ].join("\n"),
    );
    expect([...names.keys()].sort()).toEqual(["criterion", "serde", "tokio"]);
  });

  it("does not mistake package metadata for a dependency", () => {
    // `name` and `version` under [package] are the classic false positive.
    const names = parseCargoToml(['[package]', 'name = "my-crate"', 'version = "0.1.0"'].join("\n"));
    expect(names.size).toBe(0);
  });

  it("picks up a crate declared as its own table", () => {
    const names = parseCargoToml(
      ["[dependencies.rocket]", 'version = "0.5"', 'features = ["json"]'].join("\n"),
    );
    expect([...names.keys()]).toEqual(["rocket"]);
  });
});

describe("added dependencies", () => {
  it("reports only what the pull request introduces", () => {
    const before = JSON.stringify({ dependencies: { express: "^4" } });
    const after = JSON.stringify({ dependencies: { express: "^5", lodash: "^4" } });
    // express was bumped, not added — reviewing it again on every version bump
    // would make the comment noise people learn to ignore.
    expect(addedDependencies(before, after, parsePackageJson).map((d: any) => d.name)).toEqual(["lodash"]);
  });

  it("treats a brand-new manifest as all-added", () => {
    const after = JSON.stringify({ dependencies: { express: "^5" } });
    expect(addedDependencies("", after, parsePackageJson).map((d: any) => d.name)).toEqual(["express"]);
  });
});

describe("failure threshold", () => {
  const critical = [{ found: true, vulns: [{ severity: "CRITICAL" }] }];
  const moderate = [{ found: true, vulns: [{ severity: "MODERATE" }] }];
  const none = [{ found: true, vulns: [] }];

  it("defaults to reporting without blocking", () => {
    expect(shouldFail(critical, "none")).toBe(false);
    expect(shouldFail(critical, "")).toBe(false);
  });

  it("treats the threshold as a floor, not an exact match", () => {
    expect(shouldFail(critical, "high")).toBe(true);
    expect(shouldFail(moderate, "high")).toBe(false);
    expect(shouldFail(moderate, "moderate")).toBe(true);
  });

  it("never fails on a package it could not look up", () => {
    // An upstream outage must not block an unrelated pull request.
    expect(shouldFail([{ found: false, error: "rate limited" }], "critical")).toBe(false);
    expect(shouldFail(none, "critical")).toBe(false);
  });

  it("picks the worst severity present", () => {
    expect(highestSeverity([{ severity: "LOW" }, { severity: "CRITICAL" }, { severity: "MODERATE" }])).toBe(
      "CRITICAL",
    );
    expect(highestSeverity([])).toBeNull();
  });
});

describe("concerns", () => {
  it("flags deprecation, advisories and staleness", () => {
    const old = new Date(Date.now() - 1000 * 60 * 60 * 24 * 365 * 4).toISOString();
    const out = concerns({
      found: true,
      deprecated: true,
      vulns: [{ severity: "HIGH" }],
      lastPublish: old,
      license: "MIT",
    });
    expect(out.join(" ")).toContain("deprecated");
    expect(out.join(" ")).toContain("HIGH");
    expect(out.join(" ")).toContain("no release in");
  });

  it("says nothing about a healthy package", () => {
    expect(
      concerns({
        found: true,
        deprecated: false,
        vulns: [],
        lastPublish: new Date().toISOString(),
        license: "MIT",
      }),
    ).toEqual([]);
  });
});

describe("pinned versions", () => {
  it("recognises an exact pin per ecosystem", () => {
    // A pinned version is where an advisory actually bites: a range resolves to
    // whatever is current, but "pyyaml==5.3.1" installs a vulnerable release
    // forever. Checking the pin is the difference between catching that and
    // reporting the package clean.
    expect(pinnedVersion("4.17.21", "npm")).toBe("4.17.21");
    expect(pinnedVersion("==5.3.1", "pypi")).toBe("5.3.1");
    expect(pinnedVersion("=1.0.3", "crates")).toBe("1.0.3");
  });

  it("returns null for a range, so the current release is used instead", () => {
    for (const [spec, eco] of [
      ["^4.17.21", "npm"],
      ["~1.2.3", "npm"],
      [">=4.2,<5", "pypi"],
      ["1.0", "crates"],
      ["", "npm"],
    ] as [string, string][]) {
      expect(pinnedVersion(spec, eco), `${eco} ${spec}`).toBeNull();
    }
  });

  it("carries the specifier through to the added list", () => {
    const after = JSON.stringify({ dependencies: { lodash: "4.17.20" } });
    const added = addedDependencies("", after, parsePackageJson) as any[];
    expect(added[0]).toEqual({ name: "lodash", spec: "4.17.20" });
    expect(pinnedVersion(added[0].spec, "npm")).toBe("4.17.20");
  });
});
