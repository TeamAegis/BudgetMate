---
name: feature-branch
description: Start and run any code change on an isolated branch off main (never commit/push work to main directly), then open a PR. Use whenever beginning a feature, bug fix, chore, or doc change — especially if asked to change code while on main. Keeps main's working code unbroken. Pairs with merge-pr (to land it) and the .githooks/pre-push guard.
---

# Work on a feature branch (never on main)

`main` must always hold working code. **Every change happens on its own branch + PR.** Direct
pushes to `main` are blocked by `.githooks/pre-push` (see `harden-main`), but the discipline is the
rule regardless — don't bypass it.

## When to use
- Starting any feature / fix / chore / docs / refactor.
- You're about to edit code and `git branch --show-current` says `main`.

## Branch from up-to-date main
```sh
git status                       # tree must be clean; commit or stash first
git switch main && git pull --ff-only
git switch -c <type>/<issue#>-<slug>
```
- **type** ∈ `feat` | `fix` | `chore` | `docs` | `refactor` (matches Conventional Commits).
- Include the GitHub issue number when there is one. Examples: `feat/6-manual-entry`,
  `fix/14-rule-ordering`, `chore/git-github-skills`.

## Commit (Conventional Commits + required trailer)
- Message: `type(scope): summary` — e.g. `feat(transactions): add manual entry form`. Body
  explains the *why*; keep PRs small and focused.
- **Every commit ends with** the mandated trailer:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.
- Run the local gate before pushing (see `run-app` / CLAUDE.md): lint, test, guards, cargo test,
  clippy.

## Push and open the PR
```sh
git push -u origin <branch>
gh pr create --fill   # or --title/--body
```
- PR body: short summary, **link the issue** (`Closes #N`), local-gate results, and the
  `🤖 Generated with [Claude Code](https://claude.com/claude-code)` line.
- Open as **draft** while WIP (`gh pr create --draft`); `gh pr ready` when the gate is green.
- Land it with the **`merge-pr`** skill (green CI required) — not by pushing to `main`.

## Keep the branch current
```sh
git fetch origin
git rebase origin/main      # or: git merge origin/main
```
Resolve conflicts, re-run the gate, force-with-lease if you rebased a pushed branch
(`git push --force-with-lease`).

## Don't
- Commit or push work to `main` (the hook blocks it; `--no-verify` only for a genuine one-off).
- Bundle unrelated changes into one branch/PR. One concern per PR.
- Leave the branch behind `main` for long — sync regularly.
