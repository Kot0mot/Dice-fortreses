import { V2_GRID_HEIGHT, V2_GRID_WIDTH } from "./constants.js";
import { BUILDING_CATALOG, STARTER_CUBE } from "./catalog.js";
import type { OwnerId, V2Node, V2Beam, BuildingInstance, BeamMaterialId } from "./mapTypes.js";
import { emptyEconomy, type PlayerEconomy } from "./economy.js";
import type { ResourceId } from "./resources.js";
import type { CustomDieDefinition } from "./customDie.js";

export interface V2MatchState {
    readonly width: number;
    readonly height: number;
    readonly nodes: ReadonlyMap<string, V2Node>;
    readonly beams: ReadonlyMap<string, V2Beam>;
    readonly buildings: ReadonlyMap<string, BuildingInstance>;
    readonly economy: readonly [PlayerEconomy, PlayerEconomy];
    readonly playerDice: readonly [CustomDieDefinition[], CustomDieDefinition[]];
    readonly currentPlayer: OwnerId;
    readonly turnPhase: "dice" | "build" | "combat";
    readonly rerollsLeft: number;
}

/** Инициализация: создаем землю и ядра (Слева и Справа) */
export function createInitialV2Match(): V2MatchState {
    const w = V2_GRID_WIDTH;
    const h = V2_GRID_HEIGHT;

    const nodes = new Map<string, V2Node>();
    const beams = new Map<string, V2Beam>();
    const buildings = new Map<string, BuildingInstance>();

    // Создаем узлы земли: P0 слева, P1 справа. Все на y = h - 1.
    const groundWidth = Math.floor(w / 4);
    for (let x = 0; x < groundWidth; x++) {
        const id0 = `ground-0-${x}`;
        nodes.set(id0, { id: id0, x, y: h - 1, owner: 0, isGround: true });

        const x1 = w - 1 - x;
        const id1 = `ground-1-${x1}`;
        nodes.set(id1, { id: id1, x: x1, y: h - 1, owner: 1, isGround: true });
    }

    // Стартовые ядра: P0 на x=0, P1 на x=w-1
    const nodeP0 = nodes.get(`ground-0-0`)!;
    const b0: BuildingInstance = {
        id: "core-0",
        defId: "core_generator",
        owner: 0,
        nodeIds: [nodeP0.id],
        hp: BUILDING_CATALOG["core_generator"].hp,
        isOperational: true,
        level: 1,
        fireLevel: 0,
        workersAssigned: 0,
        isPowered: true,
        modules: [],
    };

    const nodeP1 = nodes.get(`ground-1-${w - 1}`)!;
    const b1: BuildingInstance = {
        id: "core-1",
        defId: "core_generator",
        owner: 1,
        nodeIds: [nodeP1.id],
        hp: BUILDING_CATALOG["core_generator"].hp,
        isOperational: true,
        level: 1,
        fireLevel: 0,
        workersAssigned: 0,
        isPowered: true,
        modules: [],
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
        playerDice: [[{...STARTER_CUBE}, {...STARTER_CUBE}], [{...STARTER_CUBE}, {...STARTER_CUBE}]],
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

    // Простая проверка: нельзя строить за пределами своей половины
    if (owner === 0 && x >= state.width / 2) return state;
    if (owner === 1 && x < state.width / 2) return state;

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
        currentLoad: 0,
        fireLevel: 0,
        isPowered: false,
    });

    const nextEco: PlayerEconomy = { ...eco, resources: { ...eco.resources, [rid]: currentRes - mat.cost.amount } };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[owner] = nextEco;

    return { ...state, beams, economy: nextEconomies };
}

