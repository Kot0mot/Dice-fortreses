import type { Rng } from "../types.js";
import type { DiceFaceEffect } from "./catalog.js";

export interface CustomDieDefinition {
    readonly id: string;
    readonly faces: readonly DiceFaceEffect[];
}

export interface RolledDieResult {
    readonly dieId: string;
    readonly templateId: string;
    readonly faceIndex: number;
    readonly yield: DiceFaceEffect;
}

/** Валидация: ровно 6 граней. */
export function assertValidDieDefinition(def: CustomDieDefinition): void {
    if (def.faces.length !== 6) {
        throw new Error(`Куб ${def.id}: нужно ровно 6 граней, сейчас ${def.faces.length}`);
    }
}

export function rollCustomDie(def: CustomDieDefinition, dieInstanceKey: string, rng: Rng): RolledDieResult {
    assertValidDieDefinition(def);
    const faceIndex = rng.nextInt(0, 5);
    const y = def.faces[faceIndex]!;
    return {
        dieId: dieInstanceKey,
        templateId: def.id,
        faceIndex,
        yield: y,
    };
}

export function sumYields(results: readonly RolledDieResult[]): Record<string, number> {
    const out: Record<string, number> = {};
    for (const r of results) {
        const k = r.yield.resourceId;
        if (k && r.yield.amount) {
            out[k] = (out[k] ?? 0) + r.yield.amount;
        }
    }
    return out;
}
