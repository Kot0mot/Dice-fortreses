import { describe, it, expect } from "vitest";
import { DICE_FORTS_BLOCK_HP, DICE_FORTS_REROLLS_PER_ROUND } from "../src/constants.js";
import {
    advanceCurrentPlayer,
    applyHandReroll,
    initializeTurnRerolls,
    applyArmColumnAttack,
    listEnemyHitsInColumn,
    shouldBotReroll,
    validateBuildCommand,
} from "../src/game.js";
import {
    createInitialMatchState,
    P0_CORE_X,
    P0_CORE_Y,
    P1_CORE_X,
    P1_CORE_Y,
    type Cell,
    opponentOf,
    setCell,
} from "../src/state.js";

describe("Dice Fortresses grid / combat", () => {
    it("listEnemyHitsInColumn: игрок 0 видит ближайшего противника выше по колонке первым", () => {
        let s = createInitialMatchState();
        const blk: Cell = { kind: "block", owner: 1, hp: DICE_FORTS_BLOCK_HP, maxHp: DICE_FORTS_BLOCK_HP };
        s = setCell(s, 5, 4, blk);
        const hits = listEnemyHitsInColumn(s, 0, 5);
        expect(hits[0]?.y).toBe(4);
        expect(hits[hits.length - 1]?.y).toBe(0);
    });

    it("Fortify за выстрел: один пул зарядов на цепочку пробития (урон каждому попаданию отдельно)", () => {
        let s = createInitialMatchState();
        const blk = (hp: number): Cell => ({
            kind: "block",
            owner: 1,
            hp,
            maxHp: DICE_FORTS_BLOCK_HP,
        });
        s = setCell(s, 5, 4, blk(4));
        s = setCell(s, 5, 3, blk(4));
        const defender = opponentOf(0);
        s = {
            ...s,
            players: [
                { ...s.players[0]!, savedFortifyCharges: 0 },
                { ...s.players[1]!, savedFortifyCharges: 2 },
            ],
        };

        const { state: after, chargesRemaining } = applyArmColumnAttack(s, 0, 5, 5, 1, s.players[defender].savedFortifyCharges);
        expect(chargesRemaining).toBe(0);
        expect(after.grid[4]![5]!.kind).toBe("block");
        expect(after.grid[4]![5]!.hp).toBe(1);
        expect(after.grid[3]![5]!.kind).toBe("empty");
    });

    it("validateBuildCommand: ремонт не превышает кап на клетку за ход", () => {
        const s = createInitialMatchState();
        const pid = 0 as const;
        const x = P0_CORE_X;
        const y = P0_CORE_Y;
        const damaged = setCell(s, x, y, { ...s.grid[y]![x]!, hp: 10 });
        const repairUsed = { [`${x},${y}`]: 3 };
        const err = validateBuildCommand(damaged, pid, { type: "repair", x, y, spend: 1 }, 10, repairUsed);
        expect(err).toContain("cap");
    });

    it("uses reroll and decrements counter", () => {
        const s = createInitialMatchState();
        const rng = {
            seq: [1, 2, 3, 4],
            nextInt() {
                return this.seq.shift() ?? 1;
            },
        };
        const out = applyHandReroll(s, rng);
        expect(out).not.toBeNull();
        expect(out?.hand).toEqual([1, 2, 3, 4]);
        expect(out?.state.rerollsLeftThisTurn).toBe(DICE_FORTS_REROLLS_PER_ROUND - 1);
    });

    it("cannot reroll when counter is zero", () => {
        const s = { ...createInitialMatchState(), rerollsLeftThisTurn: 0 };
        const out = applyHandReroll(s, { nextInt: () => 6 });
        expect(out).toBeNull();
    });

    it("counter resets for next player's turn", () => {
        const s = createInitialMatchState();
        const out = applyHandReroll(s, { nextInt: () => 3 });
        expect(out).not.toBeNull();
        const afterAdvance = initializeTurnRerolls(advanceCurrentPlayer(out!.state));
        expect(afterAdvance.currentPlayer).toBe(1);
        expect(afterAdvance.rerollsLeftThisTurn).toBe(DICE_FORTS_REROLLS_PER_ROUND);
    });

    it("bot rerolls only when no die >= 4", () => {
        expect(shouldBotReroll([1, 1, 2, 3], 1)).toBe(true);
        expect(shouldBotReroll([1, 2, 4, 1], 1)).toBe(false);
        expect(shouldBotReroll([1, 1, 2, 3], 0)).toBe(false);
    });

    it("pierce + fortify + core hit never gives negative hp and sets winner", () => {
        let s = createInitialMatchState();
        s = setCell(s, 5, 1, { kind: "block", owner: 1, hp: 1, maxHp: DICE_FORTS_BLOCK_HP });
        s = setCell(s, P1_CORE_X, P1_CORE_Y, { kind: "core", owner: 1, hp: 1, maxHp: 12 });
        const defender = opponentOf(0);
        s = {
            ...s,
            players: [
                { ...s.players[0]!, savedFortifyCharges: 0 },
                { ...s.players[1]!, savedFortifyCharges: 1 },
            ],
        };
        const out = applyArmColumnAttack(s, 0, 5, 3, 2, s.players[defender].savedFortifyCharges);
        expect(out.targetsHit[0]?.hpAfter).toBeGreaterThanOrEqual(0);
        expect(out.targetsHit[1]?.hpAfter).toBeGreaterThanOrEqual(0);
        expect(out.state.winner).toBe(0);
    });
});
