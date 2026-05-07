import { describe, expect, it } from "vitest";

import { DICE_FORTS_DICE_MAX, DICE_FORTS_DICE_MIN } from "../src/constants.js";
import { BOT_REGISTRY } from "../src/sim/bots.js";
import { matchesCsv } from "../src/sim/metrics.js";
import { runSimulation } from "../src/sim/runSimulation.js";
import type { MatchState, PlayerId } from "../src/state.js";
import { createInitialMatchState } from "../src/state.js";

function mockState(playerId: PlayerId): MatchState {
    return { ...createInitialMatchState(), currentPlayer: playerId };
}

describe("simulation", () => {
    it("is deterministic for same seed/config", () => {
        const config = {
            matches: 20,
            seedStart: 77,
            maxRoundsPerMatch: 30,
            p0Bot: "aggro" as const,
            p1Bot: "tank" as const,
        };
        const a = runSimulation(config);
        const b = runSimulation(config);
        expect(a.aggregate).toEqual(b.aggregate);
    });

    it("smoke: summary has required structure", () => {
        const result = runSimulation({
            matches: 10,
            seedStart: 1,
            maxRoundsPerMatch: 20,
            p0Bot: "balanced",
            p1Bot: "balanced",
        });
        expect(result.aggregate.totalMatches).toBe(10);
        expect(result.matches.length).toBe(10);
        expect(typeof result.aggregate.averageRounds).toBe("number");
        expect(typeof result.aggregate.timeoutRate).toBe("number");
    });

    it("bots generate valid actions", () => {
        const hand = [DICE_FORTS_DICE_MIN, 3, 4, DICE_FORTS_DICE_MAX];
        for (const bot of Object.values(BOT_REGISTRY)) {
            const state = mockState(0);
            const slots = bot.pickSlots({ playerId: 0, state, hand, rerollsLeft: 1 });
            const allValues = [...slots.build, ...slots.fortify, ...slots.arm];
            expect(allValues.length).toBe(hand.length);
            const setA = [...allValues].sort((a, b) => a - b);
            const setB = [...hand].sort((a, b) => a - b);
            expect(setA).toEqual(setB);

            const buildCommands = bot.pickBuildCommands({ playerId: 0, state, budget: 6 });
            for (const cmd of buildCommands) {
                expect(cmd.spend).toBeGreaterThan(0);
                expect(cmd.x).toBeGreaterThanOrEqual(0);
                expect(cmd.y).toBeGreaterThanOrEqual(0);
                expect(cmd.x).toBeLessThan(state.width);
                expect(cmd.y).toBeLessThan(state.height);
            }

            const armColumn = bot.pickArmColumn({
                playerId: 0,
                state,
                resolution: {
                    buildPoints: 0,
                    fortifyCharges: 0,
                    arm: { max: 6, canFire: true, damage: 3, pierceDepth: 1 },
                },
            });
            if (armColumn !== null) {
                expect(armColumn).toBeGreaterThanOrEqual(0);
                expect(armColumn).toBeLessThan(state.width);
            }
        }
    });

    it("csv writer has expected columns", () => {
        const csv = matchesCsv([
            {
                matchId: 1,
                seed: 99,
                winner: 0,
                rounds: 8,
                coreHpP0: 10,
                coreHpP1: 0,
                rerollsUsedP0: 1,
                rerollsUsedP1: 0,
                timeout: false,
                coreDamageByP0: 9,
                coreDamageByP1: 2,
                buildSpentP0: 10,
                buildSpentP1: 8,
                fortifySpentP0: 4,
                fortifySpentP1: 5,
                armSpentP0: 7,
                armSpentP1: 6,
            },
        ]);
        const [header, row] = csv.split("\n");
        expect(header).toBe("matchId,seed,winner,rounds,coreHpP0,coreHpP1,rerollsUsedP0,rerollsUsedP1,timeout");
        expect(row).toContain("1,99,0,8,10,0,1,0,false");
    });
});
