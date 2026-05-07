/**
 * Игровая логика прототипа: Build (новые блоки + ремонт), Arm по колонке, Fortify.
 *
 * Arm — трассировка **от «домашнего» края атакующего к противнику**:
 * - игрок 0 (низ карты): y от height−1 вниз к 0;
 * - игрок 1 (верх): y от 0 вверх к height−1.
 * Бьём только **чужие** живые клетки (ядро/блок); свои клетки в колонке не останавливают луч
 * (MVP: упрощённая линия огня без дружественного огня по своим).
 *
 * Fortify за выстрел (pierce): у защищающегося один пул `savedFortifyCharges` на всю цепочку попаданий.
 * По каждому попаданию: `applyFortifyChargesToDamage(базовыйУронВыстрела, оставшиесяЗаряды)` — урон и заряды
 * уменьшаются как в `rules.ts`, остаток зарядов переносится на следующую клетку пробития.
 */

import {
    DICE_FORTS_ARM_THRESHOLD,
    DICE_FORTS_BLOCK_HP,
    DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND,
    DICE_FORTS_REROLLS_PER_ROUND,
} from "./constants.js";
import { rollDiceFortsHand } from "./rules.js";
import type { Rng } from "./types.js";
import { applyFortifyChargesToDamage } from "./rules.js";
import type { MatchState, Cell, PlayerId } from "./state.js";
import {
    inBounds,
    livingCell,
    opponentOf,
    declareWinner,
    patchPlayerSecrets,
    setCell,
} from "./state.js";
import type { ArmHitTarget } from "./log.js";

const ADJ4: readonly [number, number][] = [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
];

export function initializeTurnRerolls(state: MatchState): MatchState {
    return { ...state, rerollsLeftThisTurn: DICE_FORTS_REROLLS_PER_ROUND };
}

export function applyHandReroll(
    state: MatchState,
    rng: Rng
): { state: MatchState; hand: number[] } | null {
    if (state.rerollsLeftThisTurn <= 0) return null;
    return {
        state: { ...state, rerollsLeftThisTurn: state.rerollsLeftThisTurn - 1 },
        hand: rollDiceFortsHand(rng),
    };
}

export function shouldBotReroll(hand: readonly number[], rerollsLeft: number): boolean {
    return rerollsLeft > 0 && hand.every((v) => v < DICE_FORTS_ARM_THRESHOLD);
}

export function hasOwnedBuiltNeighbor(state: MatchState, playerId: PlayerId, x: number, y: number): boolean {
    for (const [dx, dy] of ADJ4) {
        const nx = x + dx;
        const ny = y + dy;
        if (!inBounds(state, nx, ny)) continue;
        const c = state.grid[ny]![nx]!;
        if (!livingCell(c)) continue;
        if (c.owner === playerId && (c.kind === "block" || c.kind === "core")) {
            return true;
        }
    }
    return false;
}

export type BuildCommand =
    | { type: "new"; x: number; y: number; spend: number }
    | { type: "repair"; x: number; y: number; spend: number };

/** Идемпотентная проверка одной команды Build; не мутирует state. */
export function validateBuildCommand(
    state: MatchState,
    playerId: PlayerId,
    cmd: BuildCommand,
    budget: number,
    repairUsed: Readonly<Record<string, number>>
): string | null {
    if (cmd.spend < 1) return "spend must be >= 1";
    if (cmd.spend > budget) return "not enough build points";
    if (!inBounds(state, cmd.x, cmd.y)) return "out of bounds";

    const cell = state.grid[cmd.y]![cmd.x]!;

    if (cmd.type === "new") {
        if (cell.kind !== "empty") return "cell is not empty";
        if (!hasOwnedBuiltNeighbor(state, playerId, cmd.x, cmd.y)) return "not adjacent to your structure";
        if (cmd.spend > DICE_FORTS_BLOCK_HP) return `new block HP cannot exceed ${DICE_FORTS_BLOCK_HP}`;
        return null;
    }

    if (cell.kind === "empty") return "nothing to repair";
    if (cell.owner !== playerId) return "not your cell";
    if (!livingCell(cell)) return "cell is destroyed";
    const capLeft = DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND - (repairUsed[`${cmd.x},${cmd.y}`] ?? 0);
    if (capLeft <= 0) return "repair cap for this cell this turn reached";
    const missing = cell.maxHp - cell.hp;
    if (missing <= 0) return "already full HP";
    if (cmd.spend > capLeft) return `repair cannot exceed cap ${capLeft} for this cell`;
    if (cmd.spend > missing) return `repair cannot exceed missing ${missing} HP`;
    return null;
}

