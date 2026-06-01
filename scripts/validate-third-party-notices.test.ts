import { describe, expect, it } from "vitest";
import { collectPinnedVersionProblems, isPinnedSemver } from "./validate-third-party-notices";

describe("third-party notice dependency pinning", () => {
  it("accepts exact semver pins, including prerelease and build metadata", () => {
    expect(isPinnedSemver("1.2.3")).toBe(true);
    expect(isPinnedSemver("0.0.1")).toBe(true);
    expect(isPinnedSemver("2.0.0-rc.1")).toBe(true);
    expect(isPinnedSemver("2.0.0+build.7")).toBe(true);
    expect(isPinnedSemver("2.0.0-rc.1+build.7")).toBe(true);
  });

  it("rejects floating ranges, tags, URLs, git specs, aliases, and wildcards", () => {
    for (const version of [
      "latest",
      "^1.2.3",
      "~1.2.3",
      ">=1.2.3",
      "1.2.x",
      "*",
      "next",
      "workspace:*",
      "npm:react@19.2.6",
      "git+https://github.com/example/pkg.git",
      "https://registry.npmjs.org/pkg/-/pkg-1.2.3.tgz"
    ]) {
      expect(isPinnedSemver(version), version).toBe(false);
    }
  });

  it("reports unpinned root dependencies, devDependencies, and nested overrides", () => {
    const problems = collectPinnedVersionProblems({
      dependencies: {
        next: "^15.5.18",
        react: "19.2.6"
      },
      devDependencies: {
        typescript: "~5.9.3",
        vitest: "3.2.4"
      },
      overrides: {
        postcss: "8.5.15",
        parent: {
          child: "latest"
        }
      }
    });

    expect(problems).toEqual([
      "next must use an exact pinned semver version, found ^15.5.18",
      "overrides.parent.child must use an exact pinned semver version, found latest",
      "typescript must use an exact pinned semver version, found ~5.9.3"
    ]);
  });
});
