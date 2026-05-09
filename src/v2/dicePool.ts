import type { Rng } from "../types.js";
import { BUILDING_CATALOG, DICE_TEMPLATES } from "./catalog.js";
import type { CustomDieDefinition } from "./customDie.js";
import { rollCustomDie, sumYields, type RolledDieResult } from "./customDie.js";
import type { V2MatchState } from "./matchState.js";
import type { OwnerId } from "./mapTypes.js";
import type { ResourceBag } from "./resources.js";

export interface PoolEntry {
    readonly instanceKey: string;
    readonly template: CustomDieDefinition;
}

export function buildDicePoolForPlayer(state: V2MatchState, owner: OwnerId): PoolEntry[] {
    const out: PoolEntry[] = [];
    for (const b of state.buildings.values()) {
        if (b.owner !== owner) continue;
        const def = BUILDING_CATALOG.get(b.defId);
        if (!def) continue;
        for (const c of def.diceContribution) {
            const template = DICE_TEMPLATES.get(c.templateId);
            if (!template) continue;
            for (let i = 0; i < c.count; i++) {
                out.push({
                    instanceKey: `${b.id}#${c.templateId}#${i}`,
                    template,
                });
            }
        }
    }
    return out;
}

export function rollEntireDicePool(pool: readonly PoolEntry[], rng: Rng): {
    results: RolledDieResult[];
    bag: ResourceBag;
} {
    const results: RolledDieResult[] = [];
    for (const e of pool) {
        results.push(rollCustomDie(e.template, e.instanceKey, rng));
    }
    const raw = sumYields(results);
    const bag: ResourceBag = {};
    for (const [k, v] of Object.entries(raw)) {
        bag[k as keyof ResourceBag] = v;
    }
    return { results, bag };
}
