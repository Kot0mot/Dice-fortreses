import type { V2Node, V2Beam, OwnerId, BuildingInstance } from "./mapTypes.js";
import { BEAM_MATERIALS } from "./mapTypes.js";
import { BUILDING_CATALOG } from "./catalog.js";

export interface StructuralState {
    nodes: Map<string, V2Node>;
    beams: Map<string, V2Beam>;
    buildings?: Map<string, BuildingInstance>;
}

/** Проверка связности с землей. */
export function checkConnectivity(state: StructuralState): Set<string> {
    const connectedNodes = new Set<string>();
    const queue: string[] = [];

    for (const node of state.nodes.values()) {
        if (node.isGround) {
            connectedNodes.add(node.id);
            queue.push(node.id);
        }
    }

    let head = 0;
    while (head < queue.length) {
        const nodeId = queue[head++]!;
        for (const beam of state.beams.values()) {
            if (beam.nodeAId === nodeId && !connectedNodes.has(beam.nodeBId)) {
                connectedNodes.add(beam.nodeBId);
                queue.push(beam.nodeBId);
            } else if (beam.nodeBId === nodeId && !connectedNodes.has(beam.nodeAId)) {
                connectedNodes.add(beam.nodeAId);
                queue.push(beam.nodeAId);
            }
        }
    }

    return connectedNodes;
}

/**
 * Расчет статической нагрузки.
 * Распределяет веса зданий и балок по графу до земли.
 */
export function calculateLoads(state: StructuralState): Map<string, number> {
    const beamLoads = new Map<string, number>();
    const nodeWeights = new Map<string, number>();

    // 1. Считаем вес в каждом узле (здания + вес балок пополам)
    if (state.buildings) {
        for (const b of state.buildings.values()) {
            const def = BUILDING_CATALOG[b.defId];
            const weightPerNode = def.weight / b.nodeIds.length;
            for (const nid of b.nodeIds) {
                nodeWeights.set(nid, (nodeWeights.get(nid) ?? 0) + weightPerNode);
            }
        }
    }

    for (const beam of state.beams.values()) {
        const mat = BEAM_MATERIALS[beam.materialId];
        const weightPerNode = mat.weight / 2;
        nodeWeights.set(beam.nodeAId, (nodeWeights.get(beam.nodeAId) ?? 0) + weightPerNode);
        nodeWeights.set(beam.nodeBId, (nodeWeights.get(beam.nodeBId) ?? 0) + weightPerNode);
    }

    // 2. Распространяем веса сверху вниз (упрощенно)
    // В полноценном движке это решение системы уравнений,
    // здесь сделаем итеративное накопление от самых высоких узлов к нижним.
    const sortedNodes = Array.from(state.nodes.values()).sort((a, b) => a.y - b.y); // Сверху вниз (y=0 это верх)

    const accumulatedWeight = new Map(nodeWeights);

    for (const node of sortedNodes) {
        if (node.isGround) continue;

        const weightToDistribute = accumulatedWeight.get(node.id) ?? 0;
        // Находим все балки, идущие "вниз" от этого узла
        const downwardBeams = Array.from(state.beams.values()).filter(b =>
            (b.nodeAId === node.id && state.nodes.get(b.nodeBId)!.y > node.y) ||
            (b.nodeBId === node.id && state.nodes.get(b.nodeAId)!.y > node.y)
        );

        if (downwardBeams.length > 0) {
            const share = weightToDistribute / downwardBeams.length;
            for (const beam of downwardBeams) {
                beamLoads.set(beam.id, (beamLoads.get(beam.id) ?? 0) + share);
                const otherNodeId = beam.nodeAId === node.id ? beam.nodeBId : beam.nodeAId;
                accumulatedWeight.set(otherNodeId, (accumulatedWeight.get(otherNodeId) ?? 0) + share);
            }
        }
    }

    return beamLoads;
}

