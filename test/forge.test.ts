import { describe, it, expect, vi } from "vitest";
import { execSync } from "node:child_process";
import { extractDeftoolName, registerForgeTool } from "../src/forge/forge.js";
import { verifyToolSource } from "../src/forge/probe.js";
import { DEFAULT_CONFIG } from "../src/config.js";
import type { PiSemaRuntime } from "../src/index.js";

describe("extractDeftoolName", () => {
  it("extracts the name from a single deftool", () => {
    expect(
      extractDeftoolName(
        '(deftool line-count "d" {:p {:type :string}} (lambda (p) p))',
      ),
    ).toBe("line-count");
  });

  it("allows helper defines before the deftool", () => {
    expect(
      extractDeftoolName(
        '(define helper (lambda (x) x))\n(deftool my-tool "d" {} (lambda () (helper 1)))',
      ),
    ).toBe("my-tool");
  });

  it("rejects zero or multiple deftools", () => {
    expect(extractDeftoolName("(define x 1)")).toBeNull();
    expect(
      extractDeftoolName(
        '(deftool a "d" {} (lambda () 1))\n(deftool b "d" {} (lambda () 2))',
      ),
    ).toBeNull();
  });

  it("ignores deftool-like text in strings, comments, and quoted data", () => {
    const source = `; (deftool comment "d" {} (lambda () 1))
'(deftool quoted "d" {} (lambda () 1))
(define help "(deftool string \\"d\\" {} (lambda () 1))")
(deftool actual "d" {} (lambda () 1))`;
    expect(extractDeftoolName(source)).toBe("actual");
  });

  it("ignores deftool-like data inside a short lambda", () => {
    const source = `#(deftool hidden "d" {} (lambda () 1))
(deftool actual "d" {} (lambda () 1))`;
    expect(extractDeftoolName(source)).toBe("actual");
  });
});

describe("create_sema_tool approval", () => {
  it("rejects headless creation before verification or persistence", async () => {
    let forge: { execute: (...args: any[]) => Promise<any> } | undefined;
    const save = vi.fn();
    const pi = {
      registerTool: (definition: {
        name: string;
        execute: (...args: any[]) => Promise<any>;
      }) => {
        if (definition.name === "create_sema_tool") forge = definition;
      },
    };
    const runtime = {
      cfg: structuredClone(DEFAULT_CONFIG),
      store: { save },
      bridge: {},
    } as unknown as PiSemaRuntime;
    registerForgeTool(pi as never, () => runtime);

    const result = await forge!.execute(
      "id",
      {
        name: "headless",
        description: "d",
        source: '(deftool headless "d" {} (lambda () 1))',
      },
      undefined,
      undefined,
      { cwd: process.cwd(), hasUI: false },
    );

    expect(result.content[0].text).toContain("requires the Pi TUI");
    expect(save).not.toHaveBeenCalled();
  });
});

function semaAvailable(): boolean {
  try {
    execSync("sema --version", { stdio: "pipe", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe.skipIf(!semaAvailable())("verifyToolSource (live sema)", () => {
  const TIMEOUT = { timeoutMs: 15_000 };

  it("passes a valid deftool", async () => {
    const result = await verifyToolSource(
      '(deftool doubler "Double" {:x {:type :number}} (lambda (x) (* x 2)))',
      "doubler",
      TIMEOUT,
    );
    expect(result.ok).toBe(true);
  }, 20_000);

  it("reports the nested error with line info for broken source", async () => {
    const result = await verifyToolSource(
      '(deftool broken "d" {:x {:type :number}} (lambda (x) (this-does-not-exist x)))\n(broken-paren',
      "broken",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message.length).toBeGreaterThan(0);
    }
  }, 20_000);

  it("fails when the deftool name does not match", async () => {
    const result = await verifyToolSource(
      '(deftool actual-name "d" {} (lambda () 1))',
      "expected-name",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      // symbol reference to the missing name → unbound-symbol diagnostic
      expect(result.error.message.toLowerCase()).toMatch(/unbound|not a tool/);
    }
  }, 20_000);

  it("strict sandbox blocks shell access at load time", async () => {
    const result = await verifyToolSource(
      '(shell "sh" "-c" "echo pwned")\n(deftool sneaky "d" {} (lambda () 1))',
      "sneaky",
      TIMEOUT,
    );
    expect(result.ok).toBe(false);
  }, 20_000);

  it("enforces our timeout on load-time loops (sema --timeout is a no-op)", async () => {
    const result = await verifyToolSource(
      '(sleep 60000)\n(deftool slow "d" {} (lambda () 1))', // sleep takes milliseconds
      "slow",
      { timeoutMs: 1500 },
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toContain("timed out");
    }
  }, 20_000);
});

describe.skipIf(!semaAvailable())(
  "create_sema_tool registration (live probe)",
  () => {
    function setup(piNameFor: (name: string) => string | undefined) {
      let forge: { execute: (...args: any[]) => Promise<any> } | undefined;
      const appendEntry = vi.fn();
      const save = vi.fn(() => "/tmp/example.sema");
      const injectSource = vi.fn(async () => ({ content: [] }));
      const pi = {
        registerTool: (definition: {
          name: string;
          execute: (...args: any[]) => Promise<any>;
        }) => {
          if (definition.name === "create_sema_tool") forge = definition;
        },
        appendEntry,
      };
      const runtime = {
        cfg: structuredClone(DEFAULT_CONFIG),
        store: { resolve: () => null, save },
        bridge: {
          running: true,
          injectSource,
          refresh: async () => [],
          piNameFor,
        },
      } as unknown as PiSemaRuntime;
      registerForgeTool(pi as never, () => runtime);
      return { forge: forge!, appendEntry, injectSource, save };
    }

    const params = {
      name: "example",
      description: "d",
      source: '(deftool example "d" {} (lambda () 1))',
      tier: "project" as const,
    };
    const context = {
      cwd: process.cwd(),
      hasUI: true,
      ui: { confirm: async () => true },
    };

    it("does not claim registration when the bridge excludes the forged tool", async () => {
      const { forge, appendEntry } = setup(() => undefined);
      const result = await forge.execute(
        "id",
        params,
        undefined,
        undefined,
        context,
      );

      expect(result.content[0].text).toContain("not exposed as a pi tool");
      expect(appendEntry).not.toHaveBeenCalled();
    }, 20_000);

    it("gives the valid same-turn invocation form", async () => {
      const { forge } = setup(() => "sema_example");
      const result = await forge.execute(
        "id",
        params,
        undefined,
        undefined,
        context,
      );

      expect(result.content[0].text).toContain(
        "(tool/invoke example {:param value})",
      );
    }, 20_000);

    it("comments every stored description line without changing live source", async () => {
      const { forge, injectSource, save } = setup(() => "sema_example");
      const confirm = vi.fn(async () => true);
      const source = '(deftool example "d" {} (lambda () 1))';
      await forge.execute(
        "id",
        {
          ...params,
          description: "first line\r\n(define description-marker 1)\nlast line",
          source,
        },
        undefined,
        undefined,
        { ...context, ui: { confirm } },
      );

      expect(confirm).toHaveBeenCalledOnce();
      expect(save).toHaveBeenCalledWith(
        "project",
        "tools",
        "example",
        '; first line\n; (define description-marker 1)\n; last line\n(deftool example "d" {} (lambda () 1))',
      );
      expect(injectSource).toHaveBeenCalledWith(source);
    }, 20_000);
  },
);
