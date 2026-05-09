import { describe, expect, it } from "vitest";

import { initializeTurnRerolls } from "../src/game.js";
import { DiceFortsRng } from "../src/random.js";
import { rollDiceFortsHand } from "../src/rules.js";
import { createInitialMatchState } from "../src/state.js";
import { isUiLockedForBotTurn, runBotTurn, shouldStartBotTurn } from "../web/bot-turn.js";

describe("web bot turn orchestration", () => {
    it("starts bot turn when vsBot reaches P1", () => {
        expect(shouldStartBotTurn("vsBot", 1, false, null)).toBe(true);
    });

    it("does not start bot turn in hot-seat mode", () => {
        expect(shouldStartBotTurn("hotseat", 1, false, null)).toBe(false);
    });

    it("locks user actions while bot acts", () => {
        expect(isUiLockedForBotTurn(true)).toBe(true);
        expect(isUiLockedForBotTurn(false)).toBe(false);
        expect(shouldStartBotTurn("vsBot", 1, true, null)).toBe(false);
    });

    it("bot turn emits valid actions for current state", () => {
        for (let seed = 1; seed <= 12; seed++) {
            let state = createInitialMatchState();
            state = { ...state, currentPlayer: 1 };
            state = initializeTurnRerolls(state);
            const rng = new DiceFortsRng(seed);
            const hand = rollDiceFortsHand(rng);
            const out = runBotTurn(state, hand, rng, "medium");

            expect(out.slotAssignments).toHaveLength(out.hand.length);
            expect(out.state.currentPlayer).toBe(0);
            if (out.armColumn !== null) {
                expect(out.armColumn).toBeGreaterThanOrEqual(0);
                expect(out.armColumn).toBeLessThan(state.width);
            }
        }
    });
});
