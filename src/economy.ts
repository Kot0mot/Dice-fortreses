import type { ResourceBag, ResourceId } from "./resources.js";

export interface PlayerEconomy {
    readonly resources: ResourceBag;
    readonly caps: Partial<Record<ResourceId, number>>;
    readonly workers: number;
    readonly workersTotal: number;
}

const DEFAULT_CAP = 50;

export function defaultPlayerCaps(): Partial<Record<ResourceId, number>> {
    return {
        steel: DEFAULT_CAP,
        power: DEFAULT_CAP,
        ore: DEFAULT_CAP,
        tech_fragment: DEFAULT_CAP,
        alloy: DEFAULT_CAP,
        fuel: DEFAULT_CAP,
        ammo: DEFAULT_CAP,
    };
}

export function emptyEconomy(): PlayerEconomy {
    return { resources: {}, caps: defaultPlayerCaps(), workers: 0, workersTotal: 0 };
}

import { BUILDING_CATALOG } from "./catalog.js";
import type { V2MatchState } from "./matchState.js";

export function recalculateCaps(state: V2MatchState, player: 0 | 1): Partial<Record<ResourceId, number>> {
    const caps = defaultPlayerCaps();
    for (const b of state.buildings.values()) {
        if (b.owner === player && b.isOperational) {
            const def = BUILDING_CATALOG[b.defId];
            if (def.resourceCapBonus) {
                for (const [rid, bonus] of Object.entries(def.resourceCapBonus)) {
                    caps[rid as ResourceId] = (caps[rid as ResourceId] ?? 0) + bonus!;
                }
            }
        }
    }
    return caps;
}

/** Лишнее при переполнении отбрасывается (discard). */
export function applyResourceGains(e: PlayerEconomy, delta: ResourceBag): PlayerEconomy {
    const nextRes: ResourceBag = { ...e.resources };
    for (const [k, v] of Object.entries(delta)) {
        const id = k as ResourceId;
        if (v === undefined || !Number.isFinite(v)) continue;
        const add = Math.floor(v);
        if (add <= 0) continue;
        const cap = e.caps[id];
        const cur = nextRes[id] ?? 0;
        const merged = cap === undefined ? cur + add : Math.min(cap, cur + add);
        nextRes[id] = merged;
    }
    return { ...e, resources: nextRes };
}
