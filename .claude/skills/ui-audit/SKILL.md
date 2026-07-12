---
name: ui-audit
description: Audit an Angular screen, component, or feature area for UI QUALITY and RESPONSIVENESS the mechanical way - a grep-first, read-only sweep that scores design-token compliance, Lucide-only icons, the five required states, accessibility (tap targets, contrast, focus-visible, colour-not-alone, labels), performance budgets (lazy import/reports, Chart.js not eager, no prod source maps, cold-start), zoneless/OnPush signal correctness, and bridge-only IPC. Use as a self-check after building a screen and as a pre-PR gate. Read-only: it reports a scored checklist and routes qualitative depth to /design-check and /review-vault; it never edits.
disable-model-invocation: true
arguments: [target]
---

# UI audit: is the code on-system, accessible, responsive, and correct?

Audit **$1** (a screen like `home` / `transactions`, a `shared/ui` component like `app-header`,
a feature area like `goals` / `import`, or a diff) with a deterministic, grep-first sweep and score
it. Defaults to the working diff when `$1` is empty; falls back to all of `src/app` for a full sweep.

This is the mechanical counterpart to the two forking validators, and deliberately spans both of
their territories because a single grep pass crosses them:

- **`/design-check`** (forks `design-validator`) - qualitative UX-law and accessibility *judgement*
  (thumb zone, Hick, contrast ratios you must eyeball, screen-reader flow). Run it for the *why*.
- **`/review-vault`** (forks `code-reviewer`) - the full Vault invariant set incl. Rust/money/ACID.
  Run it for backend correctness.
- **`/ui-audit`** (this, standalone) - the *what*: a repeatable, scored checklist of the frontend
  rules that CAN be grepped, so drift and regressions surface fast and consistently.

> **Standalone, not a fork.** It does not spawn a persona subagent: the value is the deterministic
> sweep + score, which any role can run inline (the `fullstack-engineer` self-checking after
> `new-screen`, or `code-reviewer` inside `/review-vault`). Because the sweep straddles presentation
> and frontend correctness, forcing it into one subagent's scope would truncate it. It stays
> **read-only** - it produces findings and a score, it does not fix them; it hands qualitative depth
> to `/design-check` and invariant depth to `/review-vault`.

Rules it enforces (do not restate them here - read them): `.claude/rules/frontend.md`,
`.claude/rules/design.md`, `.claude/rules/tauri.md`, `.claude/rules/android.md`. Tokens live in
`src/styles/_tokens.scss`; the enforced guards live in `scripts/guards.mjs` and `eslint.config.js`.

## Procedure
1. **Resolve `$1`** to a file set: a screen/component folder under `src/app/features` or
   `src/app/shared/ui`, an area, or the diff (`git --no-pager diff --name-only main...HEAD`).
2. **Run the grep sweep** below (via the Grep tool / ripgrep) scoped to that file set. Every pattern
   is a *lead*, not a verdict - open the hit and confirm before scoring it.
3. **Confirm the states** by reading the component (grep cannot prove a state renders).
4. **Score each dimension** with the rubric, then compute the verdict. Lead the report with any
   hard-rule failure.
5. **Route depth**: hand contrast/UX-law/screen-reader judgement to `/design-check`, money and Rust
   invariants to `/review-vault`, a stale spec to `/doc-align`, a real fix to `bug-hunter` /
   `fullstack-engineer`.

## The grep sweep (exact patterns)
Scope each to the target. `-C` (code lines only), `-n` (line numbers). `[H]` = hard-rule dimension
(any confirmed hit fails the audit); `[A]` = advisory (weighs on the score, does not auto-fail).

