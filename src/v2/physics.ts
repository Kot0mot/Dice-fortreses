import type { V2Node, V2Beam, OwnerId } from "./mapTypes.js";
import { BEAM_MATERIALS } from "./mapTypes.js";

export interface StructuralState {
    nodes: Map<string, V2Node>;
    beams: Map<string, V2Beam>;
}

/** Простейшая проверка связности с землей. */
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
 * Расчет статической нагрузки (упрощенно).
 * В идеале здесь должен быть расчет моментов и сил, но для MVP сделаем "накопление веса" сверху вниз.
 * Для каждой балки: нагрузка = вес самой балки + вес зданий на ней + вес балок, которые она держит.
 */
export function calculateLoads(state: StructuralState, buildingWeights: Map<string, number>): Map<string, number> {
    const beamLoads = new Map<string, number>();

    // Сначала считаем собственный вес балок
    for (const beam of state.beams.values()) {
        const mat = BEAM_MATERIALS[beam.materialId];
        beamLoads.set(beam.id, mat.weight);
    }

    // Добавляем вес зданий
    for (const [buildingId, weight] of buildingWeights) {
        // Упрощенно: распределяем вес здания между балоками, к которым привязаны его узлы
        // Но в этой модели здания на узлах. Для простоты игнорируем пока сложную дистрибуцию.
    }

    return beamLoads;
}

/** Проверка на обрушение */
export function performCollapse(state: StructuralState): { collapsedBeams: string[]; collapsedNodes: string[] } {
    const connectedNodes = checkConnectivity(state);
    const collapsedBeams: string[] = [];
    const collapsedNodes: string[] = [];

    // 1. Балки, потерявшие связь с землей
    for (const beam of state.beams.values()) {
        if (!connectedNodes.has(beam.nodeAId) || !connectedNodes.has(beam.nodeBId)) {
            collapsedBeams.push(beam.id);
        }
    }

    // Удаляем рухнувшие балки
    for (const id of collapsedBeams) {
        state.beams.delete(id);
    }

    // 2. Узлы, оставшиеся без балок и не на земле
    for (const node of state.nodes.values()) {
        if (node.isGround) continue;
        let hasBeam = false;
        for (const beam of state.beams.values()) {
            if (beam.nodeAId === node.id || beam.nodeBId === node.id) {
                hasBeam = true;
                break;
            }
        }
        if (!hasBeam) {
            collapsedNodes.push(node.id);
        }
    }

    // Удаляем рухнувшие узлы
    for (const id of collapsedNodes) {
        state.nodes.delete(id);
    }

    return { collapsedBeams, collapsedNodes };
}
