# Mobile UI/UX Design Guide (Android / Material 3-Leaning, Transferable)

A decision-making reference for an AI coding agent. Every rule pairs an imperative instruction with a one-line rationale so each UI decision traces to a principle, not an aesthetic whim. Defaults lean Android/Material 3; principles transfer to iOS and the web.

> **How this fits BudgetMate (read first).** This is the **principles reference** — the *why* behind
> a UI decision. It is the knowledge base the **`design-validator`** role and the **`/design-check`**
> skill audit a screen, component, or blueprint against (the same way `finance-validator` /
> `/finance-check` use `../financial-knowledge.md`). It is a reference, **not** a feature backlog.
>
> BudgetMate is **Tauri 2 + Angular + system WebView (CSR static build) — not native Compose.** Apply
> the **transferable** principles directly (cognitive load, the UX laws, WCAG 2.2 AA, thumb zones,
> form/navigation/motion heuristics, the anti-patterns, the §5 checklist). Treat Material-3 /
> Compose-specific *mechanics* — `safeDrawing`/`safeGestures`, navigation rail, the `sp`/`dp` units,
> tone-based surface roles — as **intent**, realised here via:
> - **design tokens** in [`design-system.md`](design-system.md) + [`../../src/styles/_tokens.scss`](../../src/styles/_tokens.scss) (the concrete BudgetMate colours, type scale, spacing, radii, motion — the source of truth for actual values);
> - the **`visualViewport` inset workaround** for safe-area/keyboard (see [`../../.claude/rules/android.md`](../../.claude/rules/android.md)) — Android WebView's `env(safe-area-inset-*)` and keyboard resize are unreliable, so do **not** rely on the native APIs named below;
> - **CSS** + [`../../.claude/rules/design.md`](../../.claude/rules/design.md) (tokens-only, `@lucide/angular` icons, the shared money pipe, the five required states, the coral-on-white AA caveat, offline/no-CDN).
>
> Where a numeric here (e.g. 48dp, 16sp) differs from a BudgetMate token, the **token wins** — this
> guide gives the principle and the floor; `design-system.md` gives the binding value.

## TL;DR
- Anchor primary actions in the bottom third, size touch targets ≥48dp, keep body text ≥16sp at 4.5:1 contrast, and give feedback in <400ms — these four rules resolve most mobile usability failures.
- Justify every choice with a named principle (Fitts, Hick, Miller, WCAG 2.2, Material 3, NN/g); never produce decoration without a reason.
- Avoid the anti-patterns: tiny/crowded targets, hidden nav for primary destinations, color-only signaling, gratuitous motion, and dark patterns.

## How to Use This Guide
- Treat each rule as checkable. Format: **Rule** (imperative) → *Why* (principle).
- When a rule conflicts with a visual preference, the rule wins unless you can cite a stronger principle.
- Use Material 3 components/tokens by default; only build custom when a component genuinely doesn't exist (Jakob's Law + Tesler's Law).

---

# 1. Core UX Psychology Principles

## 1.1 Cognitive Load (intrinsic / extraneous / germane)
Cognitive Load Theory (Sweller) splits mental effort into three: **intrinsic** (inherent task difficulty), **extraneous** (waste created by poor design), **germane** (productive effort building mental models). Working memory is limited; mobile amplifies the squeeze via small screens, divided attention, and on-the-go use.
- **Rule:** Aggressively cut extraneous load — remove decorative clutter, redundant choices, and unlabeled icons. *Why: extraneous load is the only type fully under designer control; reducing it frees working memory for the task.*
- **Rule:** Break complex tasks into sequenced steps (one decision per screen for hard flows). *Why: respects intrinsic load that can't be removed, only chunked.*
- **Rule:** Keep patterns consistent across screens. *Why: consistency lets germane load build reusable schemas, so the app gets easier with use.*

