import { describe, expect, it } from "vitest";

import { initializeTurnRerolls } from "../src/game.js";
import { DiceFortsRng } from "../src/random.js";
import { createInitialMatchState } from "../src/state.js";
import { claimBotTurnLock, runBotTurn, shouldStartBotTurn } from "../web/bot-turn.js";
import { planBotTurn } from "../web/bot/strategies.js";
import { vulnerabilityScoreNearCore } from "../web/bot/evaluate.js";

class ScriptedRng extends DiceFortsRng {
    private readonly scripted: number[];
    private cursor = 0;

    constructor(values: number[]) {
        super(1);
        this.scripted = values;
    }

    override nextInt(min: number, max: number): number {
        const scriptedValue = this.scripted[this.cursor] ?? min;
        this.cursor += 1;
        const clamped = Math.max(min, Math.min(max, scriptedValue));
        return clamped;
    }
}

function botState() {
    let state = createInitialMatchState();
    state = { ...state, currentPlayer: 1 };
    return initializeTurnRerolls(state);
}

describe("web bot difficulty profiles", () => {
    it("easy can choose suboptimal build target with seeded rng", () => {
        const state = botState();
        const hand = [6, 4, 3, 2, 1];
        const easyPlan = planBotTurn({
            difficulty: "easy",
            playerId: 1,
            state,
            hand,
            rerollsLeft: 0,
            rng: new ScriptedRng([9999]),
        });
        const hardPlan = planBotTurn({
            difficulty: "hard",
            playerId: 1,
            state,
            hand,
            rerollsLeft: 0,
            rng: new ScriptedRng([0]),
        });
        const easyBuild = easyPlan.buildCommands[0];
        const hardBuild = hardPlan.buildCommands[0];
        expect(easyBuild).toBeDefined();
        expect(hardBuild).toBeDefined();
        if (!easyBuild || !hardBuild) return;
        const easyScore = vulnerabilityScoreNearCore(state, 1, easyBuild.x, easyBuild.y);
        const hardScore = vulnerabilityScoreNearCore(state, 1, hardBuild.x, hardBuild.y);
        expect(easyScore).toBeLessThanOrEqual(hardScore);
    });

    it("medium profile produces valid and stable actions", () => {
        for (let seed = 1; seed <= 10; seed++) {
            const state = botState();
            const rng = new DiceFortsRng(seed);
            const hand = [6, 5, 4, 3, 2];
            const out = runBotTurn(state, hand, rng, "medium");
            expect(out.slotAssignments).toHaveLength(hand.length);
            expect(out.state.currentPlayer).toBe(0);
            expect(out.buildCommands.every((cmd) => cmd.spend > 0)).toBe(true);
        }
    });

    it("hard chooses no worse build focus than easy in typical setup", () => {
        const state = botState();
        const hand = [6, 5, 4, 3, 2];
        const easy = planBotTurn({
            difficulty: "easy",
            playerId: 1,
            state,
            hand,
            rerollsLeft: 0,
            rng: new ScriptedRng([9999]),
        });
        const hard = planBotTurn({
            difficulty: "hard",
            playerId: 1,
            state,
            hand,
            rerollsLeft: 0,
            rng: new ScriptedRng([0]),
        });
        const easyBuild = easy.buildCommands[0];
        const hardBuild = hard.buildCommands[0];
        expect(easyBuild).toBeDefined();
        expect(hardBuild).toBeDefined();
        if (!easyBuild || !hardBuild) return;
        const easyScore = vulnerabilityScoreNearCore(state, 1, easyBuild.x, easyBuild.y);
        const hardScore = vulnerabilityScoreNearCore(state, 1, hardBuild.x, hardBuild.y);
        expect(hardScore).toBeGreaterThanOrEqual(easyScore);
    });

    it("orchestrator routes by selected difficulty", () => {
        const state = botState();
        const hand = [6, 5, 4, 3, 2];
        const easy = runBotTurn(state, hand, new ScriptedRng([0, 0]), "easy");
        const hard = runBotTurn(state, hand, new ScriptedRng([0, 0]), "hard");
        expect(easy.decisionLog.build.includes("лёгкий")).toBe(true);
        expect(hard.decisionLog.build.includes("сложный")).toBe(true);
    });

    it("bot turn guard prevents parallel launch when bot already acting", () => {
        expect(shouldStartBotTurn("vsBot", 1, false, null)).toBe(true);
        expect(shouldStartBotTurn("vsBot", 1, true, null)).toBe(false);
        expect(claimBotTurnLock("vsBot", 1, true, null)).toBe(false);
    });
});

