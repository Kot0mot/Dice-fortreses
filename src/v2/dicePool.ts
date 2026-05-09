import type { RolledDieResult } from "./customDie.js";
import type { OwnerId } from "./mapTypes.js";

export interface DicePoolState {
    readonly owner: OwnerId;
    readonly rolledDice: readonly RolledDieResult[];
    readonly heldIndices: readonly number[]; // Индексы кубиков, которые игрок решил оставить
}

export function createEmptyDicePool(owner: OwnerId): DicePoolState {
    return {
        owner,
        rolledDice: [],
        heldIndices: [],
    };
}
