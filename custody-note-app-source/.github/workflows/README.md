# Workflows moved to repo root

GitHub Actions only runs workflows from **`/.github/workflows/`** at the
repository root (`robertdavidcashman-droid/custody-note-app`).

Active workflows:

| File | Purpose |
|------|---------|
| `../../.github/workflows/auto-tag-release.yml` | Tag `v{version}` on main when package/changelog change |
| `../../.github/workflows/release-publish.yml` | Build + publish to **droid** updater feed + sync website |
| `../../.github/workflows/release-mac-only.yml` | Mac-only rebuild when notarization secrets exist |
| `../../.github/workflows/workspace-sync-check.yml` | Workspace health cron |

The YAML files in this folder are **stubs** and must not be treated as live CI.
See [`DEPLOY_ONCE.md`](../../../DEPLOY_ONCE.md).
