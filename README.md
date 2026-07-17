# pi-sema — Sema for Pi

**Sema language support for the [Pi coding agent](https://pi.dev)** — evaluate, format, build, and compile [Sema](https://sema-lang.com) code from within your Pi sessions.

[![CI](https://github.com/sema-lisp/pi-sema/actions/workflows/ci.yml/badge.svg)](https://github.com/sema-lisp/pi-sema/actions)
[![npm](https://img.shields.io/npm/v/@sema-lang/pi-sema)](https://www.npmjs.com/package/@sema-lang/pi-sema)
[![License](https://img.shields.io/github/license/sema-lisp/pi-sema?color=c8a855)](LICENSE)

## Install

```bash
pi install npm:@sema-lang/pi-sema
```

Or from a local checkout:

```bash
npm install
npm run build
pi install /path/to/pi-sema
```

Then run `/reload` inside Pi or restart Pi.

## Requirements

The `sema` binary must be on your `PATH`. Install it:

```bash
curl -fsSL https://sema-lang.com/install.sh | sh
# or: cargo install sema-lang
# or: brew install helgesverre/tap/sema-lang
```

## Features

### LLM Tools

Pi's agent can call these tools when working with Sema code:

| Tool | Description |
| --- | --- |
| `sema_eval` | Evaluate a Sema expression (`-e`) or run a `.sema` file |
| `sema_fmt` | Format a Sema source file (`sema fmt`) |
| `sema_build` | Build a Sema program to a standalone executable (`sema build`) |
| `sema_compile` | Compile a Sema file to bytecode (`sema compile`) |

### Slash Commands

| Command | Description |
| --- | --- |
| `/sema-run <file>` | Run a `.sema` file and display output |
| `/sema-fmt <file>` | Format a `.sema` file |
| `/sema-build <file>` | Build a Sema program to a standalone binary |

### Context Awareness

When Pi detects `.sema` files in your project, the extension automatically injects a concise Sema language reference into the system prompt — covering syntax, LLM primitives, and stdlib — so the agent understands Sema without needing external docs.

## Development

```bash
npm install
npm run check   # typecheck
npm run build   # compile to dist/
npm run dev     # watch mode
```

## Publishing

Tag a release to trigger the CI publish workflow:

```bash
git tag v0.1.0
git push origin v0.1.0
```

## Links

- [Sema Website](https://sema-lang.com)
- [Sema Documentation](https://sema-lang.com/docs)
- [Sema Playground](https://sema.run)
- [Pi Documentation](https://pi.dev/docs/latest/extensions)
- [Pi Package Catalog](https://pi.dev/packages)

## License

MIT © [Helge Sverre](https://github.com/HelgeSverre)