## 1.2 Mental Models & Platform Conventions
- **Rule:** Use platform-standard components and gestures (Material bottom nav, back behavior, swipe-to-go-back). *Why: Jakob's Law — users spend most time in other apps and expect yours to behave the same.*
- **Rule:** Don't reinvent standard controls (date pickers, selects, switches). *Why: familiar controls match existing mental models and cut learning cost.*

## 1.3 Visual Hierarchy
Direct the eye using size, weight, color, contrast, spacing, and position.
- **Rule:** Establish one clear focal point per screen; use no more than ~3 contrast levels. *Why: NN/g — "if everything is contrasted, nothing stands out."*
- **Rule:** Encode hierarchy through contrast in value/saturation, not hue alone. *Why: NN/g — contrast against context (not the raw color) creates hierarchy, and it survives color-blindness.*
- **Rule:** Put the most important content and primary action where eyes land first (top for content, bottom third for the tap). *Why: position is a primary hierarchy signal and aligns with scanning + reach.*

## 1.4 The UX Laws (applied to mobile)
- **Hick's Law** (more choices = longer decisions): **Rule:** Limit primary nav to 3–5 destinations; defer the rest to a "More" menu or progressive disclosure. *Why: shrinks decision time and keeps targets tappable.*
- **Fitts's Law** (acquisition time ∝ distance/size): **Rule:** Make primary buttons large and near the thumb's resting arc; never small-and-far. *Why: bigger, closer targets are faster and lower-error.*
- **Miller's Law** (~7±2 working-memory items): **Rule:** Chunk content into labeled groups of ~5; don't force users to hold long lists in mind. *Why: matches working-memory limits.*
- **Jakob's Law:** **Rule:** Match platform conventions. *Why: familiarity reduces learning.*
- **Tesler's Law** (conservation of complexity): **Rule:** Absorb irreducible complexity into the product (smart defaults, autofill, format parsing), not onto the user. *Why: every system has complexity that must live somewhere — put it on the app.*
- **Postel's Law:** **Rule:** Be liberal in what inputs you accept (phone/date formats, spacing), strict/clear in output. *Why: tolerant inputs cut errors and friction.*
- **Doherty Threshold (<400ms):** **Rule:** Acknowledge every interaction within 400ms (ideally 100ms press feedback). *Why: Walter J. Doherty & Arvind J. Thadani, "The Economic Value of Rapid Response Time" (IBM Systems Journal, 1982), set the requirement at 400ms — replacing the prior 2-second standard — to keep users in flow and perceived control.*
- **Aesthetic-Usability Effect:** **Rule:** Invest in clean visual polish. *Why: users perceive attractive interfaces as easier to use and tolerate minor issues — but don't let polish hide real usability defects.*
- **Von Restorff / Isolation Effect:** **Rule:** Make the single most important action visually distinct (the only filled/high-emphasis button on screen). *Why: the distinct item is remembered and chosen.*
- **Serial Position Effect:** **Rule:** Place the most important nav/list items first and last. *Why: first and last items are best recalled.*
- **Peak-End Rule:** **Rule:** Engineer a positive peak and a strong ending (success confirmation, delightful microcopy) into key flows. *Why: people judge an experience by its peak and end, not the average.*
- **Zeigarnik Effect:** **Rule:** Show progress on incomplete tasks (checklists, "2 of 3 done"). *Why: unfinished tasks create memory tension that pulls users back.*
- **Goal-Gradient Effect:** **Rule:** Show visible progress that accelerates toward the finish (progress bars, endowed progress). *Why: motivation rises as the goal nears.*

## 1.5 Thumb Zones & One-Handed Use
Steven Hoober's 2013 UXmatters field study of 1,333 observations found grip distribution: "At 49%, the one-handed grip was most popular; 36% cradled the phone in one hand and jabbed with the finger or thumb of the other; and the remaining 15% adopted the two-handed posture." Josh Clark (*Designing for Touch*) separately estimates ~75% of interactions are thumb-driven. Screens split into easy (bottom-center "green"), stretch ("yellow"), and hard-to-reach ("red," top corners) zones, and the red zone grows as phones get bigger.
- **Rule:** Place primary actions and main navigation in the bottom-center zone. *Why: it's the comfortable thumb arc for one-handed use across handedness.*
- **Rule:** Keep destructive or rarely-used controls out of the easy zone; relegate top corners to non-critical items. *Why: prevents accidental taps and matches reach difficulty.*