/** Проверка на обрушение */
export function performCollapse(state: StructuralState): { collapsedBeams: string[]; collapsedNodes: string[] } {
    const connectedNodes = checkConnectivity(state);
    const loads = calculateLoads(state);
    const collapsedBeams: string[] = [];
    const collapsedNodes: string[] = [];

    // 1. Проверка на связность
    for (const beam of state.beams.values()) {
        if (!connectedNodes.has(beam.nodeAId) || !connectedNodes.has(beam.nodeBId)) {
            collapsedBeams.push(beam.id);
        }
    }

    // 2. Проверка на перегрузку (Overload)
    for (const [beamId, load] of loads.entries()) {
        const beam = state.beams.get(beamId);
        if (beam) {
            const mat = BEAM_MATERIALS[beam.materialId];
            if (load > mat.capacity) {
                collapsedBeams.push(beamId);
            } else {
                // Обновляем текущую нагрузку для выживших балок
                state.beams.set(beamId, { ...beam, currentLoad: load });
            }
        }
    }

    // Удаляем рухнувшие балки
    for (const id of collapsedBeams) {
        state.beams.delete(id);
    }

    // 3. Узлы без балок
    for (const node of state.nodes.values()) {
        if (node.isGround) continue;
        let hasBeam = false;
        for (const beam of state.beams.values()) {
            if (beam.nodeAId === node.id || beam.nodeBId === node.id) {
                hasBeam = true; break;
            }
        }
        if (!hasBeam) collapsedNodes.push(node.id);
    }

    for (const id of collapsedNodes) {
        state.nodes.delete(id);
    }

    // 4. Здания без узлов
    if (state.buildings) {
        for (const [bid, b] of state.buildings.entries()) {
            if (!b.nodeIds.some(nid => state.nodes.has(nid))) {
                state.buildings.delete(bid);
            }
        }
    }

    // 5. Повторная проверка операбельности на основе технологий
    if (state.buildings) {
        for (const [bid, b] of state.buildings.entries()) {
            const def = BUILDING_CATALOG[b.defId];
            if (def.techRequired) {
                const hasTech = Array.from(state.buildings.values()).some(
                    other => other.owner === b.owner && other.defId === def.techRequired && other.isOperational
                );
                if (!hasTech && b.isOperational) {
                    state.buildings.set(bid, { ...b, isOperational: false });
                } else if (hasTech && !b.isOperational && b.hp > 0) {
                     // Auto-restore if tech is back (and building wasn't manually disabled)
                     state.buildings.set(bid, { ...b, isOperational: true });
                }
            }
        }
    }

    return { collapsedBeams, collapsedNodes };
}

/**
 * Обновление состояния огня.
 * Огонь наносит урон и распространяется на соседние элементы.
 */
export function updateFire(state: StructuralState): { damagedBeams: string[], damagedBuildings: string[] } {
    const damagedBeams: string[] = [];
    const damagedBuildings: string[] = [];

    // 1. Урон от огня
    for (const [id, beam] of state.beams.entries()) {
        if (beam.fireLevel > 0) {
            const mat = BEAM_MATERIALS[beam.materialId];
            const damage = (beam.fireLevel / 10) * mat.resistances.fire;
            if (damage > 0) {
                state.beams.set(id, { ...beam, hp: beam.hp - damage });
                damagedBeams.push(id);
            }
        }
    }

    if (state.buildings) {
        for (const [id, b] of state.buildings.entries()) {
            if (b.fireLevel > 0) {
                const def = BUILDING_CATALOG[b.defId];
                // У зданий пока нет flammability в каталоге, используем дефолт
                const damage = (b.fireLevel / 10);
                state.buildings.set(id, { ...b, hp: b.hp - damage });
                damagedBuildings.push(id);
            }
        }
    }

    // 2. Распространение огня (упрощенно: каждый ход огонь может перекинуться на соседа)
    // Создаем копии уровней огня, чтобы распространение было "одновременным"
    const nextBeamFire = new Map<string, number>();
    const nextBuildingFire = new Map<string, number>();

    for (const beam of state.beams.values()) {
        let maxAdjFire = beam.fireLevel;
        // Проверяем соседние балки через узлы
        for (const other of state.beams.values()) {
            if (other.id === beam.id) continue;
            if (other.nodeAId === beam.nodeAId || other.nodeAId === beam.nodeBId ||
                other.nodeBId === beam.nodeAId || other.nodeBId === beam.nodeBId) {
                maxAdjFire = Math.max(maxAdjFire, other.fireLevel * 0.8);
            }
        }
        // Проверяем здания на тех же узлах
        if (state.buildings) {
            for (const b of state.buildings.values()) {
                if (b.nodeIds.includes(beam.nodeAId) || b.nodeIds.includes(beam.nodeBId)) {
                    maxAdjFire = Math.max(maxAdjFire, b.fireLevel * 0.8);
                }
            }
        }

        const mat = BEAM_MATERIALS[beam.materialId];
        if (maxAdjFire > 5 && mat.flammability > 0) {
            nextBeamFire.set(beam.id, Math.min(100, Math.max(beam.fireLevel, maxAdjFire * mat.flammability)));
        } else {
            nextBeamFire.set(beam.id, Math.max(0, beam.fireLevel - 5)); // Огонь затухает сам
        }
    }

    // Аналогично для зданий... (пропущено для краткости, логика идентична)

    for (const [id, fire] of nextBeamFire) {
        const b = state.beams.get(id);
        if (b) state.beams.set(id, { ...b, fireLevel: fire });
    }

    return { damagedBeams, damagedBuildings };
}

