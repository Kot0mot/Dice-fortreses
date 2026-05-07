import { getStageAiPreset } from "./aiPreset.js";
import { createDiceFortsRng } from "../random.js";
import { applyUpgradeToRun, createBasePlayerModifiers, drawUpgradeChoices } from "./upgrades.js";
import type { ChallengeConfig, ChallengeRunState, StageResult } from "./types.js";

export function normalizeChallengeConfig(config: Partial<ChallengeConfig>): ChallengeConfig {
    const stagesRaw = config.stages ?? 3;
    const stages = Number.isInteger(stagesRaw) ? Math.min(5, Math.max(1, stagesRaw)) : 3;
    const seed = Number.isInteger(config.seed) ? (config.seed as number) : 1;
    const maxRoundsPerMatch = Number.isInteger(config.maxRoundsPerMatch)
        ? Math.max(10, config.maxRoundsPerMatch as number)
        : 60;
    return { stages, seed, maxRoundsPerMatch };
}

export async function runChallengeWithCallbacks(
    initial: ChallengeRunState,
    playStage: (state: ChallengeRunState) => Promise<StageResult>,
    pickUpgrade: (state: ChallengeRunState, offerIds: readonly string[]) => Promise<string | null>
): Promise<ChallengeRunState> {
    let run = initial;
    while (run.status === "ongoing") {
        let stageRes = await playStage(run);
        run = applyStageResult(run, stageRes);
        if (stageRes.winner === "player" && run.status === "ongoing") {
            const rng = createDiceFortsRng(run.config.seed + stageRes.stage * 101);
            const offer = drawUpgradeChoices(run, rng, 3);
            const pickedId = await pickUpgrade(run, offer.map((u) => u.id));
            if (pickedId) {
                stageRes = { ...stageRes, appliedUpgradeId: pickedId };
                run = { ...run, history: [...run.history.slice(0, -1), stageRes] };
                run = applyUpgradeToRun(run, pickedId);
            }
        }
    }
    return run;
}

export function createChallengeRunState(configInput: Partial<ChallengeConfig>): ChallengeRunState {
    const config = normalizeChallengeConfig(configInput);
    const preset = getStageAiPreset(1);
    return {
        config,
        currentStage: 1,
        wins: 0,
        losses: 0,
        status: "ongoing",
        playerModifiers: createBasePlayerModifiers(),
        aiModifiers: preset.modifiers,
        aiPreset: preset,
        activeUpgrades: [],
        history: [],
    };
}

export function applyStageResult(state: ChallengeRunState, result: StageResult): ChallengeRunState {
    const history = [...state.history, result];
    if (result.winner === "ai") {
        return {
            ...state,
            losses: state.losses + 1,
            history,
            status: "defeat",
        };
    }

    const wins = state.wins + 1;
    if (wins >= state.config.stages) {
        return {
            ...state,
            wins,
            history,
            status: "victory",
            currentStage: state.config.stages,
        };
    }
    const nextStage = state.currentStage + 1;
    const nextPreset = getStageAiPreset(nextStage);
    return {
        ...state,
        wins,
        history,
        currentStage: nextStage,
        aiPreset: nextPreset,
        aiModifiers: nextPreset.modifiers,
    };
}
