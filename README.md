# Dice Fortresses

**Dice Fortresses** — hybrid of **Dice Kingdoms** and **Forts**: turn-based strategy with structural physics and dice-based economy.

## Key Features

- **Structural Physics:** Node-and-beam construction. Overload or break connections to cause collapses.
- **Dice Economy:** Your dice pool is determined by your buildings. Upgrade buildings to get superior dice.
- **Combat:** Multi-damage type system (Kinetic, Energy, Blast) with material-specific resistances.
- **Campaign:** Persistent stage-based progression with random perks.
- **Multiplayer:** 1v1 online multiplayer via Socket.io.
- **AI:** Smart opponent with 3 difficulty levels.

## Getting Started

1. Install dependencies: `npm install`
2. Run development web server: `npm run web:dev`
3. Build for production: `npm run web:build`
4. Run tests: `npm test`
5. Run server: `npm run server`

## Project Structure

- `src/`: Core game logic (physics, economy, combat).
- `web/`: Frontend (Canvas-based renderer, UI).
- `tests/`: Unit tests.
