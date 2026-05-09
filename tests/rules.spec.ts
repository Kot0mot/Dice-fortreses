import { describe, it, expect } from "vitest";
import type { Rng } from "../src/types.js";
import {
    DICE_FORTS_ARM_DAMAGE_OFFSET,
    DICE_FORTS_ARM_PIERCE_DEPTH_ON_MAX,
    DICE_FORTS_ARM_THRESHOLD,
    DICE_FORTS_DICE_COUNT,
} from "../src/constants.js";
import {
    applyFortifyChargesToDamage,
    isValidSlotPartition,
    resolveDiceFortsSlots,
    rollDiceFortsHand,
} from "../src/rules.js";

const mockRng = (sequence: number[]): Rng => {
    let i = 0;
    return {
        nextInt: (_min: number, _max: number) => {
            if (i >= sequence.length) throw new Error("mock Rng out of values");
            return sequence[i++]!;
        },
    };
};

describe("Dice Fortresses MVP rules", () => {
    it("rollDiceFortsHand rolls DICE_FORTS_DICE_COUNT dice", () => {
        const hand = rollDiceFortsHand(mockRng([1, 2, 3, 4]));
        expect(hand).toEqual([1, 2, 3, 4]);
        expect(hand.length).toBe(DICE_FORTS_DICE_COUNT);
    });

    it("isValidSlotPartition accepts exact partition", () => {
        const hand = [1, 2, 3, 6];
        expect(
            isValidSlotPartition(hand, { build: [1, 2], fortify: [3], arm: [6] })
        ).toBe(true);
        expect(
            isValidSlotPartition(hand, { build: [1, 2], fortify: [3], arm: [4] })
        ).toBe(false);
    });

    it("resolveDiceFortsSlots: build sum, fortify floor(mean)-1, arm threshold and damage", () => {
        const r = resolveDiceFortsSlots({
            build: [2, 3],
            fortify: [4, 5],
            arm: [1, 6],
        });
        expect(r.buildPoints).toBe(5);
        expect(r.fortifyCharges).toBe(Math.max(0, Math.floor(9 / 2) - 1));
        expect(r.arm.max).toBe(6);
        expect(r.arm.canFire).toBe(true);
        expect(r.arm.damage).toBe(Math.max(1, 6 - DICE_FORTS_ARM_DAMAGE_OFFSET));
        expect(r.arm.pierceDepth).toBe(DICE_FORTS_ARM_PIERCE_DEPTH_ON_MAX);
    });

    it("arm does not fire when max < threshold", () => {
        const r = resolveDiceFortsSlots({
            build: [],
            fortify: [],
            arm: [1, 2, 2, 1],
        });
        expect(r.arm.max).toBe(2);
        expect(r.arm.canFire).toBe(false);
        expect(r.arm.damage).toBe(0);
        expect(r.arm.pierceDepth).toBe(0);
    });

    it("arm fires at threshold (maxArm=3) with damage 1", () => {
        const r = resolveDiceFortsSlots({ build: [], fortify: [], arm: [3] });
        expect(r.arm.canFire).toBe(true);
        expect(r.arm.damage).toBe(Math.max(1, DICE_FORTS_ARM_THRESHOLD - DICE_FORTS_ARM_DAMAGE_OFFSET));
    });

    it("fortify charges are never negative on low averages", () => {
        const r = resolveDiceFortsSlots({ build: [], fortify: [1], arm: [] });
        expect(r.fortifyCharges).toBe(0);
    });

    it("applyFortifyChargesToDamage absorbs up to charges", () => {
        expect(applyFortifyChargesToDamage(5, 2)).toEqual({
            damageRemaining: 3,
            chargesRemaining: 0,
        });
    });
});
