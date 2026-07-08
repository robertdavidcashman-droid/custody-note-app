# CustodyNote — Cursor Workflow Guide

Reusable prompt patterns for working on this project in Cursor. Copy-paste and adapt as needed.

---

## A. Diagnose-First Prompt

Use when something is broken and you don't yet know the root cause.

```
Inspect the existing codebase and trace the execution flow for [describe symptom].

- Do not guess. Read the actual code.
- List every file you inspected and the relevant functions.
- Trace the code path from trigger to outcome.
- Identify the exact root cause with evidence.
- Do NOT fix anything yet — diagnosis only.
```

---

## B. Fix Prompt

Use after diagnosis is clear, or for straightforward changes.

```
Fix [describe problem]. Root cause is [from diagnosis].

- Implement the smallest robust fix.
- Preserve existing architecture — do not rewrite unrelated code.
- Add logging if the area lacks it.
- Explain why the fix works.
- Return full updated code for every changed file.
- List what to test and what could still fail.
```

---

## C. Harden Prompt

Use after a fix to prevent recurrence and improve resilience.

```
Harden [area] to prevent recurrence of [problem].

- Add loop/retry protection where restart or retry is possible.
- Add persistent logging for failure cases.
- Add guards against double execution.
- Provide a simple test plan.
- Explain residual risks.
```

---

## D. Electron-Specific Prompt

Use for any change touching main process, IPC, or app lifecycle.

```
This change involves Electron [main process / IPC / lifecycle].

Before making changes:
- Identify all related IPC handlers (ipcMain.handle/on).
- Check for duplicate lifecycle handlers (app.whenReady, window-all-closed).
- Verify main vs renderer responsibility boundaries.
- Check app.isPackaged guards for dev-only code.
- Show IPC channel names and their preload bridge mappings.
- Do not register duplicate listeners.
```

---

## E. Updater-Specific Prompt

Use for any change to the auto-update system. This area has caused multiple production incidents.

```
Inspect the auto-updater flow end to end before making changes.

Check:
- How many times are updater event listeners registered? (must be exactly once each)
- How many checkForUpdates call sites exist? (minimise)
- What is the quitAndInstall call path? (must be guarded against double-call)
- Is update state persisted (cn-auto-update-state.json)?
- Is version transition detected on startup (pending vs current)?
- Is there loop prevention (failedInstallCount >= MAX)?
- Is there a forced app.exit(0) timeout after quitAndInstall?

Do not modify updater code without answering all of the above.
```

---

## F. Build / Release Prompt

Use when changing build config, NSIS settings, or release scripts.

```
Before changing build/release config:
- Explain what the change does and why.
- Will it affect install path (user vs system)?
- Will it break auto-update for existing users?
- Does it affect the NSIS custom script (build/installer.nsh)?
- Has it been tested in packaged mode?
```

---

## G. UI Change Prompt

Use for renderer/CSS changes to avoid breaking the layout.

```
Making a UI change to [describe].

- Check existing CSS patterns in styles.css before adding new ones.
- Respect the existing design tokens (CSS custom properties).
- Test in both light and dark mode.
- Check that views display correctly (display:none / display:flex toggle).
- Do not use position:absolute for views — this caused blank screens previously.
- Verify scrollbars work (the app uses wide custom scrollbars).
```
