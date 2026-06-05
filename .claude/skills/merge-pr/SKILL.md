---
name: merge-pr
description: Land a pull request safely — verify all CI checks are green first and NEVER merge a PR with failing or pending checks. Use when finishing a PR or asked to merge. Watches checks, triages failures from logs, fixes on the branch, and only merges when green; refuses to bypass a red CI.
---

# Merge a PR (block failing CI)

**A PR with a failing or pending check is never merged.** Green means the gate
(lint/test/guards/cargo/clippy) passed; red means the change would break `main`.

## 1. Check status (block on red/pending)
```sh
gh pr checks <pr> --watch --fail-fast
```
- Exits non-zero on the first failure (`--fail-fast`) and watches pending checks to completion.
- For a machine-readable view: `gh pr checks <pr> --json name,bucket,state` — `bucket` is
  `pass | fail | pending | skipping | cancel`. Proceed only when **every** check is `pass`
  (`skipping` is acceptable; `fail`/`pending`/`cancel` are not).

## 2. On failure — triage and fix (don't merge)
```sh
gh run view --log-failed           # failed steps of the latest run
gh run view <run-id> --log         # full log for a specific run
```
Diagnose → fix **on the PR branch** → commit → `git push` → re-run step 1. Repeat until green.
Never edit `main` to "work around" a red branch.

## 3. Merge only when green
```sh
gh pr merge <pr> --squash --delete-branch
git switch main && git pull
```
- Squash keeps `main` history clean (one commit per PR). Use `--merge`/`--rebase` only if the
  user asks.
- If the repo requires review, ensure it's approved first (use built-in `/review` to self-review).

## Hard rules
- **Never** merge while any check is `fail`/`pending`/`cancel`.
- **Never** use `gh pr merge --admin`, `--force`, or `git push --no-verify` to bypass a red check.
- **No checks reported** (e.g. CI not built yet — issue #5): `gh pr checks` will say so / exit
  non-zero. Do **not** silently merge — surface that there is no CI coverage and ask the user for
  explicit go-ahead before merging.
- After merging, delete the branch (`--delete-branch`) and return to an updated `main`.
