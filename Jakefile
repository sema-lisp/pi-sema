# Jakefile — @sema-lang/pi-sema, the Sema extension for the Pi coding agent (jakefile.dev).
#
# `@rooted` resolves relative paths against THIS repo so the workspace meta-repo can
# `@import "pi-sema/Jakefile" as pi` and run `pi.build` / `pi.test` from root.
@rooted

# File recipe: recompile only when sources/config change (incremental no-op builds).
file dist/index.js: src/**/* package.json tsconfig.json
    @command -v npm >/dev/null || { echo "npm not found — install Node.js" >&2; exit 1; }
    npm install
    npm run build

@group pi
@desc "Build the extension (TypeScript -> dist/; skips if sources unchanged)"
task build: [dist/index.js]
    echo "pi-sema built: dist/index.js"

@group pi
@desc "Type-check without emitting (tsc --noEmit)"
task typecheck:
    @needs npm
    npm run check

@group pi
@desc "Recompile on change (tsc --watch)"
task watch:
    @needs npm
    npm install
    npm run dev

@group pi
@desc "Build and install the local extension into pi (registers in ~/.pi settings)"
task install: [build]
    @needs pi "npm install -g @earendil-works/pi-coding-agent"
    pi install .

@group pi
@desc "Dev loop: build, install the local extension, then launch pi here"
task dev: [install]
    @needs pi "npm install -g @earendil-works/pi-coding-agent"
    pi

@group pi
@desc "Run the test suite (Vitest): jake pi.test [args='test/forge.test.ts']"
task test args="":
    @needs npm
    npm install
    npm test -- {{args}}

@group pi
@desc "Publish @sema-lang/pi-sema to npm (prepublishOnly rebuilds)"
task publish: [build]
    @confirm "Publish @sema-lang/pi-sema to npm?"
    npm publish --access public
