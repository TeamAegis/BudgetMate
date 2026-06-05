# Git hooks

Committed hooks that enforce the project's git discipline. Git does not use them automatically —
**enable once per clone**:

```sh
git config core.hooksPath .githooks
```

(The `harden-main` skill does this for you and re-checks it.)

## Hooks
- **`pre-push`** — blocks **direct pushes to `main`**. All changes go through a feature branch +
  PR (see `.claude/skills/feature-branch` and the "Git & CI workflow" section in `CLAUDE.md`). For
  a genuine one-off you can bypass with `git push --no-verify`, but don't make a habit of it.

## Why client-side?
Server-side branch protection / rulesets require a public repo or a paid GitHub plan; this repo is
private on free, so `main` is protected here via this hook + behavioural rules. See the
`harden-main` skill for the server-side upgrade path.