## 1.6 Progressive Disclosure, Recognition, Feedback, Error Prevention
- **Rule:** Show core options first; reveal advanced ones on demand (accordions, "More," detail screens). *Why: NN/g — progressive disclosure improves learnability, efficiency, and error rate simultaneously.*
- **Rule:** Favor recognition over recall — show choices, recent items, and visible labels rather than requiring memory. *Why: recognizing is easier than recalling from scratch.*
- **Rule:** Give immediate, visible feedback for every action; confirm system status. *Why: closes the feedback loop and prevents repeated/erroneous taps.*
- **Rule:** Prevent errors before they happen (constrain inputs, confirm destructive actions, use smart defaults). *Why: prevention beats error messages.*

---

# 2. Industry-Standard Technical Best Practices

## 2.1 Touch Targets & Spacing
- **Rule:** Make touch targets ≥48×48dp on Android (≥44×44pt iOS), even when the visible icon is smaller (expand the hit area with padding). *Why: Material/Android baseline; 48dp ≈ 9mm, the comfortable finger size.*
- **Rule:** Keep ≥8dp between adjacent targets. *Why: Material — balances density and prevents mis-taps.*
- **Rule:** Meet WCAG 2.2 SC 2.5.8 (24×24px minimum, AA) as the floor, but design to 48dp. *Why: 24px is the legal minimum; 48dp is the usability standard. Meeting 2.5.5 Enhanced (44px) also satisfies 2.5.8.*

## 2.2 Typography
Material 3 type scale: five roles (display, headline, title, body, label) × three sizes. Defaults include Body Large 16sp/24sp line height, Body Medium 14sp, Title Large 22sp, Label Large 14sp.
- **Rule:** Set body text to ≥16sp (use the `sp` unit on Android, never `dp`/`px`). *Why: 16sp is comfortably legible and `sp` honors the user's system font-size preference.*
- **Rule:** Use a line height ~1.5× the type size for body copy. *Why: Material — tighter undermines flow, looser breaks cohesion.*
- **Rule:** Keep line length 40–60 characters across breakpoints. *Why: Material adaptive guidance for readability.*
- **Rule:** Use tabular (monospaced) figures for changing numbers, tables, clocks, and financial values. *Why: keeps digits optically aligned and stops layout jitter.*
- **Rule:** Don't disable font scaling; allow Dynamic Type up to large sizes without truncation. *Why: accessibility for low-vision users.*

## 2.3 Spacing System & Density
- **Rule:** Build all spacing/sizing on an 8dp grid (4dp for icons, type baselines, and fine adjustments). *Why: Material baseline; 8 divides cleanly across 1×/1.5×/2×/3× densities, avoiding blurry sub-pixel edges.*
- **Rule:** Express measurements in dp/sp, never px. *Why: dp/sp scale uniformly across screen densities.*
- **Rule:** Keep 48dp default-density targets; only offer denser components as an opt-in. *Why: Material — higher density components don't meet accessibility requirements by default.*

## 2.4 Color & Contrast
- **Rule:** Meet WCAG 2.2 AA contrast: 4.5:1 for normal text, 3:1 for large text (≥18pt/24px, or 14pt/18.66px bold) and for UI components/icons/focus indicators. *Why: SC 1.4.3 / 1.4.11 — legibility for low-vision users; computed ratios must not be rounded up.*
- **Rule:** Target 7:1 (AAA) for primary body text where feasible. *Why: compensates for ~20/80 vision loss without assistive tech.*
- **Rule:** Never convey information by color alone — pair color with icon, text, or pattern. *Why: SC 1.4.1 — red–green color-vision deficiency affects up to ~8% of males (≈1 in 12) and ~0.5% of females of Northern European descent.*
- **Rule:** Use Material 3 color roles (primary, secondary, tertiary, error, surface, surface-container, on-* pairs) rather than raw hex. *Why: on-* pairings are algorithmically contrast-safe (≥3:1) and theme/dark-mode aware.*