### 1. Design-token compliance `[H]`
Components must use tokens only; `src/styles/**` and `design-tokens.json` are the allowed home of raw
values. `.claude/rules/design.md -> Tokens`.
```
# hardcoded hex in component styles/templates/inline styles (exclude the token files)
rg -n --glob 'src/app/**/*.{scss,html,ts}' '#[0-9a-fA-F]{3,8}\b'
# raw rgb/rgba/hsl literals in components (should be a --c-* token)
rg -n --glob 'src/app/**/*.{scss,ts}' '\b(rgba?|hsla?)\('
# hardcoded radius / shadow / z-index / blur (should be --radius-* / --elev-* / --z-* / --backdrop-*)
rg -n --glob 'src/app/**/*.scss' '(border-radius|box-shadow|z-index|backdrop-filter)\s*:\s*(?!.*var\()'
# hardcoded durations / easing (should be --motion-* / --easing)
rg -n --glob 'src/app/**/*.scss' '(transition|animation)[^;]*\b\d+m?s\b|cubic-bezier\('
# hardcoded px in component styles (0 and hairline 1px may pass; anything else needs a --space-*/metric token)
rg -n --glob 'src/app/**/*.scss' ':\s*[^;{}]*\b(?!0px|1px)\d+(\.\d+)?px'
```
Interpret: any confirmed component-level hex/shadow/duration/cubic-bezier literal is a fail. Bare
`px` and `rgba()` are usually fails too but check for a legitimate one-off (a `1px` hairline, a
`calc()` with an inset var); if genuinely needed, the rule is "add a token", not "inline it".

### 2. Lucide-only icons `[H]`
`@lucide/angular` is the single icon source; no ad-hoc SVG, no icon font, no second library.
`.claude/rules/design.md -> Icons`.
```
# a raw <svg> that is NOT a lucide directive (hand-rolled icon)
rg -n --glob 'src/app/**/*.{html,ts}' '<svg(?![^>]*lucide)'
# a second icon library or an icon font / CDN glyph
rg -ni --glob 'src/app/**/*.{ts,html,scss}' 'font-?awesome|@fortawesome|material-icons|glyphicon|\bfeather\b|heroicon|bi-[a-z]|ionicon'
# every lucide icon (then confirm interactive ones carry an accessible name)
rg -n --glob 'src/app/**/*.{html,ts}' 'lucide[A-Z]\w+'
```
Interpret: a hand-rolled `<svg>` icon or any non-Lucide icon source is a fail. For each `lucide`
inside a `<button>`/`<a>`/`(click)` host, confirm an `aria-label`/`title`; a decorative one beside
text should be `aria-hidden`. Missing accessible name -> [A] a11y finding (see dimension 4).

### 3. The five required states `[H] for missing populated/loading/empty/error`
Every data screen implements loading, empty (teaching CTA), populated, error, busy (ux-blueprint §5).
Grep gives a hint; you must read the template to confirm each renders.
```
# does the component branch on a state at all?
rg -n --glob 'src/app/features/**/*.{ts,html}' '@if|@switch|isLoading|error|empty|state\(|status'
# reuse of the shared state components (their presence is good evidence)
rg -n --glob 'src/app/features/**/*.{html,ts}' 'app-empty-state|app-skeleton|app-spinner|app-banner'
```
Interpret: a data screen with only the populated branch (no loading/empty/error) is a fail. `busy`
is required only where the screen runs a long op (OCR, import, export) - otherwise mark it N/A, not
fail. Special states (locked, over-budget, dedup-review, low-confidence-OCR) apply where relevant;
over-budget must be gentle (`.claude/rules/design.md -> States`), not alarm-red at 100%.

### 4. Accessibility `[H] for colour-only meaning; [A] for the rest`
```
# a focus outline killed without a :focus-visible replacement (keyboard trap for sighted keyboard users)
rg -n --glob 'src/app/**/*.scss' 'outline\s*:\s*(none|0)'
# is focus-visible handled anywhere in the target / globally?
rg -n --glob 'src/**/*.scss' ':focus-visible'
# the Android WebView blue tap flash (issue I1): confirm it is suppressed globally
rg -n --glob 'src/**/*.scss' '-webkit-tap-highlight-color'
# click handler on a non-interactive host (needs role + keydown, or should be a <button>)
rg -n --glob 'src/app/**/*.html' '<(div|span|li|img)\b[^>]*\(click\)'
# placeholder used as the only label (visible <label> required)
rg -n --glob 'src/app/**/*.html' '<input(?![^>]*aria-label)[^>]*placeholder='
# tap-target token actually used by interactive components
rg -n --glob 'src/app/**/*.scss' '--tap-target-min|min-(height|width)\s*:\s*var\(--tap-target'
# colour-only semantic: a semantic colour token with no sibling icon/sign/label (open each hit)
rg -n --glob 'src/app/**/*.{scss,html}' '--c-(positive|danger|warning)'
```
Interpret: signalling income/expense, over-budget, or dedup by colour alone is a fail - it must pair
with a sign, icon, or label. `outline:none`/`0` without a `:focus-visible` style is a fail. Contrast
you cannot grep (small coral text must be `--c-primary-700`, body 4.5:1, large 3:1) -> route to
`/design-check`. Tap targets `>= var(--tap-target-min)` (48px). Missing `aria-label` on an
interactive icon or a placeholder-only input is an [A] finding.

