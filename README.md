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
- Экспериментальный **v2 sandbox**:
  - консоль: `npm run v2:play` (сид: `V2_SEED` / `SEED` или `node dist/v2Cli.js --seed=123` после `npm run build`);
  - веб: `npm run web:dev` → в меню кнопка **«Режим v2 (песочница)»** (сид из поля Seed в меню, если пусто — случайный при входе).
  - если после правок в браузере «как будто старый» фронт: полная перезагрузка вкладки (**Ctrl+Shift+R**) или остановить/снова запустить `web:dev` — dev-сервер не использует `npm run build` из `tsc`.

## v2 sandbox (experimental)

Отдельный минимальный слой в `src/v2/` для будущего расширенного режима — **не** полный игровой цикл классического MVP.

**Сейчас есть:**

- кастомный куб (6 граней, ресурс + количество) и равновероятный бросок в `customDie.ts`;
- каталог построек/шаблонов кубов в `catalog.ts`, стартовое «ядро-генератор» даёт два одинаковых кубика в пуле;
- сетка v2 задаётся в `constants.ts` (больше, чем 12×8 у classic);
- `matchState.ts`, `mapTypes.ts`, `dicePool.ts` — состояние поля и пул кубиков;
- экономика со складами и капами в `economy.ts`: приём ресурсов с **отбросом излишка** («discard» сверх капа), см. комментарий к `applyResourceGains`;
- интерактивная консоль: `src/v2Cli.ts`, скрипт `npm run v2:play`.

**Пока нет (задумки следующих этапов):**

- отдельных модулей `technology.ts`, `combatTypes.ts`, `lineOfFire.ts`, `buildingDefs.ts` и т.п.;
- размещения построек с `tryPlaceBuilding`, стоимостью и tech gating из v2-слоя;
- UI для режима v2.

Публичный реэкспорт из основного входа пакета: `import { gameV2 } from "dice-fortresses"` (см. `src/index.ts`).

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

### Web UX (Этап 1)

- интерфейс веб-версии русифицирован (меню, панели, подсказки, лог, endgame, onboarding);
- добавлен подробный экран `Как играть` с объяснением цели, фаз хода, Build/Fortify/Arm и примерами;
- в ходе матча показываются контекстные подсказки по фазам, включая отдельные пояснения «что делать» и «зачем это нужно» для Fortify и Arm.

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

- Локальные режимы только на одном устройстве: hot-seat и vs bot.
- Нет серверной части и сетевой синхронизации.
- Нет тяжёлой анимационной системы; только лёгкие CSS-подсветки и базовый UX-polish.
- Replay-демо сценарное и короткое (не полный матч).
- Web рендерит поле полной перерисовкой.

## Troubleshooting

- PowerShell chaining: используйте `;` вместо `&&`, если shell не поддерживает `&&`.
- Если `release:bundle` не создал `.zip`, используйте директорию-бандл в `release/` (она полностью готова к передаче).
