# Workflows moved to repo root

GitHub Actions only runs workflows from **`/.github/workflows/`** at the
repository root (`robertdavidcashman-droid/custody-note-app`).

Active workflows:

| File | Purpose |
|------|---------|
| `../../.github/workflows/auto-tag-release.yml` | Tag `v{version}` on main when package/changelog change |
| `../../.github/workflows/release-publish.yml` | Build + publish to `robertcashman-bit` updater + sync website |
| `../../.github/workflows/publish-updater-feed.yml` | One-click mirror of an existing droid release → bit feed |
| `../../.github/workflows/workspace-sync-check.yml` | Workspace health cron |

The YAML files in this folder are **stubs** and must not be treated as live CI.
See [`DEPLOY_ONCE.md`](../../../DEPLOY_ONCE.md).