### 5. Performance budgets `[H] for prod source maps and eager Chart.js`
`.claude/rules/frontend.md -> Performance`, `angular.json` budgets.
```
# import (OCR) and reports (charts) must be lazy: they may only be reached via loadComponent in routes
rg -n --glob 'src/app/**/*.ts' "from '\./features/(import|reports)"
# Chart.js / ng2-charts must live only inside the lazy reports chunk, never an eagerly-loaded file
rg -n --glob 'src/app/**/*.ts' "from 'chart\.js'|from 'ng2-charts'"
# production build must NOT enable source maps (dev only)
rg -n --glob 'angular.json' 'sourceMap'
# no remote font/script/image/style anywhere (offline, NFR-P4)
rg -n --glob 'src/**/*.{scss,html,ts}' 'https?://|url\(\s*[\x27"]?//|@import\s+url\('
```
Interpret: an `import`/`reports` component reached by a static `import` (not `loadComponent`), or a
`chart.js`/`ng2-charts` import in a file that is in the initial chunk, breaks cold start -> fail. Any
`sourceMap: true` outside the `development` configuration is a fail. Any remote URL (font, script,
image, CDN) is a fail (also caught by the CSP/guards, flag it here too). Then run `npm run size` /
read the `angular.json` budgets (initial: warn 500kB / error 1MB; anyComponentStyle: warn 4kB /
error 8kB) and flag any `.scss` over 4kB.

### 6. Zoneless / OnPush signal correctness `[H]`
`.claude/rules/frontend.md -> Reactivity`. These are real bugs under zoneless CD.
```
# in-place mutation of a signal's value (a no-op under OnPush; must replace the reference)
rg -n --glob 'src/app/**/*.ts' '\w+\(\)\.(push|pop|shift|unshift|splice|sort|reverse|fill)\('
# @for without a track (DOM churn / wrong-row bugs) - list every @for, then confirm each has `track`
rg -n --glob 'src/app/**/*.html' '@for\b'
rg -n --glob 'src/app/**/*.html' '@for\b(?:(?!track).)*\)\s*\{'
# writes inside an effect (effect is for syncing OUT to imperative APIs, not deriving state)
rg -n --glob 'src/app/**/*.ts' 'effect\('
rg -n --glob 'src/app/**/*.ts' '\.(set|update)\('
# every component should declare OnPush (zoneless relies on it)
rg -n --glob 'src/app/**/*.ts' '@Component'
rg -n --glob 'src/app/**/*.ts' 'ChangeDetectionStrategy\.OnPush'
# event listeners must be cleaned up (leaked handlers -> duplicates)
rg -n --glob 'src/app/**/*.ts' '\blisten\(|\.subscribe\('
rg -n --glob 'src/app/**/*.ts' 'takeUntilDestroyed|unlisten|unsubscribe'
```
Interpret: a mutating array method on a signal read (`items().push(x)`) is a fail - use
`sig.update(a => [...a, x])`. Any `@for` without `track` is a fail. An `effect(...)` that `.set(...)`
another signal (deriving state) should be a `computed()` -> fail; reading + writing the same signal
in one effect is an infinite loop -> fail. A `@Component` without `changeDetection:
ChangeDetectionStrategy.OnPush` is an [A] finding. A `.subscribe(`/`listen(` with no
`takeUntilDestroyed`/`unlisten` on teardown is a leak -> [A] finding.

