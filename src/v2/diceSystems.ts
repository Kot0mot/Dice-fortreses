import type { V2MatchState } from "./matchState.js";
import { BUILDING_CATALOG, DICE_TEMPLATES } from "./catalog.js";
import { rollCustomDie, type RolledDieResult } from "./customDie.js";
import type { Rng } from "../types.js";
import { applyResourceGains, recalculateCaps } from "./economy.js";
import type { ResourceBag } from "./resources.js";

/** Получить список шаблонов кубов от всех рабочих зданий игрока */
export function getDicePoolDefinitions(state: V2MatchState, player: 0 | 1): string[] {
    const pool: string[] = [];
    for (const b of state.buildings.values()) {
        if (b.owner === player && b.isOperational) {
            const def = BUILDING_CATALOG[b.defId];
            if (def && def.diceContribution) {
                for (const contrib of def.diceContribution) {
                    for (let i = 0; i < contrib.count; i++) {
                        pool.push(contrib.templateId);
                    }
                }
            }
        }
    }
    return pool;
}

/** Начальный бросок в начале хода */
export function rollInitialDice(state: V2MatchState, rng: Rng): { results: RolledDieResult[]; nextState: V2MatchState } {
    // Сначала чиним все генераторы в начале хода
    const buildings = new Map(state.buildings);
    for (const [id, b] of buildings) {
        if (b.owner === state.currentPlayer && !b.isOperational) {
            buildings.set(id, { ...b, isOperational: true });
        }
    }
    const nextState = { ...state, buildings };

    const templates = getDicePoolDefinitions(nextState, state.currentPlayer);
    const results = templates.map((tid, idx) => {
        const def = DICE_TEMPLATES.get(tid)!;
        return rollCustomDie(def, `die-${state.currentPlayer}-${idx}`, rng);
    });
    return { results, nextState };
}

/** Применение результатов кубов к экономике и состоянию */
export function applyDiceResults(state: V2MatchState, results: readonly RolledDieResult[]): V2MatchState {
    const gains: ResourceBag = {};
    const buildings = new Map(state.buildings);

    for (const r of results) {
        if (r.yield.resourceId && r.yield.amount) {
            const rid = r.yield.resourceId;
            gains[rid] = (gains[rid] ?? 0) + r.yield.amount;
        }
        if (r.yield.effectId === "disable_generator") {
            // Выводим случайный генератор игрока из строя на 1 ход
            const playerGenerators = Array.from(buildings.values()).filter(
                b => b.owner === state.currentPlayer && BUILDING_CATALOG[b.defId].kind === "generator" && b.isOperational
            );
            if (playerGenerators.length > 0) {
                const target = playerGenerators[0]!; // Упрощенно первый попавшийся
                buildings.set(target.id, { ...target, isOperational: false });
            }
        }
    }

    const caps = recalculateCaps(state, state.currentPlayer);
    const currentEco = { ...state.economy[state.currentPlayer], caps };
    const nextEco = applyResourceGains(currentEco, gains);

    const newEconomy = [...state.economy] as [any, any];
    newEconomy[state.currentPlayer] = nextEco;

    return {
        ...state,
        economy: newEconomy,
        buildings,
    };
}
