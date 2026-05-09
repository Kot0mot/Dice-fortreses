import type { V2MatchState } from "./matchState.js";
import { BUILDING_CATALOG, DICE_TEMPLATES } from "./catalog.js";
import { rollCustomDie, type RolledDieResult } from "./customDie.js";
import type { Rng } from "./types.js";
import { applyDiceResults, rollInitialDice } from "./diceSystems.js";
import { tryPlaceNode, tryPlaceBeam, tryPlaceBuilding } from "./matchState.js";
import { fireWeapon, isWithinFiringCone } from "./combat.js";
import { performCollapse } from "./physics.js";

export type AiDifficulty = "easy" | "medium" | "hard";

export interface AiTurnResult {
    readonly nextState: V2MatchState;
    readonly actions: string[];
}

export function runAiTurn(state: V2MatchState, difficulty: AiDifficulty, rng: Rng): AiTurnResult {
    let curr = state;
    const actions: string[] = [];
    const player = curr.currentPlayer;

    // 1. Бросок кубиков
    let { results, nextState } = rollInitialDice(curr, rng);
    curr = nextState;

    // AI Рероллы (Medium/Hard перебрасывают если мало стали)
    if (difficulty !== "easy" && curr.rerollsLeft > 0) {
        const hasLittleSteel = results.filter(r => r.yield.resourceId === "steel").length < 2;
        if (hasLittleSteel) {
            results = rollInitialDice(curr, rng).results;
            curr = { ...curr, rerollsLeft: curr.rerollsLeft - 1 };
        }
    }

    curr = applyDiceResults(curr, results);
    actions.push("AI rolled and applied dice.");

    // 2. Фаза строительства
    const eco = curr.economy[player];
    let steel = eco.resources.steel ?? 0;

    // Упрощенная логика стройки
    if (steel >= 5) {
        // Попробуем построить металлическую балку вверх от существующего узла
        const myNodes = Array.from(curr.nodes.values()).filter(n => n.owner === player);
        if (myNodes.length > 0) {
            const baseNode = myNodes[rng.nextInt(0, myNodes.length - 1)]!;
            const targetX = baseNode.x;
            const targetY = baseNode.y - 1;

            if (targetY > 5) {
                let s2 = tryPlaceNode(curr, targetX, targetY, player);
                if (s2 !== curr) {
                    curr = s2;
                    const newNodeId = `node-${player}-${targetX}-${targetY}`;
                    curr = tryPlaceBeam(curr, baseNode.id, newNodeId, difficulty === "hard" ? "metal" : "wood", player);
                    actions.push(`AI built at (${targetX}, ${targetY})`);
                }
            }
        }
    }

    // Попробуем построить пулемет если есть узлы
    if (difficulty !== "easy" && (eco.resources.steel ?? 0) >= 15) {
        const myNodes = Array.from(curr.nodes.values()).filter(n => n.owner === player && !n.isGround);
        if (myNodes.length > 0) {
            const node = myNodes[0]!;
            const s2 = tryPlaceBuilding(curr, "machine_gun", [node.id], player);
            if (s2 !== curr) {
                curr = s2;
                actions.push("AI built a machine gun.");
            }
        }
    }

    // Проверка физики после стройки
    const physState = { nodes: new Map(curr.nodes), beams: new Map(curr.beams), buildings: new Map(curr.buildings) };
    performCollapse(physState);
    curr = { ...curr, nodes: physState.nodes, beams: physState.beams, buildings: physState.buildings! };

    // 3. Фаза боя
    const myWeapons = Array.from(curr.buildings.values()).filter(b => b.owner === player && BUILDING_CATALOG[b.defId].kind === "weapon" && b.isOperational);
    const enemyPlayer = player === 0 ? 1 : 0;
    const enemyCores = Array.from(curr.buildings.values()).filter(b => b.owner === enemyPlayer && b.defId === "core_generator");

    for (const w of myWeapons) {
        const weaponNode = curr.nodes.get(w.nodeIds[0]!)!;
        let targetX = 0, targetY = 0;

        if (difficulty === "easy") {
            targetX = player === 0 ? 30 : 10;
            targetY = 15;
        } else {
            // Medium/Hard целятся в ядро или случайные здания
            if (enemyCores.length > 0) {
                const coreNode = curr.nodes.get(enemyCores[0]!.nodeIds[0]!)!;
                targetX = coreNode.x;
                targetY = coreNode.y;
            }
        }

        if (isWithinFiringCone(weaponNode.x, weaponNode.y, targetX, targetY, player)) {
            const { nextState, result } = fireWeapon(curr, w.id, targetX, targetY);
            curr = nextState;
            if (result) actions.push(`AI fired at (${targetX}, ${targetY})`);
        }
    }

    // Конец хода
    curr = { ...curr, currentPlayer: enemyPlayer, turnPhase: "dice", rerollsLeft: 2 };
    return { nextState: curr, actions };
}