## 2.5 Accessibility
- **Rule:** Give every interactive element a semantic label / content description; ensure screen readers (TalkBack) announce role, state, and value. *Why: non-visual users navigate by these labels.*
- **Rule:** Order content top-down so the screen reader reads in logical sequence; set explicit focus order. *Why: screen readers follow source/semantic order, not visual layout.*
- **Rule:** Support dynamic type, switch/keyboard input, and touch accommodations; never auto-submit or impose time limits on input. *Why: motor and cognitive accessibility (WCAG 2.2).*
- **Rule:** Keep focused elements at least partially visible (don't let sticky headers/sheets fully cover them). *Why: WCAG 2.2 SC 2.4.11 Focus Not Obscured (AA).*
- **Rule:** Provide a single-pointer alternative to any drag interaction. *Why: WCAG 2.2 SC 2.5.7 Dragging Movements (AA).*
- **Rule:** Don't require re-entering previously supplied info; don't require memory/cognitive puzzles for auth (allow paste, password managers). *Why: WCAG 2.2 SC 3.3.7 Redundant Entry, 3.3.8 Accessible Authentication.*

## 2.6 Responsive / Adaptive Layout & Safe Areas
Material breakpoints (window size classes): compact, medium, expanded, large, extra-large. Layouts move from one pane to two/three panes as width grows.
- **Rule:** Drive layout off window size classes, not device models. *Why: window space is dynamic (split-screen, foldables); breakpoints cover the range.*
- **Rule:** At medium+ widths, swap bottom nav → navigation rail, and consider list-detail / supporting-pane / feed canonical layouts. *Why: Material adaptive guidance — uses extra space ergonomically; only swap functionally equivalent components.*
- **Rule:** Handle window insets — never hardcode bar/notch/gesture heights; query insets at runtime (Compose `safeDrawing`/`safeGestures`/`safeContent`; Views `systemBars()`/`displayCutout()`/`systemGestures()`). *Why: bar heights vary by device and nav mode (e.g., ~24dp gesture vs ~48dp 3-button nav bar).*
- **Rule:** Apps targeting Android 15 (SDK 35) draw edge-to-edge by default — apply `safeDrawing` insets so content isn't obscured by status/nav bars and cutouts. *Why: Android 15 behavior change; without inset handling, UI is clipped. Material 3 Scaffold handles most of this automatically; Material 2 components do not.*
- **Rule:** Keep tappable/swipeable controls out of the bottom home-indicator zone and away from the left/right back-gesture edges; use `setSystemGestureExclusionRects()` (≤200dp/edge) only as an escape hatch, never in the mandatory bottom zone. *Why: system gestures take priority; the bottom home gesture is mandatory and cannot be excluded.*

## 2.7 Performance & Perceived Performance
- **Rule:** Return lightweight feedback (press state, ripple) within ~100ms and meaningful response within 400ms. *Why: Doherty Threshold keeps users in flow.*
- **Rule:** Use skeleton screens (with subtle pulse) instead of blank screens or blocking spinners for content loads. *Why: stabilizes layout, reduces perceived wait, prevents content jumping.*
- **Rule:** Use optimistic UI for high-confidence actions (likes, comments, sends) — show success instantly, reconcile in background. *Why: separates acknowledgment (instant) from completion (async), staying under Doherty even with network latency.*
- **Rule:** For operations >1s, show progress; for >10s, show estimates and allow backgrounding. *Why: attention drifts after ~10s; progress manages expectations.*

## 2.8 Dark Mode, Theming & Elevation
- **Rule:** Define light and dark themes via design tokens / color roles; never hardcode hex in UI code. *Why: centralizes theming, enables DayNight switching and dynamic color.*
- **Rule:** In dark mode use Material 3 tone-based surface roles (surface-container-low/high/highest) for elevation; don't rely on shadows alone. *Why: M3 represents elevation with tonal overlays — higher surfaces are lighter; hardcoded backgrounds flatten the hierarchy.*
- **Rule:** Reserve `primary` for important actions; use secondary/tertiary/surface-variant for everyday UI. *Why: overusing primary destroys emphasis.*

## 2.9 Form Design
- **Rule:** Use a single-column, vertically stacked layout. *Why: matches mobile top-to-bottom scanning; eliminates horizontal scanning.*
- **Rule:** Place labels above fields (not placeholder-as-label). *Why: placeholders vanish on input and span full field width; top labels stay visible and aid recall.*
- **Rule:** Set the correct input type/keyboard per field (email, tel→numeric pad, number, date picker). *Why: reduces typing effort and input errors.*
- **Rule:** Validate inline after the user leaves a field (~500ms after they stop typing), not on every keystroke and not only at submit. *Why: premature validation flags empty/incomplete fields; submit-only validation forces error hunting.*
- **Rule:** Show errors inline next to the field, in human language, stating what's wrong and how to fix it; never clear the user's input on error. *Why: NN/g/Bargas-Avila — top-of-form errors raise memory load; clearing input punishes users.*
- **Rule:** Minimize fields; use autofill, smart defaults, and masked input. *Why: typing is high-cost on mobile; fewer fields = higher completion.*
- **Rule:** Use action-specific button labels ("Create account") over generic "Submit." *Why: clarifies outcome and lifts completion.*

## 2.10 Navigation
- **Rule:** Use a persistent bottom navigation bar for 3–5 top-level destinations. *Why: always-visible, thumb-reachable, and discoverable; hidden nav (hamburger) measurably reduces discoverability and task success.*
- **Rule:** Don't hide primary destinations behind a hamburger menu. *Why: NN/g (Pernice & Budiu, 179 participants, 6 sites) — "Discoverability is cut almost in half by hiding a website's main navigation. Also, task time is longer and perceived task difficulty increases."*
- **Rule:** If a hamburger/drawer is unavoidable (many categories), supplement it — surface key tasks on the home screen and/or repeat nav in the footer, and keep a visible, prominent search. *Why: supports navigation even when users never open the drawer.*
- **Rule:** Use a FAB for the single most important screen action; don't let it obscure content or list ends. *Why: Von Restorff emphasis without blocking content.*
- **Rule:** Always label icons unless universally understood (home, search, back). *Why: avoids "mystery meat" navigation.*
- **Rule:** Preserve platform back behavior and support deep linking. *Why: matches mental models and entry from notifications/links.*

## 2.11 Motion & Animation
Material 3 uses a physics/spring-based motion system (expressive and standard schemes). Legacy guidance: durations scale with distance/area, easing is asymmetric (standard, decelerate-in, accelerate-out, sharp).
- **Rule:** Make motion purposeful — show relationships, hierarchy, feedback, or continuity; never decorate for its own sake. *Why: motion should aid comprehension, not distract.*
- **Rule:** Keep transitions quick: small elements ~100ms, standard transitions ~200–300ms; incoming elements decelerate, exiting elements accelerate. *Why: fast enough to avoid waiting, slow enough to follow.*
- **Rule:** Respect the OS reduced-motion setting — replace slides/scales/parallax with subtle fades and disable decorative effects. *Why: motion sensitivity/vestibular accessibility.*
- **Rule:** Use platform-default forward/back transitions; reserve container-transform for hero moments, not deep hierarchies. *Why: defaults stay current and suit frequent, utilitarian transitions.*

---

# 3. Proven Layout Strategies

## 3.1 Bottom-Anchored Actions & Navigation
- **Rule:** Anchor the primary CTA and main nav in the bottom third. *Why: thumb-zone reach (Fitts + Hoober) improves speed and completion for one-handed use.*

## 3.2 Cards, Lists & Content Density
- **Rule:** Use cards to group related content into scannable, self-contained units; use lists for homogeneous sequential items. *Why: cards aid scannability and adapt to breakpoints; don't arbitrarily swap list↔card across breakpoints.*
- **Rule:** Match density to context — denser for power/data screens, looser for focused tasks and alerts. *Why: Material — never increase density on pickers, dialogs, or snackbars; it harms usability and prominence.*

## 3.3 Scanning Patterns & Above-the-Fold
- **Rule:** Structure content for the layer-cake scan — frequent, visually distinct, descriptive headings/subheadings with short body chunks between. *Why: NN/g — the layer-cake pattern is "by far the most effective way to scan pages."*
- **Rule:** Front-load meaning — make the first 3–5 words of headings and lines count. *Why: NN/g F-pattern — first lines and first words on each line get the most fixations; the F-pattern emerges when nothing guides the eye, so good hierarchy prevents it.*
- **Rule:** Put the most important content and value proposition above the fold. *Why: NN/g (Schade, "The Fold Manifesto") — "84% is the average difference in how users treat info above vs. below the fold," and eyetracking found 57% of viewing time is spent above the fold.*
- **Rule:** For image-led or weak-hierarchy promo screens, lay out along a Z-path ending at the CTA. *Why: the zig-zag/Z scan dominates uniform, image-based pages; guide it toward the action.*

## 3.4 Empty States & Onboarding
- **Rule:** Never ship a truly blank empty state — use it to teach: explain the value, show starter/sample content, and give a clear first action. *Why: NN/g — empty states are prime onboarding touchpoints; a blank one is a dead end.*
- **Rule:** Prefer in-context, just-in-time hints over forced upfront tutorials. *Why: NN/g — contextual cues are applied immediately and are more memorable.*
- **Rule:** Use progressive onboarding focused on one high-value task; collect preferences with quick taps and personalize via smart defaults. *Why: reduces friction and gets users to value fast (Zeigarnik + goal-gradient reinforce completion).*

## 3.5 Information Architecture for Small Screens
- **Rule:** Prioritize content over chrome; surface the few things users came for and defer the rest. *Why: screen space and attention are scarce on mobile.*
- **Rule:** Keep hierarchies shallow; minimize taps/scrolls/page loads to reach any destination. *Why: minimum interaction cost; avoid tedious nested-doll navigation.*

## 3.6 Data-Dense Screens (dashboards / financial)
- **Rule:** Show high-level summaries by default; put detail behind deliberate interaction (tap, expand, drill-down). *Why: progressive disclosure prevents overload while preserving power-user efficiency.*
- **Rule:** Enforce a strict design system for dense screens — shared spacing, type scale, and components; allow compact (32–36dp) controls and 14sp/20sp body where density is essential, but keep alerts and focused-task controls at full size. *Why: consistency drives pattern recognition and lowers learning cost; density must never compromise accessibility of critical controls.*
- **Rule:** Use tabular numerals and right-align numeric columns. *Why: optical alignment makes values scannable and comparable.*

---

# 4. Anti-Patterns to Avoid (with why)
- **Tiny touch targets (<48dp):** mis-taps, failed Fitts, fails WCAG target size. *Harmful: raises error rate and frustration.*
- **Targets too close (<8dp apart):** accidental activation of neighbors.
- **Hidden navigation for primary destinations (hamburger overuse):** NN/g — halves discoverability, raises task time and perceived difficulty.
- **Low-contrast text (<4.5:1):** illegible for low-vision and in sunlight; fails WCAG AA.
- **Color-only signaling:** invisible to color-blind users; fails SC 1.4.1.
- **Overuse of modals/interruptive dialogs:** breaks flow, raises extraneous load, trains users to dismiss without reading.
- **Infinite scroll where findability matters:** no sense of position, can't reach the footer, hard to relocate items — use Load More or pagination for task-oriented lists.
- **No clear back/exit:** violates user control; traps users.
- **Mystery-meat navigation (unlabeled icons):** forces recall and guessing.
- **Long forms / unclear errors / clearing input on error:** abandonment; punishes mistakes; raises memory load.
- **Janky or gratuitous animation; blocking spinners with no progress:** perceived slowness, distraction; ignores Doherty and reduced-motion needs.
- **Inconsistent components / needless reinvention of platform controls:** breaks Jakob's Law and pattern recognition; raises learning and maintenance cost.
- **Dark patterns (confirmshaming, forced continuity, hidden costs, hard cancellation, privacy misdirection, asymmetric accept/reject):** erode trust, harm users, and are increasingly illegal — the FTC enforces under Section 5 of the FTC Act (unfair/deceptive practices), and the EU bans them under the Digital Services Act (Art. 25) plus the Unfair Commercial Practices Directive; enforcement is active. *Always avoid: short-term gain, long-term trust and legal damage.*

---

# 5. Decision Checklist (run before finalizing any screen)
1. Is the primary action in the bottom-third thumb zone, visually distinct, and ≥48dp? *(Fitts, Von Restorff, Hoober)*
2. Are there ≤5 primary choices; is the rest progressively disclosed? *(Hick, progressive disclosure)*
3. Does body text pass ≥16sp and ≥4.5:1 contrast, with no color-only signals? *(WCAG 2.2 AA)*
4. Is all spacing on the 8dp grid, in dp/sp? *(Material)*
5. Do all interactions feedback within ~100–400ms, with skeletons/optimistic UI for waits? *(Doherty)*
6. Is navigation visible (not hidden) and are all icons labeled? *(NN/g, anti-mystery-meat)*
7. Are insets handled (edge-to-edge safe, gesture zones clear)? *(Android 15 / WindowInsets)*
8. Do forms use correct keyboards, top labels, inline human-readable errors, and preserve input? *(Postel, NN/g forms)*
9. Does motion respect reduced-motion and serve a purpose? *(Material motion, accessibility)*
10. Does every element justify its existence with a principle — and are there zero dark patterns? *(cognitive load, ethics)*

---

# 6. Recommendations (staged adoption)
- **Stage 1 — Foundations (do first):** Adopt Material 3 theme tokens (color roles, type scale, 8dp spacing), enforce 48dp targets and AA contrast, and wire up edge-to-edge inset handling. *These eliminate the highest-frequency defects.*
- **Stage 2 — Flow & feedback:** Add bottom nav (3–5 items), skeleton/optimistic loading, inline form validation, and bottom-anchored CTAs. *These lift task completion and perceived speed.*
- **Stage 3 — Polish & retention:** Add purposeful motion (respecting reduced-motion), engineered peak/end moments, progressive onboarding, and teaching empty states. *These improve satisfaction and retention.*
- **Benchmarks that change the plan:** If interaction feedback exceeds 400ms, prioritize perceived-performance work. If task-success or discoverability is low in testing, revisit navigation visibility and IA depth. If accessibility audit fails AA, halt feature work until contrast/targets/labels/focus pass.

---

# 7. Caveats
- **Sourcing currency:** Material 3 is actively evolving (M3 Expressive, physics-based motion, tone-based surfaces, renamed "breakpoints"); verify exact token names against current Material docs at implementation time.
- **Numeric specifics vary by device:** inset/bar heights differ by device and nav mode — always read from WindowInsets rather than the example dp values here.
- **Laws are heuristics, not guarantees:** UX laws (Hick, Fitts, Miller, etc.) are directional; validate with real usability testing, especially for novel or data-dense flows.
- **Some cited figures are secondhand:** conversion/engagement percentages from vendor blogs should be treated as indicative, not authoritative; the W3C, Material, Android Developers, and NN/g sources are the load-bearing ones.
- **Android 15 edge-to-edge timing:** the SDK 35 default-edge-to-edge behavior and any Play Store targeting deadlines should be reconfirmed against official Android Developers documentation before release.