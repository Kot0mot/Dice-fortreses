# Dice Fortresses Playtest Kit

## Quick start

- CLI playtest: `npm run proto -- --playtest`
- Web playtest: `npm run web:dev`, then open `http://localhost:5173/?playtest=1`

Playtest mode enables:
- short onboarding,
- local telemetry-lite session capture,
- end-of-match feedback + JSON/CSV export.

## First 10 minutes checklist

1. Start a fresh playtest session (CLI or Web).
2. Play normally and think aloud while making choices.
3. Finish at least one full match.
4. At the end, fill 3 ratings and optional comment.
5. Export JSON + CSV report.

## Try 3 styles

1. Aggressive:
   - prioritize Arm dice and early core pressure.
2. Defensive:
   - prioritize Fortify and repairs.
3. Mixed:
   - rebalance between Build/Fortify/Arm each turn based on board state.

## Where exported files are

- CLI: files are written to `playtest-results/<sessionId>.json` and `playtest-results/<sessionId>.csv`.
- Web: browser downloads `<sessionId>.json` and `<sessionId>.csv`.

## How to share results

- Send both exported files (`.json` + `.csv`) to the project owner/researcher.
- If possible, include any extra notes about confusing moments or memorable decisions.

## Aggregate multiple sessions

Run summary analytics over local JSON reports:

`npm run playtest:aggregate -- playtest-results/*.json`

If no paths are passed, the script reads JSON files from `playtest-results/`.
