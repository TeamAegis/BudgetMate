# Rules - Writing style (code & docs)

Applies to every file in the repo except where carved out below. Enforced by the style check in
`scripts/guards.mjs` (run by `npm run guards`).

## Banned characters
- No em dash (U+2014). Rewrite: split the sentence, or use a comma, a colon, parentheses, or a spaced
  ASCII hyphen. This is not a blind swap; a parenthetical aside needs rewording, not a character
  substitution.
- No en dash (U+2013). Numeric or date ranges use an ASCII hyphen or the word "to".
- No emoji anywhere: pictographs, regional-indicator flags, decorative dingbats (for example the
  check, cross, and warning glyphs), and anything carrying the U+FE0F variation selector.

## Not banned (do not "fix" these)
- Typographic arrows (`->`, drawn as the single-glyph arrow) are allowed and used meaningfully in
  flow descriptions; they are neither dashes nor emoji.
- The ASCII hyphen `-` and ordinary punctuation are fine.

## Carve-outs (mandatory tooling, exempt)
- The PR-body trailer `🤖 Generated with [Claude Code](https://claude.com/claude-code)` is required by
  the harness and the `feature-branch` skill. It is exempt; the guard whitelists that exact line.
- The commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` has no
  emoji or dash; keep it verbatim.
- The root `README.md` may use emoji (only there). Em and en dashes are still banned in `README.md`.

## CLI / terminal glyphs
- Use ASCII status markers in script and hook output: `[x]` (error), `[ok]` (success), `[warn]`
  (warning). Do not use the cross, check, or warning dingbats (U+2716, U+2714, U+26A0); ASCII is
  portable on the Windows dev target and keeps one rule with no code carve-out.

## Semantic symbols in prose
- Symbols that carry meaning are replaced by text, not deleted. The Mauritius marker is the text
  `(MU)` or the word "Mauritius", never a flag emoji.

## Enforcement
- `npm run guards` fails on any banned character outside the carve-outs. When you change the guard,
  verify that the single-glyph arrows and the whitelisted trailer line are not flagged, and that the
  root `README.md` is exempt for emoji only (not for dashes).
