import { DICE_FORTS_ARM_THRESHOLD, DICE_FORTS_BLOCK_HP } from "../constants.js";
import { hasOwnedBuiltNeighbor, listEnemyHitsInColumn, shouldBotReroll, validateBuildCommand } from "../game.js";
import type { Cell, MatchState } from "../state.js";
import { livingCell, opponentOf } from "../state.js";
import type { BotArmContext, BotBuildContext, BotName, BotStrategy, BotTurnContext } from "./types.js";

function sortDesc(values: readonly number[]): number[] {
    return [...values].sort((a, b) => b - a);
}

function maybeRerollByThreshold(ctx: BotTurnContext, threshold: number): boolean {
    return ctx.rerollsLeft > 0 && ctx.hand.every((v) => v < threshold);
}

function allocateByPlan(hand: readonly number[], armCount: number, fortifyCount: number) {
    const sorted = sortDesc(hand);
    const arm = sorted.slice(0, armCount);
    const fortify = sorted.slice(armCount, armCount + fortifyCount);
    const build = sorted.slice(armCount + fortifyCount);
    return { build, fortify, arm };
}

function findDamagedOwnedCells(state: MatchState, playerId: 0 | 1): { x: number; y: number; cell: Cell }[] {
    const out: { x: number; y: number; cell: Cell }[] = [];
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.owner !== playerId || !livingCell(cell) || cell.hp >= cell.maxHp) continue;
            out.push({ x, y, cell });
        }
    }
    return out;
}

function buildForwardNewBlockCommands(state: MatchState, playerId: 0 | 1, budget: number): { x: number; y: number; spend: number }[] {
    const commands: { x: number; y: number; spend: number }[] = [];
    const yOrder = playerId === 0
        ? Array.from({ length: state.height }, (_, idx) => state.height - 1 - idx)
        : Array.from({ length: state.height }, (_, idx) => idx);
    let pointsLeft = budget;
    for (const y of yOrder) {
        for (let x = 0; x < state.width; x++) {
            if (pointsLeft <= 0) break;
            const cell = state.grid[y]![x]!;
            if (cell.kind !== "empty") continue;
            if (!hasOwnedBuiltNeighbor(state, playerId, x, y)) continue;
            const spend = Math.min(pointsLeft, DICE_FORTS_BLOCK_HP);
            commands.push({ x, y, spend });
            pointsLeft -= spend;
        }
        if (pointsLeft <= 0) break;
    }
    return commands;
}

function bestArmColumnByScore(ctx: BotArmContext, coreWeight: number): number | null {
    let best: { x: number; score: number } | null = null;
    for (let x = 0; x < ctx.state.width; x++) {
        const targets = listEnemyHitsInColumn(ctx.state, ctx.playerId, x);
        if (targets.length === 0) continue;
        let score = 0;
        for (let idx = 0; idx < targets.length; idx++) {
            const t = targets[idx]!;
            const c = ctx.state.grid[t.y]![t.x]!;
            const distanceWeight = 10 - idx;
            score += distanceWeight;
            if (c.kind === "core") score += coreWeight;
        }
        if (best === null || score > best.score) {
            best = { x, score };
        }
    }
    return best?.x ?? null;
}

function bestBreakthroughColumn(ctx: BotArmContext): number | null {
    let best: { x: number; score: number } | null = null;
    for (let x = 0; x < ctx.state.width; x++) {
        const targets = listEnemyHitsInColumn(ctx.state, ctx.playerId, x);
        if (targets.length === 0) continue;
        const front = targets[0]!;
        const frontCell = ctx.state.grid[front.y]![front.x]!;
        const canBreakFront = frontCell.hp <= ctx.resolution.arm.damage;
        const hasCoreInLine = targets.some((t) => ctx.state.grid[t.y]![t.x]!.kind === "core");
        let score = 0;
        score += Math.max(0, 8 - frontCell.hp) * 4;
        if (canBreakFront) score += 20;
        if (hasCoreInLine) score += 25;
        if (frontCell.kind === "core") score += 40;
        if (best === null || score > best.score) {
            best = { x, score };
        }
    }
    return best?.x ?? null;
}

function findEnemyCoreColumn(state: MatchState, playerId: 0 | 1): number | null {
    const enemy = opponentOf(playerId);
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind === "core" && cell.owner === enemy && livingCell(cell)) {
                return x;
            }
        }
    }
    return null;
}

