/**
 * Детерминированный RNG для прототипа (LCG, тот же смысл, что и в родительском felbn/src/random.ts).
 */

import type { Rng } from "./types.js";

export class DiceFortsRng implements Rng {
    private seed: number;

    constructor(initialSeed: number) {
        this.seed = initialSeed % 1_000_000;
        if (this.seed < 0) this.seed = Math.abs(this.seed);
    }

    nextInt(min: number, max: number): number {
        this.seed = (this.seed * 16807 + 1) % 2147483647;
        const randomValue = Math.floor((this.seed / 2147483647) * (max - min + 1)) + min;
        this.seed = this.seed % 0xffff;
        return randomValue;
    }

    getState(): number {
        return this.seed;
    }

    setState(nextSeed: number): void {
        this.seed = Math.floor(Math.abs(nextSeed)) % 1_000_000;
    }
}

export function createDiceFortsRng(seed: number): Rng {
    return new DiceFortsRng(seed);
}
