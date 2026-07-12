---
name: ux-check
description: Validate a screen, flow, component, or copy for behavioural-UX soundness AND ethical persuasion against the six UX psychology principles (smart defaults, goal gradient, reciprocity, IKEA/endowment, loss aversion/status-quo, contrast) reinterpreted for an offline, no-signup, single-user finance app. Use to confirm each persuasive or motivational choice is present, honest, reversible, and free of dark patterns - drawing on docs/design/ui-ux-principles.md and docs/financial-knowledge.md section 9. Delegates to the design-validator role; read-only (reports, never edits).
context: fork
agent: design-validator
disable-model-invocation: true
arguments: [target]
---

# UX check: is it behaviourally sound and ethically persuasive?

Validate **$1** (a screen like `home` / `add-transaction`, a flow like the two-step add or backup,
a `shared/ui` component like `app-goal-progress-row`, an FR id like `FR-3.1`, or a piece of copy)
on two axes: **behavioural soundness** (does the design apply the six UX psychology principles where
they genuinely help the user?) and **ethics** (is every persuasive choice honest, reversible, and
free of dark patterns - reinterpreted for an offline app with no accounts, signup, subscription, or
ads).

> Delegation: this skill forks into the **`design-validator`** subagent - the same read-only persona
> `/design-check` uses, here narrowed to the psychology-and-ethics lens. If `context: fork` is not
> honored by this build, spawn it explicitly with the Agent tool (`subagent_type: design-validator`)
> and pass this same instruction. The validator is **read-only** - it produces findings, it does not
> fix them. No new persona is required.

## How this differs from /design-check and /finance-check (compose, don't overlap)
- **/design-check** owns design-system conformance + WCAG 2.2 AA + UX-law *layout* soundness (thumb
  zone, tokens, Lucide icons, the five states, contrast ratios, tap targets, motion).
- **/finance-check** owns money *correctness* + low-literacy usability (money math, categorisation,
  MUR formatting, jargon).
- **/ux-check** (this) owns the *behavioural* layer: whether persuasive and motivational choices are
  present, honest, and ethical. It checks *whether* a smart default / progress / anchor exists and is
  ethical - never whether it is accessible (that is `/design-check`) or numerically correct (that is
  `/finance-check`).
- Clean splits at the shared touch points: **over-budget** - ux-check judges "loss aversion used
  gently, not weaponised"; design-check judges "state uses icon+label not colour alone, passes
  contrast"; finance-check judges "the over-by amount is correct". **Goal progress** - ux-check judges
  "goal-gradient: non-zero, momentum, truthful"; design-check judges "progress bar is token-driven and
  accessible"; finance-check judges "progress math from minor units is right". **Smart default value** -
  ux-check judges "is it the most-likely, reversible choice"; finance-check judges "is MUR / the
  category correct"; design-check judges "is the field labelled and on-system".

## Procedure
1. **Resolve the target `$1`** and gather intent: the relevant sections of
   `docs/design/ui-ux-principles.md` (the six principles are named there - cite them:
   Goal-Gradient and Zeigarnik and Tesler's Law and Von Restorff and Peak-End all in section 1.4,
   smart defaults also in section 1.6/2.9/3.4, dark patterns in section 4, the decision checklist in
   section 5); `docs/financial-knowledge.md` section 9 (behavioural biases - loss aversion at
   lambda approx 2.25, endowment effect, status-quo bias, anchoring, framing); and the screen/flow
   spec in `docs/design/screens.md`, `docs/design/ux-blueprint.md` section 5 (special states,
   over-budget rule), and `docs/design/design-system.md`.
2. **Trace what exists:** the feature component + template (`src/app/features/...`), the presentational
   pieces (`src/app/shared/ui/...`), the routed flow (`src/app/app.routes.ts` and the two-step add
   flow), and the copy shown to the user. Progress and comparison figures come from Rust minor units
   via `core/bridge` - confirm the persuasion rides on real data, not a TS-side cosmetic fudge.
3. **Run the six-principle checklist (below)** plus the ethics lens. For each principle, ask: is it
   *applied where it helps*, is it *honest* (built on true data, never fabricated), and is it
   *reversible* (the user stays in control)?

## The six-principle checklist (the actual questions)

