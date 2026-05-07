# Dice Fortresses MVP Handoff

## Architecture (high-level)

- `src/` contains core game rules, CLI flows, challenge/sim/playtest logic, and shared utilities.
- `web/` contains the lightweight browser UI layer over the same gameplay domain.
- `scripts/releaseBundle.mjs` builds distributable artifacts and writes release metadata.
- `demo/` and `smoke/` contain deterministic replay scenarios used for confidence checks.

## Run Commands

- Install: `npm install`
- Full gate: `npm run check`
- Smoke pack: `npm run smoke`
- Demo replay: `npm run demo`
- Web dev: `npm run web:dev`
- Build release bundle: `npm run release:bundle`

## Known Limitations (v0.1.0)

- Local hot-seat flow only; no multiplayer network mode.
- No backend service, account system, or cloud persistence.
- Replay/demo scenarios are narrow and do not cover full strategic depth.
- Web rendering and UX remain MVP-level (limited polish/performance tuning).
- Balance and AI heuristics are functional but not production-grade.

## v0.2 Priorities

1. Improve game feel and UX (visual feedback, better interaction flow, clearer affordances).
2. Expand deterministic scenario coverage (long-form replays and regression suites).
3. Improve AI/balance loop using accumulated sim/playtest telemetry.