/**
 * Пожаротушение от специальных зданий.
 */
export function applySuppressors(state: StructuralState) {
    if (!state.buildings) return;
    const suppressors = Array.from(state.buildings.values()).filter(b => b.defId === "fire_suppressor" && b.isOperational && b.isPowered);

    for (const s of suppressors) {
        const sNode = state.nodes.get(s.nodeIds[0]!)!;
        // Тушим в радиусе 5 клеток
        for (const [id, beam] of state.beams.entries()) {
            const nA = state.nodes.get(beam.nodeAId)!;
            const dist = Math.sqrt((nA.x - sNode.x)**2 + (nA.y - sNode.y)**2);
            if (dist < 5) {
                state.beams.set(id, { ...beam, fireLevel: Math.max(0, beam.fireLevel - 20) });
            }
        }
        for (const [id, b] of state.buildings.entries()) {
            const bNode = state.nodes.get(b.nodeIds[0]!)!;
            const dist = Math.sqrt((bNode.x - sNode.x)**2 + (bNode.y - sNode.y)**2);
            if (dist < 5) {
                state.buildings.set(id, { ...b, fireLevel: Math.max(0, b.fireLevel - 20) });
            }
        }
    }
}

/**
 * Обновление энергосети.
 * Питание идет от генераторов через проводящие материалы.
 */
export function updatePowerGrid(state: StructuralState) {
    const poweredNodes = new Set<string>();
    const queue: string[] = [];

    // 1. Находим все работающие генераторы
    if (state.buildings) {
        for (const b of state.buildings.values()) {
            const def = BUILDING_CATALOG[b.defId];
            if ((def.kind === "core_generator" || def.kind === "generator") && b.isOperational) {
                for (const nid of b.nodeIds) {
                    poweredNodes.add(nid);
                    queue.push(nid);
                }
            }
        }
    }

    // 2. BFS по проводящим балкам
    let head = 0;
    while (head < queue.length) {
        const nodeId = queue[head++]!;
        for (const beam of state.beams.values()) {
            const mat = BEAM_MATERIALS[beam.materialId];
            if (!mat.conductivity && beam.materialId !== "energy_shield") continue; // Щиты проводят "магически"

            if (beam.nodeAId === nodeId && !poweredNodes.has(beam.nodeBId)) {
                poweredNodes.add(beam.nodeBId);
                queue.push(beam.nodeBId);
            } else if (beam.nodeBId === nodeId && !poweredNodes.has(beam.nodeAId)) {
                poweredNodes.add(beam.nodeAId);
                queue.push(beam.nodeAId);
            }
        }
    }

    // 3. Обновляем статус питания
    for (const [id, beam] of state.beams.entries()) {
        const isPowered = poweredNodes.has(beam.nodeAId) && poweredNodes.has(beam.nodeBId);
        state.beams.set(id, { ...beam, isPowered });
    }

    if (state.buildings) {
        for (const [id, b] of state.buildings.entries()) {
            const isPowered = b.nodeIds.every(nid => poweredNodes.has(nid));
            state.buildings.set(id, { ...b, isPowered });
        }
    }
}
