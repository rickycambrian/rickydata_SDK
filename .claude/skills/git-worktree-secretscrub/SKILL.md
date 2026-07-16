---
name: git-worktree-secretscrub
description: Use when creating a clean SDK worktree fails because the secretscrub smudge script is unavailable before checkout.
allowed-tools: Bash(git:*)
---

# Git worktrees with the secretscrub filter

## Purpose

Create an isolated SDK worktree when Git tries to run the repository-local
`secretscrub` smudge script before that script has been checked out.

## Verified

2026-07-16 — successfully created a detached worktree from `origin/main` after
the ordinary `git worktree add` failed because the filter command could not find
its repository-local script.

## Setup / Prerequisites

- Run from the `rickydata_SDK` checkout.
- Fetch the target ref first if its current remote state matters.
- Choose a path that does not already exist as a registered worktree.

## Commands

```bash
git -c filter.secretscrub.smudge=cat \
  -c filter.secretscrub.required=false \
  worktree add --detach /private/tmp/rickydata-sdk-session-manifest-20260716 origin/main

git -C /private/tmp/rickydata-sdk-session-manifest-20260716 status --short --branch
```

The `-c` settings apply only to this Git invocation. They do not rewrite the
repository's configured filter.

## Gotchas

- **Symptom:** worktree checkout fails because `scripts/secretscrub-filter.sh`
  cannot be executed.
  **Cause:** the smudge command runs while checkout is creating the worktree, so
  its repository-local script is not available yet.
  **Fix:** use the invocation-scoped `smudge=cat` and `required=false` settings
  shown above.
- Use `--detach` when `main` is already checked out in another worktree. Push a
  verified commit explicitly with `git push origin HEAD:main` only after syncing
  with the current remote head.

## Quick Reference

```bash
git -c filter.secretscrub.smudge=cat -c filter.secretscrub.required=false worktree add --detach /private/tmp/rickydata-sdk-session-manifest-20260716 origin/main
```
