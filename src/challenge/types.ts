import type { BotName } from "../sim/types.js";

export type ChallengeRunStatus = "ongoing" | "victory" | "defeat";
export type StageWinner = "player" | "ai";

export interface RuntimeModifiers {
    coreHpBonus: number;
    startFortifyBonus: number;
    rerollsPerTurnBonus: number;
    armDamageOnSixBonus: number;
    pierceDepthBonus: number;
    firstCoreHitDamageReduction: number;
    freeRepairPerTurn: number;
}

export interface ChallengeConfig {
    stages: number;
    seed: number;
    maxRoundsPerMatch: number;
}

export interface ChallengeUpgradeDefinition {
    id: string;
    name: string;
    description: string;
    maxStacks: number;
    apply: (mods: RuntimeModifiers) => RuntimeModifiers;
}

export interface ActiveUpgrade {
    id: string;
    name: string;
    stacks: number;
}

export interface StageAiPreset {
    stage: number;
    label: string;
    bot: BotName;
    modifiers: RuntimeModifiers;
    rerollThresholdBonus: number;
}

export interface StageResult {
    stage: number;
    winner: StageWinner;
    rounds: number;
    playerCoreHp: number;
    aiCoreHp: number;
    durationMs: number;
    appliedUpgradeId: string | null;
}

export interface ChallengeRunState {
    readonly config: ChallengeConfig;
    readonly currentStage: number;
    readonly wins: number;
    readonly losses: number;
    readonly status: ChallengeRunStatus;
    readonly playerModifiers: RuntimeModifiers;
    readonly aiModifiers: RuntimeModifiers;
    readonly aiPreset: StageAiPreset;
    readonly activeUpgrades: readonly ActiveUpgrade[];
    readonly history: readonly StageResult[];
}

export function createEmptyModifiers(): RuntimeModifiers {
    return {
        coreHpBonus: 0,
        startFortifyBonus: 0,
        rerollsPerTurnBonus: 0,
        armDamageOnSixBonus: 0,
        pierceDepthBonus: 0,
        firstCoreHitDamageReduction: 0,
        freeRepairPerTurn: 0,
    };
}
