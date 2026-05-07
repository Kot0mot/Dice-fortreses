# Dice Fortresses (CLI + Web MVP)

Мини-прототип пошаговой игры с кубами и сеткой 12x8.

## Quick Start

```bash
npm install
```

- CLI prototype: `npm run proto`
- Web MVP: `npm run web:dev`
- Demo smoke replay: `npm run demo`
- CLI help:
  - `npm run proto -- --help`
  - `npm run challenge -- --help`
  - `npm run sim -- --help`

## One-command Quality Gate

- Full gate: `npm run check`
  - runs `lint -> test -> build -> web:build -> demo`
- Quick gate: `npm run check:quick`
  - runs `lint + test`

## Deterministic Smoke

- `npm run smoke:proto` - deterministic proto replay from `smoke/proto-demo.json`
- `npm run smoke:challenge` - deterministic challenge progression smoke from `smoke/challenge-demo.json`
- `npm run smoke` - both smoke scenarios

## Web Save / Load

В веб-интерфейсе в блоке Status доступны:
- `Save Run` — скачать текущий прогон в JSON;
- `Load Run` — загрузить ранее сохранённый JSON и продолжить с того же состояния.

Формат save-файла:
- `formatVersion` (сейчас `1.0`);
- `seed` и `rngState`;
- `uiState` и `matchState` (достаточно для продолжения хода);
- опциональный `log`.

Если версия не совпадает или JSON повреждён/неполный, UI не падает: показывается понятное сообщение об ошибке.

## Release Bundle

- `npm run release:bundle`
- Артефакты собираются в `release/`:
  - `dice-fortresses-mvp-<version>/` (всегда),
  - `dice-fortresses-mvp-<version>.zip` (если доступен штатный `Compress-Archive`),
  - `manifest.json`.

## Definition of Done (MVP)

- [x] CLI прототип играбелен и детерминируется seed/replay.
- [x] Web MVP умеет Save/Load без падений.
- [x] Есть challenge mode и симуляции.
- [x] Есть one-command quality gate (`npm run check`).
- [x] Есть deterministic smoke (`npm run smoke`).
- [x] Есть предсказуемый release bundle (`npm run release:bundle`).
- [x] Ключевые регрессионные риски покрыты тестами.

## Known Limitations

- Только локальная hot-seat игра (2 игрока на одном экране).
- Нет серверной части и сетевой синхронизации.
- Нет анимаций и продвинутого UX.
- Replay-демо сценарное и короткое (не полный матч).
- Web рендерит поле полной перерисовкой.

## Troubleshooting

- PowerShell chaining: используйте `;` вместо `&&`, если shell не поддерживает `&&`.
- Если `release:bundle` не создал `.zip`, используйте директорию-бандл в `release/` (она полностью готова к передаче).
