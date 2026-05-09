import { describe, expect, it } from "vitest";
import { createInitialMatchState, setCell } from "../src/state.js";
import {
    canRunUiPhaseAction,
    filterUiLogEntries,
    getArmTargets,
    getBuildTargets,
    getRepairTargets,
    getValidArmColumns,
    getValidNewCells,
    getValidRepairCells,
    parseColumn,
    slotsFromAssignments,
    type UiLogEntry,
} from "../web/ui-helpers.js";

describe("web ui helpers", () => {
    it("converts assignments into slot arrays", () => {
        const out = slotsFromAssignments([1, 4, 6, 2], ["build", "arm", "fortify", "arm"]);
        expect(out).toEqual({
            build: [1],
            fortify: [6],
            arm: [4, 2],
        });
    });

    it("parses only in-range integer column values", () => {
        expect(parseColumn("3", 12)).toBe(3);
        expect(parseColumn("-1", 12)).toBeNull();
        expect(parseColumn("12", 12)).toBeNull();
        expect(parseColumn("x", 12)).toBeNull();
    });

    it("returns valid new build cells for initial state", () => {
        const state = createInitialMatchState();
        const valid = getValidNewCells(state, 0).map(({ x, y }) => `${x},${y}`).sort();
        expect(valid).toEqual(["3,7", "4,6", "5,6", "6,6", "7,7"]);
    });

    it("returns repair targets respecting full hp and per-cell cap", () => {
        let state = createInitialMatchState();
        const cell47 = state.grid[7]![4]!;
        const cell57 = state.grid[7]![5]!;
        const cell67 = state.grid[7]![6]!;
        state = setCell(state, 4, 7, { ...cell47, hp: 2 });
        state = setCell(state, 5, 7, { ...cell57, hp: 19 });
        state = setCell(state, 6, 7, { ...cell67, hp: 3 });

        const valid = getValidRepairCells(state, 0, {
            "4,7": 3,
            "6,7": 2,
        })
            .map(({ x, y }) => `${x},${y}`)
            .sort();

        expect(valid).toEqual(["5,7", "6,7"]);
    });

    it("returns arm columns with enemy targets for both players", () => {
        const state = createInitialMatchState();
        expect(getValidArmColumns(state, 0)).toEqual([4, 5, 6]);
        expect(getValidArmColumns(state, 1)).toEqual([4, 5, 6]);
    });

    it("exposes target helpers without duplicating logic", () => {
        const state = createInitialMatchState();
        expect(getBuildTargets(state, 0)).toEqual(getValidNewCells(state, 0));
        expect(getRepairTargets(state, 0, {})).toEqual(getValidRepairCells(state, 0, {}));
        expect(getArmTargets(state, 0)).toEqual(getValidArmColumns(state, 0));
    });

    it("blocks click actions when phase is wrong", () => {
        expect(canRunUiPhaseAction("roll", "build", null, false)).toBe(false);
        expect(canRunUiPhaseAction("build", "build", null, false)).toBe(true);
    });

    it("blocks click actions while bot acts", () => {
        expect(canRunUiPhaseAction("build", "build", null, true)).toBe(false);
        expect(canRunUiPhaseAction("arm", "arm", 1, false)).toBe(false);
    });

    it("filters log entries by selected categories", () => {
        const entries: UiLogEntry[] = [
            { ts: 1, turn: 1, playerId: 0, category: "dice", message: "rolled" },
            { ts: 2, turn: 1, playerId: 0, category: "build", message: "build" },
            { ts: 3, turn: 1, playerId: 0, category: "combat", message: "fire" },
            { ts: 4, turn: 1, playerId: 0, category: "system", message: "end" },
        ];
        const filtered = filterUiLogEntries(entries, {
            dice: true,
            build: false,
            combat: true,
            system: false,
        });
        expect(filtered.map((entry) => entry.category)).toEqual(["dice", "combat"]);
    });
});
