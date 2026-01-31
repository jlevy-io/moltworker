---
name: wrangler-github
description: Use when working with wrangler secrets, deploying via wrangler, tailing logs, creating PRs, or managing branches in the moltworker repo. Covers the fork/upstream gotcha.
---

# Wrangler & GitHub Workflow

## Wrangler Secrets

```bash
# Set a secret
npx wrangler secret put SECRET_NAME

# List all secrets (names only, not values)
npx wrangler secret list

# Delete a secret
npx wrangler secret delete SECRET_NAME

# Bulk set from .dev.vars file (local dev only)
# .dev.vars is gitignored and used by `wrangler dev`
```

Secrets are bound to the worker at runtime. The container only receives them via `buildEnvVars()` at process startup — see the `add-env-var` skill for the full chain.

## Dev vs Deploy

| Command | What it does |
|---|---|
| `npm start` | `wrangler dev` — runs worker locally with remote bindings |
| `npm run dev` | Vite dev server — for admin UI development only |
| `npm run build` | Vite build (admin UI + worker bundle) |
| `npm run deploy` | Build + `wrangler deploy` (also rebuilds container image) |

For local dev with secrets, create `.dev.vars`:
```
ANTHROPIC_API_KEY=sk-...
DEV_MODE=true
```

## Tailing Logs

```bash
# Live worker logs (all requests + console output)
npx wrangler tail moltbot-sandbox

# Filter by status
npx wrangler tail moltbot-sandbox --status error

# Filter by search string
npx wrangler tail moltbot-sandbox --search "gateway"
```

## GitHub Workflow

### Branch Rules

**Never commit directly to main.** All changes go through PRs:

```bash
# Create feature branch
git checkout -b feature/my-change

# Work, then verify
npm test && npm run typecheck

# Commit and push
git add <files>
git commit -m "feat: description"
git push -u origin feature/my-change
```

### Creating PRs (Fork Gotcha)

`gh pr create` defaults to **upstream** (`cloudflare/moltworker`), not the fork. Always specify:

```bash
gh pr create --repo jlevy-io/moltworker \
  --title "feat: description" \
  --body "## Summary
- What changed

## Test plan
- [ ] npm test passes
- [ ] npm run typecheck passes"
```

### Syncing with Upstream

```bash
git fetch upstream
git merge upstream/main
```

### Useful gh Commands

```bash
# List open PRs on the fork
gh pr list --repo jlevy-io/moltworker

# View a specific PR
gh pr view 123 --repo jlevy-io/moltworker

# Check PR status/checks
gh pr checks 123 --repo jlevy-io/moltworker

# Merge a PR
gh pr merge 123 --repo jlevy-io/moltworker --squash
```

## Git Remotes

| Remote | Repo | Use |
|---|---|---|
| `origin` | `jlevy-io/moltworker` | Push branches here |
| `upstream` | `cloudflare/moltworker` | Pull updates from here |

## Pre-Commit Hook

The repo has a hook (`.claude/hooks/protect-main-branch.sh`) that prevents direct commits to main via Bash. If a commit is blocked, create a branch first.

## Quick Reference

| Task | Command |
|---|---|
| Set secret | `npx wrangler secret put NAME` |
| List secrets | `npx wrangler secret list` |
| Local dev | `npm start` (needs `.dev.vars`) |
| Deploy | `npm run deploy` |
| Tail logs | `npx wrangler tail moltbot-sandbox` |
| Create PR | `gh pr create --repo jlevy-io/moltworker` |
| Sync upstream | `git fetch upstream && git merge upstream/main` |
| Run tests | `npm test` |
| Type check | `npm run typecheck` |
