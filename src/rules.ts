/**
 * Чистые функции правил MVP (без симуляции сетки и физики).
 */

import type { Rng } from "./types.js";
import {
    DICE_FORTS_ARM_DAMAGE_OFFSET,
    DICE_FORTS_ARM_PIERCE_DEPTH_ON_MAX,
    DICE_FORTS_ARM_THRESHOLD,
    DICE_FORTS_DICE_COUNT,
    DICE_FORTS_DICE_MAX,
    DICE_FORTS_DICE_MIN,
} from "./constants.js";
import type { DiceFortsSlotResolution, DiceFortsSlots } from "./types.js";

/** Бросок руки: N кубов d6 (детерминированно через Rng). */
export function rollDiceFortsHand(rng: Rng): number[] {
    const hand: number[] = [];
    for (let i = 0; i < DICE_FORTS_DICE_COUNT; i++) {
        hand.push(rng.nextInt(DICE_FORTS_DICE_MIN, DICE_FORTS_DICE_MAX));
    }
    return hand;
}

/** Все грани в слотах — точная перестановка multisets переданной руки. */
export function isValidSlotPartition(handSorted: readonly number[], slots: DiceFortsSlots): boolean {
    const fromSlots = [...slots.build, ...slots.fortify, ...slots.arm].sort((a, b) => a - b);
    const h = [...handSorted].sort((a, b) => a - b);
    if (fromSlots.length !== h.length) return false;
    return fromSlots.every((v, i) => v === h[i]);
}

function meanFloor(values: readonly number[]): number {
    if (values.length === 0) return 0;
    const sum = values.reduce((a, b) => a + b, 0);
    return Math.floor(sum / values.length);
}

export function resolveDiceFortsSlots(slots: DiceFortsSlots): DiceFortsSlotResolution {
    const buildPoints = slots.build.reduce((a, b) => a + b, 0);
    const fortifyCharges = Math.max(0, meanFloor(slots.fortify) - 1);

    const armValues = slots.arm;
    if (armValues.length === 0) {
        return {
            buildPoints,
            fortifyCharges,
            arm: { max: null, canFire: false, damage: 0, pierceDepth: 0 },
        };
    }

    const max = Math.max(...armValues);
    const canFire = max >= DICE_FORTS_ARM_THRESHOLD;
    const damage = canFire ? Math.max(1, max - DICE_FORTS_ARM_DAMAGE_OFFSET) : 0;
    const pierceDepth = canFire && max === DICE_FORTS_DICE_MAX ? DICE_FORTS_ARM_PIERCE_DEPTH_ON_MAX : 0;

    return {
        buildPoints,
        fortifyCharges,
        arm: { max, canFire, damage, pierceDepth },
    };
}

export function applyFortifyChargesToDamage(
    damage: number,
    charges: number
): { damageRemaining: number; chargesRemaining: number } {
    const absorbed = Math.min(Math.max(0, damage), Math.max(0, charges));
    return {
        damageRemaining: Math.max(0, damage - absorbed),
        chargesRemaining: Math.max(0, charges - absorbed),
    };
}
