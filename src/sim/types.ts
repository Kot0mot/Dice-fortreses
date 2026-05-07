import type { BuildCommand } from "../game.js";
import type { MatchState, PlayerId } from "../state.js";
import type { DiceFortsSlotResolution, DiceFortsSlots } from "../types.js";

export type BotName = "aggro" | "tank" | "balanced";

export interface BotTurnContext {
    readonly playerId: PlayerId;
    readonly state: MatchState;
    readonly hand: readonly number[];
    readonly rerollsLeft: number;
}

export interface BotBuildContext {
    readonly playerId: PlayerId;
    readonly state: MatchState;
    readonly budget: number;
}

export interface BotArmContext {
    readonly playerId: PlayerId;
    readonly state: MatchState;
    readonly resolution: DiceFortsSlotResolution;
}

export interface BotStrategy {
    readonly name: BotName;
    shouldReroll(ctx: BotTurnContext): boolean;
    pickSlots(ctx: BotTurnContext): DiceFortsSlots;
    pickBuildCommands(ctx: BotBuildContext): BuildCommand[];
    pickArmColumn(ctx: BotArmContext): number | null;
}

export interface SimulationConfig {
    readonly matches: number;
    readonly seedStart: number;
    readonly maxRoundsPerMatch: number;
    readonly p0Bot: BotName;
    readonly p1Bot: BotName;
    readonly overrides?: SimulationOverrides;
}

export interface SimulationOverrides {
    readonly coreHp?: number;
}

export interface MatchSummary {
    readonly matchId: number;
    readonly seed: number;
    readonly winner: PlayerId | null;
    readonly rounds: number;
    readonly coreHpP0: number;
    readonly coreHpP1: number;
    readonly rerollsUsedP0: number;
    readonly rerollsUsedP1: number;
    readonly timeout: boolean;
    readonly coreDamageByP0: number;
    readonly coreDamageByP1: number;
    readonly buildSpentP0: number;
    readonly buildSpentP1: number;
    readonly fortifySpentP0: number;
    readonly fortifySpentP1: number;
    readonly armSpentP0: number;
    readonly armSpentP1: number;
}

export interface SimulationAggregateMetrics {
    readonly totalMatches: number;
    readonly p0Wins: number;
    readonly p1Wins: number;
    readonly draws: number;
    readonly winRateP0: number;
    readonly winRateP1: number;
    readonly averageRounds: number;
    readonly winRoundBuckets: {
        readonly rounds1to5: number;
        readonly rounds6to10: number;
        readonly rounds11plus: number;
    };
    readonly averageCoreDamagePerMatch: number;
    readonly averageRerollsPerMatch: number;
    readonly timeoutRate: number;
    readonly averageBuildSpentPerMatch: number;
    readonly averageFortifySpentPerMatch: number;
    readonly averageArmSpentPerMatch: number;
}

export interface SimulationResult {
    readonly config: SimulationConfig;
    readonly aggregate: SimulationAggregateMetrics;
    readonly matches: MatchSummary[];
}

export interface SweepRunSummary {
    readonly overrideLabel: string;
    readonly result: SimulationResult;
}
