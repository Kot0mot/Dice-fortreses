import type { Rng } from "../types.js";
import type { DiceFaceYield } from "./diceFaces.js";
import type { ResourceId } from "./resources.js";

export interface CustomDieDefinition {
    readonly id: string;
    readonly faces: readonly DiceFaceYield[];
}

export interface RolledDieResult {
    readonly dieId: string;
    readonly templateId: string;
    readonly faceIndex: number;
    readonly yield: DiceFaceYield;
}

/** Валидация: ровно 6 граней, amount >= 1 целое, resourceId уникален в кубе. */
export function assertValidDieDefinition(def: CustomDieDefinition): void {
    if (def.faces.length !== 6) {
        throw new Error(`Куб ${def.id}: нужно ровно 6 граней, сейчас ${def.faces.length}`);
    }
    const seen = new Set<ResourceId>();
    for (const f of def.faces) {
        if (!Number.isInteger(f.amount) || f.amount < 1) {
            throw new Error(`Куб ${def.id}: некорректное amount на грани ${f.resourceId}`);
        }
        if (seen.has(f.resourceId)) {
            throw new Error(`Куб ${def.id}: дубликат ресурса ${f.resourceId} на грани`);
        }
        seen.add(f.resourceId);
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
        out[k] = (out[k] ?? 0) + r.yield.amount;
    }
    return out;
}
