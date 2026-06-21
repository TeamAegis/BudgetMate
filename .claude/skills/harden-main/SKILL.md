---
name: harden-main
description: Install and verify the protections that keep main unbroken - the committed Git pre-push hook and core.hooksPath. Use after cloning, when the hook isn't firing, or to set up branch protection if the repo becomes public/paid. Explains why enforcement is client-side here and documents the server-side upgrade path.
---

# Harden main

`main` must stay green and PR-only. On this repo, enforcement is **client-side** because
server-side branch protection isn't available (see below).

## Client-side enforcement (works now - do this)
1. The repo ships `.githooks/pre-push`, which blocks direct pushes to `main`. Enable hooks once
   per clone:
   ```sh
   git config core.hooksPath .githooks
   ```
2. Verify it's active and executable:
   ```sh
   git config core.hooksPath            # -> .githooks
   git ls-files -s .githooks/pre-push   # mode should be 100755
   ```
3. Verify it blocks main (only fires when there's something to push, so do it from a branch with a
   commit ahead of main):
   ```sh
   git push --dry-run origin HEAD:main  # -> rejected by pre-push
   ```
   Pushing a feature branch must still succeed.

If the hook isn't firing: confirm `core.hooksPath` is set, the file is executable (`100755`;
re-set with `git update-index --chmod=+x .githooks/pre-push`), and you're actually pushing new
commits to `main` (an up-to-date push is a no-op and skips the hook).

The matching behavioural rules live in CLAUDE.md ("Git & CI workflow") and the `feature-branch` /
`merge-pr` skills.

## Why client-side?
`TeamAegis/BudgetMate` is **private on a free plan**, so classic branch protection and rulesets are
unavailable - `gh api repos/TeamAegis/BudgetMate/branches/main/protection` returns **403**
("Upgrade to GitHub Pro or make this repository public"), and `gh ruleset` is view-only in the CLI.

## Server-side upgrade path (when public or on a paid plan)
Once available, add real protection requiring a PR and the CI status check. Template (run after the
CI workflow exists so the check name is real - see `new-workflow` / issue #5):
```sh
gh api -X PUT repos/TeamAegis/BudgetMate/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  -f required_status_checks.strict=true \
  -f 'required_status_checks.contexts[]=gate' \
  -F enforce_admins=true \
  -F required_pull_request_reviews.required_approving_review_count=0 \
  -F restrictions=null
```
(Or define an equivalent repository **ruleset** in the GitHub UI.) Keep the local hook too - it
gives fast feedback before a push even reaches GitHub.
