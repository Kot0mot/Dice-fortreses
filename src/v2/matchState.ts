import { V2_GRID_HEIGHT, V2_GRID_WIDTH } from "./constants.js";
import { BUILDING_CATALOG } from "./catalog.js";
import type { OwnerId, V2Node, V2Beam, BuildingInstance, BeamMaterialId } from "./mapTypes.js";
import { emptyEconomy, type PlayerEconomy } from "./economy.js";
import type { ResourceId } from "./resources.js";

export interface V2MatchState {
    readonly width: number;
    readonly height: number;
    readonly nodes: ReadonlyMap<string, V2Node>;
    readonly beams: ReadonlyMap<string, V2Beam>;
    readonly buildings: ReadonlyMap<string, BuildingInstance>;
    readonly economy: readonly [PlayerEconomy, PlayerEconomy];
    readonly currentPlayer: OwnerId;
    readonly turnPhase: "dice" | "build" | "combat";
    readonly rerollsLeft: number;
}

/** Инициализация: создаем землю и ядра */
export function createInitialV2Match(): V2MatchState {
    const w = V2_GRID_WIDTH;
    const h = V2_GRID_HEIGHT;

    const nodes = new Map<string, V2Node>();
    const beams = new Map<string, V2Beam>();
    const buildings = new Map<string, BuildingInstance>();

    for (let x = 0; x < w; x++) {
        const id0 = `ground-0-${x}`;
        nodes.set(id0, { id: id0, x, y: h - 1, owner: 0, isGround: true });
        const id1 = `ground-1-${x}`;
        nodes.set(id1, { id: id1, x, y: 0, owner: 1, isGround: true });
    }

    const cx = Math.floor(w / 2);
    const nodeP0 = nodes.get(`ground-0-${cx}`)!;
    const b0: BuildingInstance = {
        id: "core-0",
        defId: "core_generator",
        owner: 0,
        nodeIds: [nodeP0.id],
        hp: BUILDING_CATALOG["core_generator"].hp,
        isOperational: true,
    };

    const nodeP1 = nodes.get(`ground-1-${cx}`)!;
    const b1: BuildingInstance = {
        id: "core-1",
        defId: "core_generator",
        owner: 1,
        nodeIds: [nodeP1.id],
        hp: BUILDING_CATALOG["core_generator"].hp,
        isOperational: true,
    };

    buildings.set(b0.id, b0);
    buildings.set(b1.id, b1);

    return {
        width: w,
        height: h,
        nodes,
        beams,
        buildings,
        economy: [emptyEconomy(), emptyEconomy()],
        currentPlayer: 0,
        turnPhase: "dice",
        rerollsLeft: 2,
    };
}

export function withCurrentPlayer(s: V2MatchState, p: OwnerId): V2MatchState {
    return { ...s, currentPlayer: p };
}

export function withEconomy(s: V2MatchState, economy: [PlayerEconomy, PlayerEconomy]): V2MatchState {
    return { ...s, economy };
}

import { BEAM_MATERIALS } from "./mapTypes.js";

const NODE_COST = 1;

export function tryPlaceNode(state: V2MatchState, x: number, y: number, owner: OwnerId): V2MatchState {
    const id = `node-${owner}-${x}-${y}`;
    if (state.nodes.has(id)) return state;

    const eco = state.economy[owner];
    if ((eco.resources.steel ?? 0) < NODE_COST) return state;

    const nodes = new Map(state.nodes);
    nodes.set(id, { id, x, y, owner, isGround: false });

    const nextEco: PlayerEconomy = { ...eco, resources: { ...eco.resources, steel: (eco.resources.steel ?? 0) - NODE_COST } };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[owner] = nextEco;

    return { ...state, nodes, economy: nextEconomies };
}

export function tryPlaceBeam(state: V2MatchState, nodeAId: string, nodeBId: string, materialId: BeamMaterialId, owner: OwnerId): V2MatchState {
    const id = `beam-${nodeAId}-${nodeBId}`;
    if (state.beams.has(id)) return state;

    const mat = BEAM_MATERIALS[materialId];
    if (!mat) return state;

    const eco = state.economy[owner];
    const rid = mat.cost.resourceId as ResourceId;
    const currentRes = eco.resources[rid] ?? 0;
    if (currentRes < mat.cost.amount) return state;

    const beams = new Map(state.beams);
    beams.set(id, {
        id,
        nodeAId,
        nodeBId,
        materialId,
        hp: mat.hp,
        owner,
    });

    const nextEco: PlayerEconomy = { ...eco, resources: { ...eco.resources, [rid]: currentRes - mat.cost.amount } };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[owner] = nextEco;

    return { ...state, beams, economy: nextEconomies };
}

export function tryPlaceBuilding(state: V2MatchState, defId: string, nodeIds: string[], owner: OwnerId): V2MatchState {
    const def = BUILDING_CATALOG[defId];
    if (!def) return state;

    // Проверка технологий
    if (def.techRequired) {
        const hasTech = Array.from(state.buildings.values()).some(
            b => b.owner === owner && b.defId === def.techRequired && b.isOperational
        );
        if (!hasTech) return state;
    }

    const eco = state.economy[owner];
    for (const [rid, amount] of Object.entries(def.cost)) {
        if ((eco.resources[rid as ResourceId] ?? 0) < (amount as number)) return state;
    }

    const buildings = new Map(state.buildings);
    const id = `b-${owner}-${Date.now()}`;
    buildings.set(id, {
        id,
        defId,
        owner,
        nodeIds,
        hp: def.hp,
        isOperational: true,
    });

    const nextRes = { ...eco.resources };
    for (const [rid, amount] of Object.entries(def.cost)) {
        nextRes[rid as ResourceId] = (nextRes[rid as ResourceId] ?? 0) - (amount as number);
    }
    const nextEco: PlayerEconomy = { ...eco, resources: nextRes };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[owner] = nextEco;

    return { ...state, buildings, economy: nextEconomies };
}
