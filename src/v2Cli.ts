/**
 * Dice Fortresses CLI - v2 Sandbox.
 */
import { DiceFortsRng } from "./random.js";
import { createInitialV2Match } from "./v2/matchState.js";
import { getDicePoolDefinitions, rollInitialDice, applyDiceResults } from "./v2/diceSystems.js";

async function main() {
    console.log("Dice Fortresses v2 Sandbox CLI");
    let state = createInitialV2Match();
    const rng = new DiceFortsRng(123);

    console.log(`Ход игрока ${state.currentPlayer}`);
    const pool = getDicePoolDefinitions(state, state.currentPlayer);
    console.log(`Пул кубиков: ${pool.join(", ")}`);

    const { results, nextState } = rollInitialDice(state, rng);
    state = nextState;
    console.log("Результаты броска:");
    results.forEach(r => console.log(`  - [${r.templateId}] грань ${r.faceIndex}: ${JSON.stringify(r.yield)}`));

    state = applyDiceResults(state, results);
    console.log("Экономика после броска:");
    console.log(JSON.stringify(state.economy[state.currentPlayer].resources));
}

main().catch(console.error);
