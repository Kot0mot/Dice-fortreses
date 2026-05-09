import type { ResourceBag, ResourceId } from "./resources.js";

export interface PlayerEconomy {
    readonly resources: ResourceBag;
    readonly caps: Partial<Record<ResourceId, number>>;
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
    };
}

export function emptyEconomy(): PlayerEconomy {
    return { resources: {}, caps: defaultPlayerCaps() };
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