export function tryPlaceBuilding(state: V2MatchState, defId: string, nodeIds: string[], owner: OwnerId, campaignPerks: string[] = []): V2MatchState {
    const def = BUILDING_CATALOG[defId];
    if (!def) return state;

    // Must have at least one valid node
    if (!nodeIds.every(nid => state.nodes.has(nid))) return state;

    if (def.techRequired) {
        const hasTech = Array.from(state.buildings.values()).some(
            b => b.owner === owner && b.defId === def.techRequired && b.isOperational
        );
        if (!hasTech) return state;
    }

    const eco = state.economy[owner];

    // Check workers
    const workersNeeded = def.workersRequired ?? 0;
    if (eco.workers < workersNeeded) return state;

    // Check power (simple global check for build phase, grid check is in physics/update)
    const powerNeeded = def.powerRequired ?? 0;
    if ((eco.resources.power ?? 0) < powerNeeded) return state;
    const isEarlyTechActive = owner === 0 && campaignPerks.includes("perk_early_tech") && defId === "tech_station";

    for (const [rid, amount] of Object.entries(def.cost)) {
        let finalCost = amount as number;
        if (isEarlyTechActive) finalCost = Math.floor(finalCost * 0.5);
        if ((eco.resources[rid as ResourceId] ?? 0) < finalCost) return state;
    }

    const buildings = new Map(state.buildings);
    // Use a more unique ID to avoid collisions in fast-running tests
    const id = `b-${owner}-${defId}-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
    buildings.set(id, {
        id,
        defId,
        owner,
        nodeIds,
        hp: def.hp,
        isOperational: true,
        level: 1,
        fireLevel: 0,
        workersAssigned: 0,
        isPowered: false,
        modules: [],
    });

    const nextRes = { ...eco.resources };
    for (const [rid, amount] of Object.entries(def.cost)) {
        let finalCost = amount as number;
        if (isEarlyTechActive) finalCost = Math.floor(finalCost * 0.5);
        nextRes[rid as ResourceId] = (nextRes[rid as ResourceId] ?? 0) - finalCost;
    }
    const nextEco: PlayerEconomy = {
        ...eco,
        resources: nextRes,
        workers: eco.workers - workersNeeded
    };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[owner] = nextEco;

    return { ...state, buildings, economy: nextEconomies };
}

import { updateFire, updatePowerGrid, performCollapse, applySuppressors } from "./physics.js";

/**
 * Вызывается в конце хода или фазы для обновления физики, огня и энергии.
 */
export function processGlobalUpdates(state: V2MatchState): V2MatchState {
    const physState = {
        nodes: new Map(state.nodes),
        beams: new Map(state.beams),
        buildings: new Map(state.buildings)
    };

    updatePowerGrid(physState);
    updateFire(physState);
    applySuppressors(physState);
    performCollapse(physState);

    return {
        ...state,
        nodes: physState.nodes,
        beams: physState.beams,
        buildings: physState.buildings
    };
}

/**
 * Кастомизация куба. Позволяет заменить грань на выбранную.
 */
export function tryForgeDie(state: V2MatchState, dieIndex: number, faceIndex: number, newFace: any): V2MatchState {
    const p = state.currentPlayer;
    const dice = [...state.playerDice[p]];
    const die = dice[dieIndex];
    if (!die) return state;

    const cost = 20; // Фиксированная стоимость ковки
    const eco = state.economy[p];
    if ((eco.resources.tech_fragment ?? 0) < cost) return state;

    const nextFaces = [...die.faces];
    nextFaces[faceIndex] = newFace;
    dice[dieIndex] = { ...die, faces: nextFaces };

    const nextDice = [...state.playerDice] as [CustomDieDefinition[], CustomDieDefinition[]];
    nextDice[p] = dice;

    const nextEco = { ...eco, resources: { ...eco.resources, tech_fragment: eco.resources.tech_fragment! - cost } };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[p] = nextEco;

    return { ...state, playerDice: nextDice, economy: nextEconomies };
}

export function tryRepairBuilding(state: V2MatchState, buildingId: string): V2MatchState {
    const b = state.buildings.get(buildingId);
    if (!b) return state;
    const def = BUILDING_CATALOG[b.defId];
    if (b.hp >= def.hp) return state;

    const cost = 2; // Fixed repair cost for MVP
    const eco = state.economy[b.owner];
    if ((eco.resources.steel ?? 0) < cost) return state;

    const buildings = new Map(state.buildings);
    buildings.set(buildingId, { ...b, hp: def.hp, isOperational: true });

    const nextEco = { ...eco, resources: { ...eco.resources, steel: (eco.resources.steel ?? 0) - cost } };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[b.owner] = nextEco;

    return { ...state, buildings, economy: nextEconomies };
}

export function tryDeleteBuilding(state: V2MatchState, buildingId: string): V2MatchState {
    const buildings = new Map(state.buildings);
    buildings.delete(buildingId);
    return { ...state, buildings };
}

export function tryDeleteBeam(state: V2MatchState, beamId: string): V2MatchState {
    const beams = new Map(state.beams);
    beams.delete(beamId);
    return { ...state, beams };
}

export function tryRepairAll(state: V2MatchState, owner: OwnerId): V2MatchState {
    const eco = state.economy[owner];
    let steel = eco.resources.steel ?? 0;
    const nextBuildings = new Map(state.buildings);
    let changed = false;

    for (const [bid, b] of state.buildings.entries()) {
        if (b.owner === owner && b.hp < BUILDING_CATALOG[b.defId].hp && steel >= 2) {
            nextBuildings.set(bid, { ...b, hp: BUILDING_CATALOG[b.defId].hp });
            steel -= 2;
            changed = true;
        }
    }

    if (!changed) return state;
    const nextEconomy = [...state.economy];
    nextEconomy[owner] = { ...eco, resources: { ...eco.resources, steel } };

    return { ...state, buildings: nextBuildings, economy: nextEconomy as [any, any] };
}

export function tryUpgradeBuilding(state: V2MatchState, buildingId: string): V2MatchState {
    const b = state.buildings.get(buildingId);
    if (!b || b.level >= 2) return state;

    const def = BUILDING_CATALOG[b.defId];
    if (!def.upgradeCost) return state;

    const eco = state.economy[b.owner];
    for (const [rid, amount] of Object.entries(def.upgradeCost)) {
        if ((eco.resources[rid as ResourceId] ?? 0) < (amount as number)) return state;
    }

    const buildings = new Map(state.buildings);
    buildings.set(buildingId, { ...b, level: 2 });

    const nextRes = { ...eco.resources };
    for (const [rid, amount] of Object.entries(def.upgradeCost)) {
        nextRes[rid as ResourceId] = (nextRes[rid as ResourceId] ?? 0) - (amount as number);
    }
    const nextEco: PlayerEconomy = { ...eco, resources: nextRes };
    const nextEconomies = [...state.economy] as [PlayerEconomy, PlayerEconomy];
    nextEconomies[b.owner] = nextEco;

    return { ...state, buildings, economy: nextEconomies };
}
