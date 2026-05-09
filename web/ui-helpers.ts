import type { DiceFortsSlots } from "../src/types.js";
import { DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND } from "../src/constants.js";
import { hasOwnedBuiltNeighbor, listEnemyHitsInColumn } from "../src/game.js";
import { livingCell, type MatchState, type PlayerId } from "../src/state.js";

export type SlotName = "build" | "fortify" | "arm";
export type UiLogCategory = "dice" | "build" | "combat" | "system";

export interface UiLogEntry {
    ts: number;
    turn: number;
    playerId: PlayerId;
    category: UiLogCategory;
    message: string;
}

export function slotsFromAssignments(
    hand: readonly number[],
    assignments: readonly SlotName[]
): DiceFortsSlots | null {
    if (hand.length !== assignments.length) return null;

    const build: number[] = [];
    const fortify: number[] = [];
    const arm: number[] = [];

    for (let i = 0; i < hand.length; i++) {
        const die = hand[i];
        const slot = assignments[i];
        if (die === undefined || slot === undefined) return null;
        if (slot === "build") build.push(die);
        if (slot === "fortify") fortify.push(die);
        if (slot === "arm") arm.push(die);
    }

    return { build, fortify, arm };
}

export function parseColumn(value: string, width: number): number | null {
    const n = Number(value.trim());
    if (!Number.isInteger(n)) return null;
    if (n < 0 || n >= width) return null;
    return n;
}

export function getValidNewCells(
    state: MatchState,
    playerId: PlayerId
): Array<{ x: number; y: number }> {
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind !== "empty") continue;
            if (!hasOwnedBuiltNeighbor(state, playerId, x, y)) continue;
            cells.push({ x, y });
        }
    }
    return cells;
}

export function getBuildTargets(
    state: MatchState,
    playerId: PlayerId
): Array<{ x: number; y: number }> {
    return getValidNewCells(state, playerId);
}

export function getValidRepairCells(
    state: MatchState,
    playerId: PlayerId,
    repairUsed: Readonly<Record<string, number>>
): Array<{ x: number; y: number }> {
    const cells: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.owner !== playerId) continue;
            if (!livingCell(cell)) continue;
            if (cell.maxHp - cell.hp <= 0) continue;
            const key = `${x},${y}`;
            const capLeft = DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND - (repairUsed[key] ?? 0);
            if (capLeft <= 0) continue;
            cells.push({ x, y });
        }
    }
    return cells;
}

export function getRepairTargets(
    state: MatchState,
    playerId: PlayerId,
    repairUsed: Readonly<Record<string, number>>
): Array<{ x: number; y: number }> {
    return getValidRepairCells(state, playerId, repairUsed);
}

export function getValidArmColumns(state: MatchState, playerId: PlayerId): number[] {
    const cols: number[] = [];
    for (let x = 0; x < state.width; x++) {
        if (listEnemyHitsInColumn(state, playerId, x).length > 0) {
            cols.push(x);
        }
    }
    return cols;
}

export function getArmTargets(state: MatchState, playerId: PlayerId): number[] {
    return getValidArmColumns(state, playerId);
}

export function canRunUiPhaseAction(
    currentPhase: string,
    expectedPhase: string,
    winner: number | null,
    isBotActing: boolean
): boolean {
    if (currentPhase !== expectedPhase) return false;
    if (winner !== null) return false;
    if (isBotActing) return false;
    return true;
}

export function filterUiLogEntries(
    entries: readonly UiLogEntry[],
    filters: Readonly<Record<UiLogCategory, boolean>>
): UiLogEntry[] {
    return entries.filter((entry) => filters[entry.category]);
}
