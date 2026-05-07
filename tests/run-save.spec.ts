import { describe, expect, it } from "vitest";

import { deserializeSavedRun, RUN_SAVE_FORMAT_VERSION, serializeSavedRun } from "../src/runSave.js";
import { createInitialMatchState, setCell } from "../src/state.js";

describe("run save format", () => {
    it("serializes and deserializes valid payload", () => {
        const match = createInitialMatchState();
        const patchedMatch = {
            ...setCell(match, 0, 1, { kind: "block", owner: 0, hp: 2, maxHp: 4 }),
            currentPlayer: 1 as const,
            winner: null as const,
        };
        const payload = {
            formatVersion: RUN_SAVE_FORMAT_VERSION,
            seed: 7,
            rngState: 1234,
            uiState: {
                round: 2,
                phase: "build" as const,
                hand: [1, 2, 3, 4],
                slotAssignments: ["build", "build", "fortify", "arm"] as const,
                slotResolution: null,
                buildBudgetLeft: 3,
                repairUsed: {},
                lastMessage: "ok",
                gameMode: "vsBot" as const,
                isBotActing: true,
            },
            matchState: patchedMatch,
            log: ["event-1"],
        };
        const decoded = deserializeSavedRun(serializeSavedRun(payload));
        expect(decoded.seed).toBe(payload.seed);
        expect(decoded.rngState).toBe(payload.rngState);
        expect(decoded.uiState.phase).toBe("build");
        expect(decoded.uiState.gameMode).toBe("vsBot");
        expect(decoded.uiState.isBotActing).toBe(true);
        expect(decoded.matchState.width).toBe(12);
        expect(decoded.matchState.currentPlayer).toBe(1);
        expect(decoded.matchState.grid[1]?.[0]?.hp).toBe(2);
    });

    it("fails on format version mismatch", () => {
        const raw = JSON.stringify({
            formatVersion: "0.9",
            seed: 1,
            rngState: 1,
            uiState: {},
            matchState: {},
        });
        expect(() => deserializeSavedRun(raw)).toThrow("Incompatible save version");
    });
});
