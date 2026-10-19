# Rudiments Tracker v2 – project instructions for Claude Code

This repo is Paul's drum-rudiments practice tracker. It is a standalone project (NOT related to NIPO – never touch other folders under C:\Users\paul\.claude\projects).

## Task
Build **Rudiments Tracker v2** exactly per `reference/SPEC.md` (read it fully first). Inputs in `reference/`:
- `SPEC.md` – the agreed spec (source of truth).
- `rudiments-tracker.html` – working v1 (reuse its data model, exercise library, metronome/sync logic; localStorage keys `rimon-rudiments-v1*`).
- `Code.gs` – Google Apps Script sync endpoint (keep protocol compatible, or update it and say so).
- `rudiments-data-2026-10-17.json` – Paul's real data in v1 export format; v2 must import it.
- `setup-instructions-he.md` – Hebrew Sheets setup steps (update if anything changes).
- `warm-sand-light.jpg`, `warm-sand-dark.jpg`, `focus-mode.jpg` – visual references (match the feel, not the placeholder text).

## Hard requirements
- UI entirely **Hebrew, RTL** (`<html lang="he" dir="rtl">`). Right-side sidebar: בית / תרגול / התקדמות / ספרייה + הגדרות.
- "Warm Sand" light + dark themes, toggle remembered, default follows system.
- Plain HTML/CSS/JS; must work by opening `index.html` directly (file://) and on GitHub Pages. No server needed. If you use a build step, commit the built static output.
- Do NOT auto-change or suggest tempos. Ratings log working tempo only; never overwrite clean max.
- Migrate v1 localStorage on first load; import v1 JSON exports.
- Desktop + tablet (touch), large touch targets; don't break on small screens.

## Workflow
1. Work on branch `v2` (`git checkout -b v2`). Commit in logical steps with clear messages.
2. Automated tests with **Playwright** (`npm i -D @playwright/test`, `npx playwright install chromium`): v1 migration/import, auto-advance + rating logging, keyboard shortcuts, weekly measurement, theme toggle, sync posts to a mocked endpoint. All tests must pass.
3. Screenshots of every screen (בית, תרגול, focus mode, מדידה שבועית, התקדמות, ספרייה, הגדרות) in **light and dark**, desktop (1440x900) and tablet (1024x768) → `screenshots/` (commit them). A Playwright script for this is fine.
4. Hebrew `README.md`: what it is, open locally, enable GitHub Pages, set up Sheets sync, run tests.
5. `git push -u origin v2`. Open a PR v2 → main. `gh` CLI is NOT installed on this PC; if you can't open a PR, just push the branch and print the compare URL: https://github.com/Deadpaul134/-rudiments-tracker/compare/main...v2
6. Finish with a report (also save it as `REPORT.md`): what was built, test results, screenshot list, PR/compare link, and manual steps for Paul (redeploy Apps Script if Code.gs changed, enable Pages, etc.).

## Don'ts
- Don't touch anything outside this repo folder. Don't kill or restart other processes/apps (a Nipo server may be running).
- Never print or commit secrets/tokens. The Apps Script URL is configured by Paul in the app's settings – don't hardcode it.
- Don't force-push or rewrite `main`.
