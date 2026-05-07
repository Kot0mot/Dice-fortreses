/**
 * Состояние матча: сетка width×height, два игрока, заряды Fortify с прошлого хода защищающегося.
 */

import {
    DICE_FORTS_BLOCK_HP,
    DICE_FORTS_CORE_HP,
    DICE_FORTS_GRID_HEIGHT,
    DICE_FORTS_GRID_WIDTH,
    DICE_FORTS_REROLLS_PER_ROUND,
} from "./constants.js";

export type PlayerId = 0 | 1;

export type CellKind = "empty" | "block" | "core";

export interface Cell {
    readonly kind: CellKind;
    /** Владелец содержимого; для empty не используется (null). */
    readonly owner: PlayerId | null;
    readonly hp: number;
    readonly maxHp: number;
}

export interface PlayerSecrets {
    /** Заряды Fortify с последнего завершённого хода этого игрока — тратятся при входящем уроне. */
    savedFortifyCharges: number;
}

export interface MatchState {
    readonly width: number;
    readonly height: number;
    /** grid[y][x] */
    readonly grid: Cell[][];
    readonly players: readonly [PlayerSecrets, PlayerSecrets];
    readonly currentPlayer: PlayerId;
    readonly rerollsLeftThisTurn: number;
    readonly winner: PlayerId | null;
}

/** Стартовые координаты (явно): ядра на центральной линии, блоки по бокам на крайнем ряду у каждого. */
export const P0_CORE_X = 5;
export const P0_CORE_Y = DICE_FORTS_GRID_HEIGHT - 1;
export const P1_CORE_X = 5;
export const P1_CORE_Y = 0;
export const P0_BLOCK_PAIRS: readonly [readonly [number, number], readonly [number, number]] = [
    [4, P0_CORE_Y],
    [6, P0_CORE_Y],
];
export const P1_BLOCK_PAIRS: readonly [readonly [number, number], readonly [number, number]] = [
    [4, P1_CORE_Y],
    [6, P1_CORE_Y],
];

function emptyCell(): Cell {
    return { kind: "empty", owner: null, hp: 0, maxHp: 0 };
}

function blockCell(owner: PlayerId): Cell {
    return { kind: "block", owner, hp: DICE_FORTS_BLOCK_HP, maxHp: DICE_FORTS_BLOCK_HP };
}

function coreCell(owner: PlayerId): Cell {
    return { kind: "core", owner, hp: DICE_FORTS_CORE_HP, maxHp: DICE_FORTS_CORE_HP };
}

function cloneGrid(grid: Cell[][]): Cell[][] {
    return grid.map((row) => row.map((c) => ({ ...c })));
}

export function createInitialMatchState(): MatchState {
    const grid: Cell[][] = [];
    for (let y = 0; y < DICE_FORTS_GRID_HEIGHT; y++) {
        const row: Cell[] = [];
        for (let x = 0; x < DICE_FORTS_GRID_WIDTH; x++) {
            row.push(emptyCell());
        }
        grid.push(row);
    }

    const set = (x: number, y: number, cell: Cell) => {
        grid[y]![x] = cell;
    };

    set(P0_CORE_X, P0_CORE_Y, coreCell(0));
    set(P1_CORE_X, P1_CORE_Y, coreCell(1));
    for (const [bx, by] of P0_BLOCK_PAIRS) {
        set(bx, by, blockCell(0));
    }
    for (const [bx, by] of P1_BLOCK_PAIRS) {
        set(bx, by, blockCell(1));
    }

    return {
        width: DICE_FORTS_GRID_WIDTH,
        height: DICE_FORTS_GRID_HEIGHT,
        grid,
        players: [{ savedFortifyCharges: 0 }, { savedFortifyCharges: 0 }],
        currentPlayer: 0,
        rerollsLeftThisTurn: DICE_FORTS_REROLLS_PER_ROUND,
        winner: null,
    };
}

/** Клетки в пределах сетки. */
export function inBounds(state: Pick<MatchState, "width" | "height">, x: number, y: number): boolean {
    return x >= 0 && x < state.width && y >= 0 && y < state.height;
}

export function livingCell(cell: Cell): boolean {
    if (cell.kind === "empty") return false;
    return cell.hp > 0;
}

export function opponentOf(p: PlayerId): PlayerId {
    return p === 0 ? 1 : 0;
}

export function setCell(state: MatchState, x: number, y: number, cell: Cell): MatchState {
    const grid = cloneGrid(state.grid);
    grid[y]![x] = cell;
    return { ...state, grid };
}

export function patchPlayerSecrets(
    state: MatchState,
    playerId: PlayerId,
    patch: Partial<PlayerSecrets>
): MatchState {
    const players: [PlayerSecrets, PlayerSecrets] = [{ ...state.players[0]! }, { ...state.players[1]! }];
    players[playerId] = { ...players[playerId]!, ...patch };
    return { ...state, players };
}

export function declareWinner(state: MatchState, winner: PlayerId): MatchState {
    return { ...state, winner };
}
