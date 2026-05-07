/**
 * Контракт RNG и типы MVP гибрида Dice × Forts.
 */

/** Абстрактный детерминированный RNG (реализация — в вашем клиенте/рантайме). */
export interface Rng {
    nextInt(min: number, max: number): number;
}

/** Три слота распределения кубов за раунд. */
export interface DiceFortsSlots {
    readonly build: readonly number[];
    readonly fortify: readonly number[];
    readonly arm: readonly number[];
}

export interface DiceFortsArmResolution {
    readonly max: number | null;
    readonly canFire: boolean;
    readonly damage: number;
    readonly pierceDepth: number;
}

export interface DiceFortsSlotResolution {
    readonly buildPoints: number;
    readonly fortifyCharges: number;
    readonly arm: DiceFortsArmResolution;
}
