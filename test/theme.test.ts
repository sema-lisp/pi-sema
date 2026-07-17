import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Validate the bundled Sema themes the same way Pi's theme loader would, without
 * depending on Pi internals (`loadThemeFromPath` is not part of the package's
 * public export surface). We read Pi's OWN shipped theme schema for the list of
 * required tokens — so if upstream adds/removes a token, this test starts failing
 * instead of the theme silently going stale — and replicate its value semantics:
 * a color is a #RRGGBB hex, a 256-color int (0-255), "" (terminal default), or a
 * reference to a `vars` entry that itself resolves to one of those.
 */

const ROOT = join(__dirname, "..");
const SCHEMA = join(
  ROOT,
  "node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json",
);
const THEMES = ["sema", "sema-light"] as const;

const HEX = /^#[0-9a-fA-F]{6}$/;

type ThemeFile = {
  name: string;
  vars?: Record<string, string | number>;
  colors: Record<string, string | number>;
  export?: Record<string, string | number>;
};

function readJson(path: string): any {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Required color-token names, sourced from Pi's shipped schema. */
function requiredTokens(): string[] {
  const schema = readJson(SCHEMA);
  return schema.properties.colors.required as string[];
}

/** Resolve a raw value one hop through `vars`; returns the concrete leaf value. */
function resolve(value: string | number, vars: Record<string, string | number>): string | number {
  if (typeof value === "number") return value;
  if (value === "") return value;
  if (HEX.test(value)) return value;
  if (value in vars) return vars[value]; // one-hop var reference (Pi vars are leaves)
  return value; // unresolved — caller asserts this never happens
}

function isConcrete(value: string | number): boolean {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 && value <= 255;
  return value === "" || HEX.test(value);
}

describe("bundled Sema themes", () => {
  it("Pi theme schema is present to validate against", () => {
    expect(existsSync(SCHEMA)).toBe(true);
  });

  for (const name of THEMES) {
    describe(name, () => {
      const path = join(ROOT, "themes", `${name}.json`);
      const theme = readJson(path) as ThemeFile;
      const vars = theme.vars ?? {};

      it("is declared in package.json pi.themes and files", () => {
        const pkg = readJson(join(ROOT, "package.json"));
        expect(pkg.pi.themes).toContain(`./themes/${name}.json`);
        expect(pkg.files).toContain("themes/");
      });

      it("has a valid, slash-free name matching its filename", () => {
        expect(theme.name).toBe(name);
        expect(theme.name).not.toMatch(/\//);
      });

      it("covers all required tokens and uses only schema-known tokens", () => {
        // additionalProperties:false rejects unknown keys, but OPTIONAL keys
        // declared in the schema (e.g. thinkingMax, Type.Optional in pi's
        // theme.js, defaulted to thinkingXhigh when absent) are legal.
        const schema = readJson(SCHEMA);
        const required: string[] = schema.properties.colors.required;
        const allowed = new Set(Object.keys(schema.properties.colors.properties));
        const actual = Object.keys(theme.colors);
        expect(required.filter((k) => !actual.includes(k))).toEqual([]);
        expect(actual.filter((k) => !allowed.has(k))).toEqual([]);
      });

      it("every var resolves to a concrete color value", () => {
        for (const [key, value] of Object.entries(vars)) {
          expect(isConcrete(value), `var ${key}=${value}`).toBe(true);
        }
      });

      it("every color token resolves to a concrete value", () => {
        for (const [token, value] of Object.entries(theme.colors)) {
          const resolved = resolve(value, vars);
          expect(isConcrete(resolved), `${token}=${JSON.stringify(value)} -> ${JSON.stringify(resolved)}`).toBe(true);
        }
      });

      it("export section, if present, only uses concrete values", () => {
        for (const [token, value] of Object.entries(theme.export ?? {})) {
          expect(isConcrete(resolve(value, vars)), `export.${token}`).toBe(true);
        }
      });
    });
  }
});