/** Применить одну валидную команду Build. */
export function applyBuildCommand(
    state: MatchState,
    playerId: PlayerId,
    cmd: BuildCommand,
    budget: number,
    repairUsed: Record<string, number>
): { state: MatchState; budget: number } | null {
    const err = validateBuildCommand(state, playerId, cmd, budget, repairUsed);
    if (err) return null;

    const cell = state.grid[cmd.y]![cmd.x]!;

    if (cmd.type === "new") {
        const hp = Math.min(cmd.spend, DICE_FORTS_BLOCK_HP);
        const next: Cell = {
            kind: "block",
            owner: playerId,
            hp,
            maxHp: DICE_FORTS_BLOCK_HP,
        };
        const s = setCell(state, cmd.x, cmd.y, next);
        return { state: s, budget: budget - cmd.spend };
    }

    const key = `${cmd.x},${cmd.y}`;
    const nu = repairUsed[key] ?? 0;
    repairUsed[key] = nu + cmd.spend;
    const nextHp = cell.hp + cmd.spend;
    const nextCell: Cell = { ...cell, hp: Math.min(nextHp, cell.maxHp) };
    return { state: setCell(state, cmd.x, cmd.y, nextCell), budget: budget - cmd.spend };
}

/** Живые клетки противника в колонке в порядке луча (для пробития). */
export function listEnemyHitsInColumn(
    state: MatchState,
    attackerId: PlayerId,
    x: number
): { x: number; y: number }[] {
    const hits: { x: number; y: number }[] = [];
    const opp = opponentOf(attackerId);
    const { height } = state;

    const ys =
        attackerId === 0
            ? Array.from({ length: height }, (_, i) => height - 1 - i)
            : Array.from({ length: height }, (_, i) => i);

    for (const y of ys) {
        const cell = state.grid[y]![x]!;
        if (!livingCell(cell)) continue;
        if (cell.owner === opp) hits.push({ x, y });
    }
    return hits;
}

/**
 * Одна атака Arm по колонке `x`; возвращает обновлённое состояние и оставшиеся заряды защиты.
 */
export function applyArmColumnAttack(
    state: MatchState,
    attackerId: PlayerId,
    x: number,
    baseDamage: number,
    pierceDepth: number,
    defenderCharges: number
): {
    state: MatchState;
    chargesRemaining: number;
    targetsHit: ArmHitTarget[];
    fortifyApplications: { chargesBefore: number; absorbed: number; chargesAfter: number }[];
} {
    let s = state;
    let charges = defenderCharges;
    const targetsHit: ArmHitTarget[] = [];
    const fortifyApplications: { chargesBefore: number; absorbed: number; chargesAfter: number }[] = [];

    const targets = listEnemyHitsInColumn(s, attackerId, x);
    const maxHits = 1 + Math.max(0, pierceDepth);
    let hitCount = 0;

    for (const { x: tx, y: ty } of targets) {
        if (hitCount >= maxHits) break;
        const cell = s.grid[ty]![tx]!;
        if (!livingCell(cell) || cell.owner !== opponentOf(attackerId)) continue;

        const chargesBefore = charges;
        const { damageRemaining, chargesRemaining } = applyFortifyChargesToDamage(baseDamage, charges);
        const absorbed = Math.max(0, baseDamage - damageRemaining);
        charges = chargesRemaining;
        fortifyApplications.push({ chargesBefore, absorbed, chargesAfter: chargesRemaining });
        hitCount += 1;

        const nextHp = cell.hp - damageRemaining;
        const destroyed = nextHp <= 0;
        const hpAfter = destroyed ? 0 : nextHp;
        const targetKind: "block" | "core" = cell.kind === "core" ? "core" : "block";
        targetsHit.push({
            x: tx,
            y: ty,
            kind: targetKind,
            hpBefore: cell.hp,
            hpAfter,
            destroyed,
        });
        if (nextHp <= 0) {
            if (cell.kind === "core") {
                s = declareWinner(setCell(s, tx, ty, { kind: "empty", owner: null, hp: 0, maxHp: 0 }), attackerId);
            } else {
                s = setCell(s, tx, ty, { kind: "empty", owner: null, hp: 0, maxHp: 0 });
            }
        } else {
            s = setCell(s, tx, ty, { ...cell, hp: nextHp });
        }

        if (s.winner !== null) break;
    }

    return { state: s, chargesRemaining: charges, targetsHit, fortifyApplications };
}

export function endTurnUpdateFortify(state: MatchState, playerId: PlayerId, fortifyCharges: number): MatchState {
    return patchPlayerSecrets(state, playerId, { savedFortifyCharges: fortifyCharges });
}

export function advanceCurrentPlayer(state: MatchState): MatchState {
    const next: PlayerId = state.currentPlayer === 0 ? 1 : 0;
    return { ...state, currentPlayer: next };
}
