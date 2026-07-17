# Sema themes for Pi — design

Date: 2026-07-17
Status: approved, implementing

## Goal

Ship an on-brand Sema theme for the Pi coding agent as part of the `@sema-lang/pi-sema`
package, so `pi install npm:@sema-lang/pi-sema` delivers it and users can `/theme sema`.

Two variants:
- `sema` — dark, the brand's true home: brass (`#c8a855`) on warm near-black (`#131110`).
- `sema-light` — parchment: dark brass ink on warm off-white, for light terminals and
  Pi's auto light/dark switching (`--theme "sema-light,sema"`).

Out of scope (deferred, per user): skill files / prompt templates, standalone pi-package
extraction. This is only the theme.

## Source of truth

The Sema brand palette is already defined in the website
(`sema/website/.vitepress/theme/custom.css`, `brandAssets.js`) and — crucially — a syntax
highlighting theme (`sema/website/.vitepress/sema-code-theme.json`) that maps almost 1:1 to
Pi's 9 syntax tokens. We translate an existing identity rather than invent one.

Brand palette:
- Brass accent `#c8a855`, darker brass `#a08838`
- Backgrounds (dark): `#131110` (deepest), `#181512` (alt/code), `#1c1916` (soft)
- Text `#e9e3d6`, muted `#968c79`, dim `#6b6354`, divider `#221e19`, scrollbar `#3a342b`
- Syntax: string green `#a8c47a`, number amber `#d19a66`, keyword teal `#7aacb8`,
  comment `#6b6354` (italic), punctuation `#6a6258`

The only color not in the brand is an earthy brick red `#cc6a5a` for `error` /
`toolDiffRemoved`, chosen to harmonize with the warm palette (no pure `#ff0000`).

## Theme format (verified against the shipped schema)

Pi themes are JSON: `{ name, vars?, colors, export? }`. `colors` requires all 51 tokens and
is `additionalProperties: false` — so `thinkingMax` (docs call it optional) is **omitted**;
including it fails validation. Values: `#RRGGBB`, a 256-color int, a `vars` reference, or
`""` (terminal default). Reference schema:
`node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-schema.json`.

## Distribution

- Files live at `themes/sema.json` and `themes/sema-light.json` (package root).
- `package.json`: add `pi.themes: ["./themes/sema.json", "./themes/sema-light.json"]`
  and add `"themes/"` to the `files` allowlist so they ship in the npm tarball.
- `.npmignore` already whitelists via `files`; no change needed there.

## Dark token mapping (`sema`)

Uses `vars` for the palette; `colors` reference them. Highlights:

| Token(s) | Value |
| --- | --- |
| accent, borderAccent, toolTitle, mdHeading, mdListBullet, customMessageLabel, syntaxKeyword, syntaxOperator | brass `#c8a855` |
| text | `#e9e3d6` |
| muted / dim / toolOutput / mdQuote / toolDiffContext / thinkingText | `#968c79` / `#6b6354` |
| border / borderMuted / mdCodeBlockBorder / mdHr | `#3a342b` / `#221e19` |
| success / syntaxString / toolDiffAdded | green `#a8c47a` |
| warning / syntaxNumber / bashMode / mdCode | amber `#d19a66` |
| error / toolDiffRemoved | brick `#cc6a5a` |
| syntaxType / syntaxFunction / mdLink | teal `#7aacb8` |
| syntaxComment / syntaxPunctuation | `#6b6354` / `#6a6258` |
| selectedBg / userMessageBg / customMessageBg / toolPendingBg | `#221e19` / `#181512` / `#1c1916` / `#181512` |
| toolSuccessBg / toolErrorBg | tinted `#171a12` / `#201411` |
| thinking off→xhigh | dim → muted → teal → brass → amber → brick |
| export | pageBg `#131110`, cardBg `#181512`, infoBg `#1c1916` |

## Light token mapping (`sema-light`)

Same hues, flipped for a light terminal: ink `#2a2620`, darker brass `#a08838`, darkened
string `#5a7d3a` / number `#a76a2e` / keyword `#3a7d8a`, light-tinted region bgs
(`#ede7d8`, `#e6ddca`), export pageBg `#f4efe4`.

## Verification

1. Load both files through Pi's own `loadThemeFromPath` (installed SDK) and assert no throw
   and every one of the 51 required tokens resolves — as a `test/theme.test.ts`.
2. Manual: `/theme sema` and `/theme sema-light` live in Pi; tune from there.
```