**P1 - Smart Defaults** (beat decision fatigue; Iyengar jam study 24 vs 6 choices -> 3% vs 30%
purchase). Anchor: ui-ux-principles section 1.4 (Tesler's Law), 1.6, 2.9, 3.4.
- Does every new form pre-fill the single most-likely value instead of a blank field (currency = MUR,
  date = today, account = last-used or the only account, category = the one just chosen in the
  two-step add flow)?
- Are visible choices minimised to a short, curated set rather than the full taxonomy dumped at once
  (Hick's Law)?
- Is the default drawn from the user's own prior behaviour where available (last-used account,
  most-used category), not an arbitrary first-in-list?
- Is the default always visible and one tap to change - never a hidden auto-commit (ties to the
  no-auto-commit rule for OCR and import)?

**P2 - Goal Gradient Effect** (momentum accelerates near the finish; the pre-stamped loyalty card
doubled completion). Anchor: ui-ux-principles section 1.4 (Goal-Gradient + Zeigarnik), 3.4.
- Do progress indicators (savings goals, budget-month, onboarding, backup) show accumulated progress
  rather than a bare empty bar, and never render a literal 0% where real progress exists?
- HONESTY GUARD: for a genuinely-zero goal, momentum framing must be truthful (count the goal-creation
  day, an existing seed balance, or "first Rs X gets you started") - never fake progress the user has
  not made.
- Do multi-step flows show remaining effort ("step 2 of 3") so the near-complete state pulls the user
  through (Zeigarnik)?
- Does completing a goal or closing a budget-month get a clear peak/end moment (Peak-End, section 1.4)
  rather than a silent reset?

**P3 - Reciprocity** (deliver value BEFORE asking for commitment; Cialdini). REINTERPRETED: there is no
signup or paywall, so reciprocity means the app front-loads genuine usefulness before it asks the user
to invest setup work. Anchor: ui-ux-principles section 3.4 (empty states + onboarding), 1.6.
- Before asking the user to invest setup effort (define envelopes, add accounts), does the screen
  first give something useful - a teaching empty state with a real example, the pre-seeded category
  taxonomy (financial-knowledge section 2), a working default view?
- Is the core value (record an expense, see where money goes) reachable with near-zero setup, so value
  precedes commitment?
- Is a heavier ask (set a budget, enable biometric lock) deferred until after the user has felt some
  value, and framed as a benefit to them?
- DARK-PATTERN GUARD: no manufactured debt, guilt, or "we gave you X, now do Y". Reciprocity here is
  honest front-loaded utility, never a manipulative favour.

**P4 - IKEA / Endowment Effect** (people value what they build and own; Duolingo). Anchor:
financial-knowledge section 9 (endowment effect); ui-ux-principles section 3.4, 1.6.
- Does the flow let the user build and customise their own setup (rename categories, arrange
  envelopes, name goals) so they feel ownership, rather than a rigid fixed structure?
- Is effort already invested (transactions logged, goal named, budget tuned) made visible so its
  perceived value grows?
- Is user-built state preserved, never silently discarded (for example the lossless in-progress entry
  carried across the two-step category re-pick, ADR 0004)?
- ETHICS GUARD: ownership must be real, not a lock-in trap. Because the app is offline and export-first,
  the user genuinely owns exportable data - verify the "investment" is their own data they can take
  with them, not a sunk-cost trap that punishes leaving.

**P5 - Loss Aversion / Status-Quo Bias** (pain of loss weighted about 2x the pleasure of gain;
Kahneman, lambda approx 2.25). Anchor: financial-knowledge section 9 (loss aversion, status-quo bias);
design.md over-budget rule; ux-blueprint section 5.
- Where an outcome is framed, is it framed honestly around what the user keeps or protects ("Rs X
  left") as well as spends - used to motivate saving, not to shame?
- CRITICAL cross-check with design.md: over-budget must be **gentle, not punitive** - do not flip to
  alarm-red at 100%. Verify approaching / over / well-over gradations, informational phrasing ("Rs Y
  over"), and that loss aversion is not turned into anxiety.
- Does status-quo bias work in the user's favour (good defaults persist, lazy recurrence keeps
  savings going) without trapping them?
- DARK-PATTERN GUARD: never invent a loss - no fake streak breakage, no artificial deadline, no FOMO -
  to pressure the user. Any "you could lose progress" message must be truthful and low-pressure.

**P6 - Contrast Effect** (numbers are judged relative to a nearby anchor). REINTERPRETED: with no
pricing, this means financial figures carry a truthful reference anchor. Anchor: financial-knowledge
section 9 (anchoring) and section 2 (variance analysis); ui-ux-principles section 1.3 (hierarchy),
3.6 (data-dense financial screens).
- Are money figures shown with a meaningful, TRUTHFUL comparison anchor (spent vs budget, this month
  vs last, goal saved vs target, base-currency amount beside the foreign amount) rather than a bare
  number the user cannot judge?
- Is the anchor honest and relevant (real prior data), never a decoy or an inflated reference chosen to
  flatter or alarm?
- Visually, is the primary figure the focal point with the anchor secondary (hierarchy, section 1.3),
  so contrast aids comprehension rather than confusing it?
- SCOPE: the correctness of the comparison math (variance, base conversion) is `/finance-check`'s job;
  ux-check only checks that a comparison anchor is present and framed to help judgement.

## Ethics lens (cross-cutting, always run)
Anchor: ui-ux-principles section 4 (anti-patterns / dark patterns) and section 5 checklist item 10.
- Zero dark patterns: no confirmshaming, forced continuity, hidden costs, hard cancellation, asymmetric
  accept/reject, or privacy misdirection. Most are structurally impossible offline - verify none crept
  in (destructive-action confirms are symmetric; delete/archive is discoverable, not hidden).
- Retention is earned by genuine value and honest momentum - never manufactured guilt, fake scarcity,
  streak pressure, or nagging.
- No manipulative notifications or badges. This app has no background scheduler by design (battery
  rule) - confirm none was smuggled in to host a "re-engagement" mechanic.
- Every persuasive choice is transparent and reversible; the user keeps clear back/exit control.
- Because there is no signup, account, subscription, or ads, confirm NO such mechanic was invented as a
  vehicle for a principle.

## Output
A prioritized list: **Item -> Principle (P1-P6 or Ethics) -> Finding (applied / missing /
mis-applied / unethical) -> Evidence (`file:line` or `docs/design/ui-ux-principles.md` section x /
`docs/financial-knowledge.md` section 9) -> Severity -> Suggested follow-up** (which role/skill:
`fullstack-engineer` + `new-screen`/`ui-component`, `bug-hunter`, `gap-analysis`, `doc-align`,
`design-check`, `finance-check`). Lead with high-severity findings. Flag any place a principle is
applied dishonestly (fabricated progress, invented loss, manufactured debt) as high severity - an
ethics defect outranks a missed opportunity.

## Anti-patterns
- Don't fix anything - this is validation only. Hand actionable findings to the implementer.
- Don't invent signup, paywall, subscription, ads, streaks, or push notifications to "apply" a
  principle - that contradicts the product and the battery/offline rules. Reinterpret ethically or
  report the principle as not-applicable here.
- Don't recommend faking data to satisfy a principle: endowed progress, comparison anchors, and loss
  framing must all be built on true minor-unit data from Rust. Fabrication is a defect, not a design.
- Don't stray into `/design-check`'s lane (tokens, contrast ratios, tap targets, states, motion) or
  `/finance-check`'s lane (money math, MUR formatting, jargon) - reference them as follow-ups instead.
- `ui-ux-principles.md` is a principles reference, not a backlog - flag behavioural/ethics defects, not
  missing scope. A genuine v1 feature gap goes to `gap-analysis`.

## References
`docs/design/ui-ux-principles.md` (six principles in section 1.4/1.6/3.4, dark patterns section 4,
checklist section 5), `docs/financial-knowledge.md` section 9 (behavioural biases) and section 2
(taxonomy, variance analysis), `docs/design/{ux-blueprint,screens,design-system}.md`,
`.claude/rules/{design,frontend}.md`, `docs/adr/0004-*` (two-step add flow, lossless re-pick). Pair
the follow-up with **`design-check`** when the fix is layout/accessibility, **`finance-check`** when
it is the numbers or jargon, **`gap-analysis`** when a finding is really a missing feature, or
**`doc-align`** when it is a stale doc rather than wrong code.
