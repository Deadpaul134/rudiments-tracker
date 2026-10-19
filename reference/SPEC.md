# Rudiments tracker v2 – build spec (agreed with Paul, 2026-10-19)

Repo: https://github.com/Deadpaul134/-rudiments-tracker (private, empty). UI entirely Hebrew, RTL.

## Starting point (files in this folder /workspace/rt-launch)
- rudiments-tracker.html – working v1 (single self-contained page, dark theme): goals (left flam 120->150, drag 90->110, doubles 165->180 by 30.10), 25-min daily routine of 5 steps with editable BPMs, week strip + streak, metronome + timer + full-routine mode, exercise library with sub-exercises and categories (rudiments, rolls incl. buzz, 5/6/7/9/10/11/13/15/17-stroke, open, triple-stroke; tests), separate "working tempo" vs "clean max" logging, export/import JSON, Google Sheets sync via Apps Script web app (settings: paste URL, test connection, sync all, offline queue, dedupe by entry id). localStorage keys start with rimon-rudiments-v1. Reuse its data model, library and logic.
- Code.gs – Apps Script receiving sync posts (tabs: מדידות, סשנים, גיבוי). Sheet id 1Qw_hqDivv3dbvwPwZaXj15y2h3I6JnDChWcW0ClDSuI. Keep protocol compatible or update Code.gs and say so.
- rudiments-data-2026-10-17.json – Paul's corrected data (v1 import format). v2 must import it and v1 exports, and migrate existing v1 localStorage on first load.
- setup-instructions-he.md – Hebrew Sheets setup steps; update if changed.
- warm-sand-light.jpg (chosen light theme), warm-sand-dark.jpg (matching dark mode), focus-mode.jpg (fullscreen practice focus reference). AI mockups: match the feel, not placeholder text.

## Devices
Desktop + tablet (touch). Big touch targets usable with a stick in hand. Should not break on small screens.

## Design: "Warm Sand"
Light: warm off-white/beige, terracotta/coral accent, soft rounded cards, subtle shadows, spacious and calm. Dark: warm brown-charcoal (not pure black), cream text, same accent. Theme toggle (remember choice, default follow system). Hebrew font (Heebo/Rubik/Assistant) with offline fallback.

## Structure (right-side sidebar)
1. בית – today's plan, streak, week strip, goals summary, big "התחל תרגול של היום" button.
2. תרגול – separate dedicated screen running the routine step by step, plus fullscreen focus mode (exercise name, huge BPM, timer line, beat dots, sticking, play).
3. התקדמות – charts per rudiment/sub-exercise, goals progress, hand comparison only across comparable subdivisions.
4. ספרייה – all rudiments/rolls/tests with sub-exercises, sticking, short how-to notes; add/edit custom exercises.
Settings: Sheets sync, theme, import/export, routine editor.

## Practice flow (Paul chose explicitly)
- Auto-advance: each step = 4-beat count-in, then metronome + step timer; at end a short sound, rating prompt, ~15s rest with next-step preview, next step starts automatically.
- Rating after each step: big buttons נקי / סביר / נשבר. Log working tempo + rating automatically (never overwrites clean max). Do NOT auto-change or suggest tempos – Paul sets tempos himself.
- Keyboard: Space start/pause; Up/Down tempo ±1 (Shift ±5); Right/Left (mind RTL) prev/next step; 1/2/3 ratings; F focus; Esc exit. Small shortcuts hint. Screen Wake Lock with fallback.
- Guided weekly measurement (מדידה שבועית): choose exercise/sub-exercise; start at comfortable tempo (default last clean max −20, editable), auto-rise +5 BPM every 30s (configurable). Press once at "hard", again at "break" → record last clean BPM, hard BPM, break BPM as clean-max measurement. Option to run whole weekly test list in sequence.
- Metronome sample-accurate (Web Audio look-ahead scheduling), accent on beat 1, optional subdivision clicks.

## Tech
Plain HTML/CSS/JS, no-build or tiny build with committed static output that works by opening index.html and on GitHub Pages. All client-side (localStorage/IndexedDB). Hebrew README (open locally, enable Pages, set up sync). Automated tests (e.g. Playwright): v1 migration/import, auto-advance + rating logging, keyboard shortcuts, weekly measurement recording, theme toggle, sync posts sent (mock endpoint).

## Done when
Works end to end in both themes on desktop and tablet viewports, tests pass, PR (or main push) on the repo. Report: screenshots of each screen light+dark, PR link, manual steps for Paul (redeploy Apps Script if changed, enable Pages).
