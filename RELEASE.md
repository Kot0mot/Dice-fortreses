# RELEASE GUIDE (MVP)

## Quick Start

- CLI: `npm run proto`
- Web: `npm run web:dev`
- Demo replay: `npm run demo`

## One-command checks

- Full quality gate: `npm run check`
- Fast local gate: `npm run check:quick`
- Deterministic smoke pack: `npm run smoke`

## Release bundle

1. Run checks:
   - `npm run check`
   - `npm run smoke`
2. Build release:
   - `npm run release:bundle`
3. Deliverable in `release/`:
   - `dice-fortresses-mvp-<version>.zip` if available,
   - fallback: `dice-fortresses-mvp-<version>/` directory bundle.

## Included artifacts

- `dist/` (CLI/domain)
- `dist-web/` (web build)
- `README.md`
- `demo/` replay files
- optional latest `sim-results/*summary.json`
- `manifest.json` with:
  - version
  - build timestamp
  - git commit hash (if available)
  - included files list

## Known limitations

- No multiplayer networking.
- No backend.
- No major domain model refactor in MVP scope.

## Troubleshooting

- On Windows PowerShell, if chaining fails with `&&`, use `;`.
- If zip generation is unavailable, use the directory bundle artifact directly.
