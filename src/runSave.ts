import type { MatchState } from "./state.js";
import type { DiceFortsSlotResolution } from "./types.js";

export const RUN_SAVE_FORMAT_VERSION = "1.0";

export type SavedUiPhase = "roll" | "slots" | "build" | "arm" | "end";

export interface SavedUiState {
    round: number;
    phase: SavedUiPhase;
    hand: number[];
    slotAssignments: ("build" | "fortify" | "arm")[];
    slotResolution: DiceFortsSlotResolution | null;
    buildBudgetLeft: number;
    repairUsed: Record<string, number>;
    lastMessage: string;
    gameMode?: "hotseat" | "vsBot";
    isBotActing?: boolean;
}

export interface SavedRunFile {
    formatVersion: string;
    seed: number;
    rngState: number;
    uiState: SavedUiState;
    matchState: MatchState;
    log?: string[];
}

export class RunSaveFormatError extends Error {}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
}

function isSavedPhase(value: unknown): value is SavedUiPhase {
    return value === "roll" || value === "slots" || value === "build" || value === "arm" || value === "end";
}

function assertValidSavedUiState(value: unknown): asserts value is SavedUiState {
    if (!isObject(value)) throw new RunSaveFormatError("Invalid save: uiState must be an object.");
    if (!Number.isInteger(value.round)) throw new RunSaveFormatError("Invalid save: uiState.round must be an integer.");
    if (!isSavedPhase(value.phase)) throw new RunSaveFormatError("Invalid save: uiState.phase is not supported.");
    if (!Array.isArray(value.hand) || !value.hand.every(Number.isInteger)) {
        throw new RunSaveFormatError("Invalid save: uiState.hand must be integer array.");
    }
    if (
        !Array.isArray(value.slotAssignments) ||
        !value.slotAssignments.every((slot) => slot === "build" || slot === "fortify" || slot === "arm")
    ) {
        throw new RunSaveFormatError("Invalid save: uiState.slotAssignments is malformed.");
    }
    if (!Number.isInteger(value.buildBudgetLeft)) {
        throw new RunSaveFormatError("Invalid save: uiState.buildBudgetLeft must be integer.");
    }
    if (!isObject(value.repairUsed)) throw new RunSaveFormatError("Invalid save: uiState.repairUsed must be an object.");
    if (typeof value.lastMessage !== "string") throw new RunSaveFormatError("Invalid save: uiState.lastMessage must be string.");
    if (value.gameMode !== undefined && value.gameMode !== "hotseat" && value.gameMode !== "vsBot") {
        throw new RunSaveFormatError("Invalid save: uiState.gameMode must be hotseat or vsBot.");
    }
    if (value.isBotActing !== undefined && typeof value.isBotActing !== "boolean") {
        throw new RunSaveFormatError("Invalid save: uiState.isBotActing must be boolean.");
    }
}

function assertValidMatchState(value: unknown): asserts value is MatchState {
    if (!isObject(value)) throw new RunSaveFormatError("Invalid save: matchState must be an object.");
    if (!Number.isInteger(value.width) || !Number.isInteger(value.height)) {
        throw new RunSaveFormatError("Invalid save: matchState dimensions must be integers.");
    }
    if (!Array.isArray(value.grid)) throw new RunSaveFormatError("Invalid save: matchState.grid must be an array.");
    if (!Array.isArray(value.players) || value.players.length !== 2) {
        throw new RunSaveFormatError("Invalid save: matchState.players must have two entries.");
    }
    if (value.currentPlayer !== 0 && value.currentPlayer !== 1) {
        throw new RunSaveFormatError("Invalid save: matchState.currentPlayer must be 0 or 1.");
    }
    if (value.winner !== null && value.winner !== 0 && value.winner !== 1) {
        throw new RunSaveFormatError("Invalid save: matchState.winner must be 0, 1 or null.");
    }
}

export function serializeSavedRun(payload: SavedRunFile): string {
    return JSON.stringify(payload, null, 2);
}

export function deserializeSavedRun(raw: string): SavedRunFile {
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new RunSaveFormatError("Invalid save: file is not valid JSON.");
    }
    if (!isObject(parsed)) throw new RunSaveFormatError("Invalid save: root must be an object.");
    if (parsed.formatVersion !== RUN_SAVE_FORMAT_VERSION) {
        throw new RunSaveFormatError(
            `Incompatible save version: expected ${RUN_SAVE_FORMAT_VERSION}, got ${String(parsed.formatVersion)}.`
        );
    }
    if (!Number.isInteger(parsed.seed)) throw new RunSaveFormatError("Invalid save: seed must be integer.");
    if (!Number.isInteger(parsed.rngState)) throw new RunSaveFormatError("Invalid save: rngState must be integer.");
    assertValidSavedUiState(parsed.uiState);
    assertValidMatchState(parsed.matchState);
    if (parsed.log !== undefined && (!Array.isArray(parsed.log) || !parsed.log.every((x) => typeof x === "string"))) {
        throw new RunSaveFormatError("Invalid save: log must be an array of strings.");
    }
    return {
        formatVersion: parsed.formatVersion,
        seed: parsed.seed,
        rngState: parsed.rngState,
        uiState: parsed.uiState,
        matchState: parsed.matchState,
        log: parsed.log,
    } as SavedRunFile;
}