function sanitizeBuildCommands(ctx: BotBuildContext, commands: { type: "new" | "repair"; x: number; y: number; spend: number }[]) {
    const valid = [];
    const repairUsed: Record<string, number> = {};
    let budget = ctx.budget;
    for (const cmd of commands) {
        const err = validateBuildCommand(ctx.state, ctx.playerId, cmd, budget, repairUsed);
        if (err) continue;
        valid.push(cmd);
        budget -= cmd.spend;
        if (cmd.type === "repair") {
            const key = `${cmd.x},${cmd.y}`;
            repairUsed[key] = (repairUsed[key] ?? 0) + cmd.spend;
        }
    }
    return valid;
}

const aggroBot: BotStrategy = {
    name: "aggro",
    shouldReroll(ctx) {
        const maxDie = Math.max(...ctx.hand);
        return ctx.rerollsLeft > 0 && maxDie < 5;
    },
    pickSlots(ctx) {
        return allocateByPlan(ctx.hand, 3, 0);
    },
    pickBuildCommands(ctx) {
        return sanitizeBuildCommands(ctx, []);
    },
    pickArmColumn(ctx) {
        const coreColumn = findEnemyCoreColumn(ctx.state, ctx.playerId);
        if (coreColumn !== null) return coreColumn;
        return bestBreakthroughColumn(ctx) ?? bestArmColumnByScore(ctx, 45);
    },
};

const tankBot: BotStrategy = {
    name: "tank",
    shouldReroll(ctx) {
        return maybeRerollByThreshold(ctx, DICE_FORTS_ARM_THRESHOLD);
    },
    pickSlots(ctx) {
        return allocateByPlan(ctx.hand, 3, 0);
    },
    pickBuildCommands(ctx) {
        return sanitizeBuildCommands(ctx, []);
    },
    pickArmColumn(ctx) {
        return bestBreakthroughColumn(ctx) ?? bestArmColumnByScore(ctx, 20);
    },
};

const balancedBot: BotStrategy = {
    name: "balanced",
    shouldReroll(ctx) {
        return shouldBotReroll([...ctx.hand], ctx.rerollsLeft);
    },
    pickSlots(ctx) {
        return allocateByPlan(ctx.hand, 2, 1);
    },
    pickBuildCommands(ctx) {
        const commands: { type: "new" | "repair"; x: number; y: number; spend: number }[] = [];
        const damaged = findDamagedOwnedCells(ctx.state, ctx.playerId);
        let budgetLeft = ctx.budget;
        for (const item of damaged) {
            if (budgetLeft <= 1) break;
            if (item.cell.kind !== "core") continue;
            const missing = item.cell.maxHp - item.cell.hp;
            const spend = Math.min(missing, budgetLeft, 2);
            if (spend > 0) {
                commands.push({ type: "repair", x: item.x, y: item.y, spend });
                budgetLeft -= spend;
            }
        }
        for (const cmd of buildForwardNewBlockCommands(ctx.state, ctx.playerId, budgetLeft)) {
            commands.push({ type: "new", ...cmd });
        }
        return sanitizeBuildCommands(ctx, commands);
    },
    pickArmColumn(ctx) {
        const hitCoreColumn = (() => {
            const enemy = opponentOf(ctx.playerId);
            for (let x = 0; x < ctx.state.width; x++) {
                const targets = listEnemyHitsInColumn(ctx.state, ctx.playerId, x);
                const hasCore = targets.some((t) => ctx.state.grid[t.y]![t.x]!.kind === "core");
                if (hasCore) {
                    const top = targets[0];
                    if (top) {
                        const cell = ctx.state.grid[top.y]![top.x]!;
                        if (cell.owner === enemy) return x;
                    }
                }
            }
            return null;
        })();
        if (hitCoreColumn !== null) return hitCoreColumn;
        return bestArmColumnByScore(ctx, 25);
    },
};

export const BOT_REGISTRY: Record<BotName, BotStrategy> = {
    aggro: aggroBot,
    tank: tankBot,
    balanced: balancedBot,
};

export function getBotStrategy(name: BotName): BotStrategy {
    return BOT_REGISTRY[name];
}
