import { V2_GRID_HEIGHT, V2_GRID_WIDTH } from "./constants.js";
import { BUILDING_CORE_GENERATOR } from "./catalog.js";
import type { OwnerId } from "./mapTypes.js";
import type { BuildingInstance } from "./mapTypes.js";
import type { V2Cell } from "./mapTypes.js";
import { emptyEconomy, type PlayerEconomy } from "./economy.js";

export interface V2MatchState {
    readonly width: number;
    readonly height: number;
    readonly grid: readonly (readonly V2Cell[])[];
    readonly buildings: ReadonlyMap<string, BuildingInstance>;
    readonly economy: readonly [PlayerEconomy, PlayerEconomy];
    readonly currentPlayer: OwnerId;
}

function mkEmptyGrid(w: number, h: number): V2Cell[][] {
    const g: V2Cell[][] = [];
    for (let y = 0; y < h; y++) {
        const row: V2Cell[] = [];
        for (let x = 0; x < w; x++) row.push({ type: "empty" });
        g.push(row);
    }
    return g;
}

/** Ядро P0 — низ, P1 — верх, центр по X. */
export function createInitialV2Match(): V2MatchState {
    const w = V2_GRID_WIDTH;
    const h = V2_GRID_HEIGHT;
    const grid = mkEmptyGrid(w, h);

    const cx = Math.floor(w / 2);
    const p0y = h - 1;
    const p1y = 0;

    const b0: BuildingInstance = {
        id: "b-p0-core",
        defId: BUILDING_CORE_GENERATOR.id,
        owner: 0,
        x: cx,
        y: p0y,
    };
    const b1: BuildingInstance = {
        id: "b-p1-core",
        defId: BUILDING_CORE_GENERATOR.id,
        owner: 1,
        x: cx,
        y: p1y,
    };

    grid[p0y]![cx] = { type: "building", instanceId: b0.id };
    grid[p1y]![cx] = { type: "building", instanceId: b1.id };

    const buildings = new Map<string, BuildingInstance>([
        [b0.id, b0],
        [b1.id, b1],
    ]);

    return {
        width: w,
        height: h,
        grid: grid.map((row) => [...row]),
        buildings,
        economy: [emptyEconomy(), emptyEconomy()],
        currentPlayer: 0,
    };
}

export function withCurrentPlayer(s: V2MatchState, p: OwnerId): V2MatchState {
    return { ...s, currentPlayer: p };
}

export function withEconomy(s: V2MatchState, economy: [PlayerEconomy, PlayerEconomy]): V2MatchState {
    return { ...s, economy };
}
