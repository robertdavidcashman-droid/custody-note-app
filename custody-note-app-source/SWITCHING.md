# Switching Devices (Conflict-Free Workflow)

Use this ritual when moving between your Mac, another laptop, or reviewing work from mobile/Chromebook.

## Before leaving any computer

```bash
git status
git add -A && git commit -m "WIP: describe your change"   # if needed
git push origin $(git branch --show-current)
```

## When arriving on any computer

```bash
git fetch
git checkout <your-branch>
git pull
```

## Rules

- **One feature branch per task** — avoid editing `main`/`master` on multiple devices.
- **Never edit the same branch on two machines** without pulling first.
- **Chromebook:** use [cursor.com/agents](https://cursor.com/agents) only — work lands as PRs.
- **Phone:** start/review Cloud Agents; merge PRs on desktop when ready.
- **Optional:** SSH into your main Mac (Remote SSH) to edit the same files without push/pull.

## Cloud Agents

This repo includes [`.cursor/environment.json`](./.cursor/environment.json) so Cloud Agents install dependencies consistently. Secrets belong in the Cursor dashboard (Cloud Agent secrets), not only in local `.env` files.
