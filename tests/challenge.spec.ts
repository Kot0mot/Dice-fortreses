import { describe, expect, it } from "vitest";

import { createDiceFortsRng } from "../src/random.js";
import { applyStageResult, createChallengeRunState, runChallengeWithCallbacks } from "../src/challenge/run.js";
import { applyUpgradeToRun, drawUpgradeChoices } from "../src/challenge/upgrades.js";

describe("challenge mode", () => {
    it("applies selected upgrade modifier", () => {
        const run = createChallengeRunState({ stages: 3, seed: 7 });
        const upgraded = applyUpgradeToRun(run, "fortify_plus_1");
        expect(upgraded.playerModifiers.startFortifyBonus).toBe(1);
        expect(upgraded.activeUpgrades.find((u) => u.id === "fortify_plus_1")?.stacks).toBe(1);
    });

    it("moves stage-to-stage on victory and stops on defeat", () => {
        const start = createChallengeRunState({ stages: 3, seed: 12 });
        const afterStage1 = {
            stage: 1,
            winner: "player" as const,
            rounds: 6,
            playerCoreHp: 15,
            aiCoreHp: 0,
            durationMs: 10,
            appliedUpgradeId: null,
        };
        const stage2 = {
            ...afterStage1,
            stage: 2,
            winner: "ai" as const,
            playerCoreHp: 0,
            aiCoreHp: 4,
        };
        const onWin = applyStageResult(start, afterStage1);
        expect(onWin.status).toBe("ongoing");
        expect(onWin.currentStage).toBe(2);
        const onLoss = applyStageResult(onWin, stage2);
        expect(onLoss.status).toBe("defeat");
    });

    it("upgrade offers are deterministic for the same seed", () => {
        const run = createChallengeRunState({ stages: 3, seed: 99 });
        const offerA = drawUpgradeChoices(run, createDiceFortsRng(500), 3).map((u) => u.id);
        const offerB = drawUpgradeChoices(run, createDiceFortsRng(500), 3).map((u) => u.id);
        expect(offerA).toEqual(offerB);
    });

    it("smoke: challenge callback runner supports stages=2", async () => {
        const initial = createChallengeRunState({ stages: 2, seed: 3 });
        let stageCounter = 0;
        const result = await runChallengeWithCallbacks(
            initial,
            async (state) => {
                stageCounter += 1;
                return {
                    stage: state.currentStage,
                    winner: "player",
                    rounds: 5,
                    playerCoreHp: 10,
                    aiCoreHp: 0,
                    durationMs: 1,
                    appliedUpgradeId: null,
                };
            },
            async (_state, offer) => offer[0] ?? null
        );
        expect(stageCounter).toBe(2);
        expect(result.status).toBe("victory");
        expect(result.history).toHaveLength(2);
    });

    it("applies upgrades only after stage victory, not after defeat", async () => {
        const initial = createChallengeRunState({ stages: 3, seed: 77 });
        let pickUpgradeCalls = 0;
        const result = await runChallengeWithCallbacks(
            initial,
            async (state) => ({
                stage: state.currentStage,
                winner: state.currentStage === 1 ? "player" : "ai",
                rounds: 3,
                playerCoreHp: state.currentStage === 1 ? 8 : 0,
                aiCoreHp: state.currentStage === 1 ? 0 : 9,
                durationMs: 1,
                appliedUpgradeId: null,
            }),
            async (_state, offer) => {
                pickUpgradeCalls += 1;
                return offer[0] ?? null;
            }
        );
        expect(pickUpgradeCalls).toBe(1);
        expect(result.status).toBe("defeat");
        expect(result.activeUpgrades.length).toBe(1);
    });
});
