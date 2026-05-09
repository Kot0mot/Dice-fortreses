import type { BuildCommand } from "../../src/game.js";
import type { DiceFortsRng } from "../../src/random.js";
import type { MatchState, PlayerId } from "../../src/state.js";
import type { DiceFortsSlotResolution, DiceFortsSlots } from "../../src/types.js";

export type BotDifficulty = "easy" | "medium" | "hard";

export interface BotDecisionLog {
    reroll: string;
    slots: string;
    build: string;
    arm: string;
}

export interface BotTurnPlan {
    reroll: boolean;
    slots: DiceFortsSlots;
    buildCommands: BuildCommand[];
    armColumn: number | null;
    log: BotDecisionLog;
}

export interface BotPlanningContext {
    readonly difficulty: BotDifficulty;
    readonly playerId: PlayerId;
    readonly state: MatchState;
    readonly hand: readonly number[];
    readonly rerollsLeft: number;
    readonly rng: DiceFortsRng;
}

export interface BotPostSlotsContext {
    readonly difficulty: BotDifficulty;
    readonly playerId: PlayerId;
    readonly state: MatchState;
    readonly hand: readonly number[];
    readonly resolution: DiceFortsSlotResolution;
    readonly rng: DiceFortsRng;
}
