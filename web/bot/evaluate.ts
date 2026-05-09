import { listEnemyHitsInColumn } from "../../src/game.js";
import type { Cell, MatchState, PlayerId } from "../../src/state.js";
import { livingCell, opponentOf } from "../../src/state.js";

export interface ArmColumnEvaluation {
    column: number;
    score: number;
}

export function averageHand(hand: readonly number[]): number {
    if (hand.length === 0) return 0;
    return hand.reduce((sum, value) => sum + value, 0) / hand.length;
}

export function evaluateArmColumnPotential(
    state: MatchState,
    playerId: PlayerId,
    damage: number,
    pierceDepth: number
): ArmColumnEvaluation[] {
    const evaluations: ArmColumnEvaluation[] = [];
    for (let x = 0; x < state.width; x++) {
        const hits = listEnemyHitsInColumn(state, playerId, x);
        if (hits.length === 0) continue;
        let score = 0;
        for (let idx = 0; idx < Math.min(pierceDepth, hits.length); idx++) {
            const target = hits[idx];
            if (!target) continue;
            const cell = state.grid[target.y]![target.x]!;
            const depthWeight = 10 - idx * 2;
            const breakBonus = cell.hp <= damage ? 8 : 0;
            const hpPressure = Math.max(0, damage - cell.hp);
            const coreBonus = cell.kind === "core" ? 30 : 0;
            score += depthWeight + breakBonus + hpPressure + coreBonus;
        }
        evaluations.push({ column: x, score });
    }
    evaluations.sort((a, b) => b.score - a.score);
    return evaluations;
}

export function findOwnedCore(state: MatchState, playerId: PlayerId): { x: number; y: number } | null {
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind === "core" && cell.owner === playerId && livingCell(cell)) {
                return { x, y };
            }
        }
    }
    return null;
}

export function vulnerabilityScoreNearCore(
    state: MatchState,
    playerId: PlayerId,
    x: number,
    y: number
): number {
    const core = findOwnedCore(state, playerId);
    if (!core) return 0;
    const distance = Math.abs(core.x - x) + Math.abs(core.y - y);
    const proximityWeight = Math.max(0, 8 - distance);
    const enemyPressure = countEnemyNeighbors(state, playerId, x, y) * 2;
    return proximityWeight + enemyPressure;
}

function countEnemyNeighbors(state: MatchState, playerId: PlayerId, x: number, y: number): number {
    const enemy = opponentOf(playerId);
    let count = 0;
    const deltas: readonly [number, number][] = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
    ];
    for (const [dx, dy] of deltas) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= state.width || ny >= state.height) continue;
        const cell = state.grid[ny]![nx]!;
        if (cell.kind !== "empty" && cell.owner === enemy && livingCell(cell)) {
            count += 1;
        }
    }
    return count;
}

export function isDamagedOwnedCell(cell: Cell, playerId: PlayerId): boolean {
    return cell.kind !== "empty" && cell.owner === playerId && livingCell(cell) && cell.hp < cell.maxHp;
}