### 7. Bridge-only IPC and money-in-TS `[H]`
`.claude/rules/frontend.md -> Boundaries`, `.claude/rules/tauri.md`. eslint already blocks the import
under `**/*.ts`, but grep it here too so a diff review does not depend on lint running.
```
# @tauri-apps/api imported outside the one allowed place (src/app/core/bridge)
rg -n --glob 'src/app/{features,shared}/**/*.ts' "from '@tauri-apps/api"
# a raw invoke() outside the bridge
rg -n --glob 'src/app/{features,shared}/**/*.ts' '\binvoke\s*[<(]'
# money arithmetic / float formatting in TS (money math lives in Rust; TS only formats via the pipe)
rg -n --glob 'src/app/{features,shared}/**/*.ts' 'toFixed\(|parseFloat\(|Number\([^)]*minor|\*\s*100\b|/\s*100\b'
# amounts should render through the shared money pipe
rg -n --glob 'src/app/**/*.html' '\|\s*money'
```
Interpret: any `@tauri-apps/api` import or `invoke(` under `features`/`shared` is a fail (route it
through `core/bridge`). Any money arithmetic or `toFixed`/`parseFloat` on a `*_minor` value in TS is
a fail - format via the shared `money` pipe from integer minor units supplied by Rust.

## Scoring
For each of the 7 dimensions grade every check `[ok]` / `[warn]` / `[x]` and score the dimension:
```
dimension score = round(100 * (ok + 0.5*warn) / (ok + warn + fail))   # N/A checks excluded
overall score  = round(mean of the applicable dimension scores)
```
Verdict:
- **FAIL** if any hard-rule `[H]` check has a confirmed `[x]` (report those first), OR overall < 70.
- **PASS-WITH-WARNINGS** if no hard-rule failure and overall is 70-89.
- **PASS** if no hard-rule failure and overall >= 90.
A hard-rule failure always outranks a high score: two token violations fail the audit even at 95.

## Output
Start with the verdict line and overall score, then a per-dimension table, most-severe first:

```
UI audit: <target>   VERDICT: FAIL | PASS-WITH-WARNINGS | PASS   (overall NN/100)

| # | Dimension                 | Score | Worst | Notes |
|---|---------------------------|-------|-------|-------|
| 1 | Design tokens        [H]  | NN    | [x]   | 2 hardcoded hex |
| ...                                                            |

Findings (most severe first):
[x] <dimension> - <one-line defect> - src/app/.../file.ext:LINE - fix: <token/pipe/bridge/track...>
[warn] ...
```
Then a "Route depth" block: `/design-check <target>` (contrast, UX-law, SR flow), `/review-vault`
(money meaning, Rust/ACID/IPC invariants), `/doc-align` (stale `docs/design/screens.md` spec),
`bug-hunter` / `fullstack-engineer` + `new-screen` / `ui-component` (apply the fix). Never a fix here.

## Anti-patterns to reject (in this skill's own behaviour)
- Do not edit anything - this is a scored read-only report. Hand fixes to the implementer.
- Do not report a raw grep hit as a defect without opening the file to confirm it (a hex inside a
  comment, a `px` in a `calc()` with a var, a `chart.js` import already inside the lazy reports chunk
  are all false positives).
- Do not re-litigate contrast ratios or UX-law judgement by eye - that is `/design-check`. Do not
  audit Rust, money math, or ACID - that is `/review-vault`. Route, do not duplicate.
- Do not invent scope. A missing v1 feature is `gap-analysis`, not a UI-audit finding.
- Do not treat a dp/sp figure from a general guide as the target value - the token in
  `_tokens.scss` / `design-system.md` wins.

## References
`.claude/rules/{frontend,design,tauri,android,style}.md`, `src/styles/_tokens.scss`,
`scripts/guards.mjs`, `eslint.config.js`, `angular.json`, `docs/design/{screens,ux-blueprint,design-system}.md`.
Pairs with `new-screen` / `ui-component` (build to spec), `/design-check` and `/review-vault` (depth),
and `npm run lint && npm run guards && npm run build` (the machine gate this audit reads like a human).
