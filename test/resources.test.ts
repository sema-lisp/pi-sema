import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

/** Parse simple `key: value` frontmatter between --- fences. */
function frontmatter(path: string): Record<string, string> {
  const raw = readFileSync(path, "utf8");
  const match = /^---\n([\s\S]*?)\n---/.exec(raw);
  expect(match, `${path} must start with --- frontmatter`).toBeTruthy();
  const out: Record<string, string> = {};
  for (const line of match![1].split("\n")) {
    const kv = /^([\w-]+):\s*(.*)$/.exec(line);
    if (kv) out[kv[1]] = kv[2];
  }
  return out;
}

describe("packaged skills", () => {
  it("manifest points at skills/ and files whitelist ships it", () => {
    expect(pkg.pi.skills).toContain("./skills");
    expect(pkg.files).toContain("skills/");
  });

  it("every skill has name + description frontmatter and a SKILL.md", () => {
    for (const dir of readdirSync(join(ROOT, "skills"))) {
      const fm = frontmatter(join(ROOT, "skills", dir, "SKILL.md"));
      expect(fm.name, `${dir} name`).toBe(dir);
      expect(fm.description?.length ?? 0, `${dir} description`).toBeGreaterThan(
        40,
      );
    }
  });
});

describe("packaged prompt templates", () => {
  it("manifest points at prompts/ and files whitelist ships it", () => {
    expect(pkg.pi.prompts).toContain("./prompts");
    expect(pkg.files).toContain("prompts/");
  });

  it("every template has a description and substitutes arguments", () => {
    const files = readdirSync(join(ROOT, "prompts")).filter((f) =>
      f.endsWith(".md"),
    );
    expect(files.length).toBeGreaterThan(0);
    for (const file of files) {
      const path = join(ROOT, "prompts", file);
      const fm = frontmatter(path);
      expect(
        fm.description?.length ?? 0,
        `${file} description`,
      ).toBeGreaterThan(10);
      const body = readFileSync(path, "utf8");
      expect(body, `${file} should use $ARGUMENTS/$1 substitution`).toMatch(
        /\$(ARGUMENTS|@|\d)/,
      );
    }
  });
});
