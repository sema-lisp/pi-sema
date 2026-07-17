/**
 * Preloaded ONLY by bun's builtin test runner (via bunfig.toml [test].preload).
 * `bun test` shims the vitest API incompletely, so the suite half-fails in
 * confusing ways — fail fast with the right command instead. `bun run test`
 * and `npm test` execute the "test" script (vitest) and never load this file.
 */
throw new Error(
  "`bun test` is not supported here — bun's vitest compatibility shim is incomplete.\n" +
    "Use `bun run test` or `npm test` (both run vitest).",
);
