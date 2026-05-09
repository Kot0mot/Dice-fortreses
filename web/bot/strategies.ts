import { DICE_FORTS_ARM_THRESHOLD, DICE_FORTS_BLOCK_HP } from "../../src/constants.js";
import { hasOwnedBuiltNeighbor, listEnemyHitsInColumn, validateBuildCommand, type BuildCommand } from "../../src/game.js";
import type { MatchState, PlayerId } from "../../src/state.js";
import { livingCell } from "../../src/state.js";
import { resolveDiceFortsSlots } from "../../src/rules.js";
import type { DiceFortsSlots } from "../../src/types.js";
import {
    averageHand,
    evaluateArmColumnPotential,
    isDamagedOwnedCell,
    vulnerabilityScoreNearCore,
} from "./evaluate.js";
import type { BotPlanningContext, BotPostSlotsContext, BotTurnPlan } from "./types.js";

function pickRandom<T>(items: readonly T[], ctx: { rng: { nextInt(min: number, max: number): number } }): T | null {
    if (items.length === 0) return null;
    const idx = ctx.rng.nextInt(0, items.length - 1);
    return items[idx] ?? null;
}

function sortDesc(values: readonly number[]): number[] {
    return [...values].sort((a, b) => b - a);
}

function allocateByCounts(hand: readonly number[], armCount: number, fortifyCount: number): DiceFortsSlots {
    const sorted = sortDesc(hand);
    return {
        arm: sorted.slice(0, armCount),
        fortify: sorted.slice(armCount, armCount + fortifyCount),
        build: sorted.slice(armCount + fortifyCount),
    };
}

function listBuildTargets(state: MatchState, playerId: PlayerId): Array<{ x: number; y: number }> {
    const targets: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind !== "empty") continue;
            if (!hasOwnedBuiltNeighbor(state, playerId, x, y)) continue;
            targets.push({ x, y });
        }
    }
    return targets;
}

function listRepairTargets(state: MatchState, playerId: PlayerId): Array<{ x: number; y: number }> {
    const targets: Array<{ x: number; y: number }> = [];
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (!isDamagedOwnedCell(cell, playerId)) continue;
            targets.push({ x, y });
        }
    }
    return targets;
}

function sanitizeBuildCommands(
    state: MatchState,
    playerId: PlayerId,
    budget: number,
    commands: readonly BuildCommand[]
): BuildCommand[] {
    const accepted: BuildCommand[] = [];
    const repairUsed: Record<string, number> = {};
    let budgetLeft = budget;
    for (const command of commands) {
        const err = validateBuildCommand(state, playerId, command, budgetLeft, repairUsed);
        if (err) continue;
        accepted.push(command);
        budgetLeft -= command.spend;
        if (command.type === "repair") {
            const key = `${command.x},${command.y}`;
            repairUsed[key] = (repairUsed[key] ?? 0) + command.spend;
        }
    }
    return accepted;
}

function pickArmColumnByDifficulty(ctx: BotPostSlotsContext): { column: number | null; reason: string } {
    const availableColumns = [];
    for (let x = 0; x < ctx.state.width; x++) {
        if (listEnemyHitsInColumn(ctx.state, ctx.playerId, x).length > 0) {
            availableColumns.push(x);
        }
    }
    if (availableColumns.length === 0 || !ctx.resolution.arm.canFire) {
        return { column: null, reason: "Arm пропущен: нет валидных целей или порог выстрела не достигнут." };
    }
    if (ctx.difficulty === "easy") {
        const choice = pickRandom(availableColumns, { rng: ctx.rng });
        return {
            column: choice,
            reason: "Arm: лёгкий бот выбрал почти случайную колонку среди валидных.",
        };
    }
    const scored = evaluateArmColumnPotential(
        ctx.state,
        ctx.playerId,
        ctx.resolution.arm.damage,
        ctx.resolution.arm.pierceDepth
    );
    if (ctx.difficulty === "medium") {
        const best = scored[0];
        return {
            column: best?.column ?? availableColumns[0] ?? null,
            reason: "Arm: средний бот выбрал колонку с лучшим базовым уроном.",
        };
    }
    const best = scored[0];
    return {
        column: best?.column ?? availableColumns[0] ?? null,
        reason: "Arm: сложный бот выбрал тактическую цель с максимальным потенциалом пробития/урона по ядру.",
    };
}

function pickBuildCommands(ctx: BotPostSlotsContext): { commands: BuildCommand[]; reason: string } {
    const budget = ctx.resolution.buildPoints;
    if (budget <= 0) {
        return { commands: [], reason: "Build: очков нет, действия пропущены." };
    }
    const buildTargets = listBuildTargets(ctx.state, ctx.playerId);
    const repairTargets = listRepairTargets(ctx.state, ctx.playerId);
    if (ctx.difficulty === "easy") {
        const allTargets = [
            ...buildTargets.map((cell) => ({ type: "new" as const, ...cell })),
            ...repairTargets.map((cell) => ({ type: "repair" as const, ...cell })),
        ];
        const pick = pickRandom(allTargets, { rng: ctx.rng });
        if (!pick) return { commands: [], reason: "Build: целей не было." };
        const spend = Math.min(budget, 1 + ctx.rng.nextInt(0, 1));
        const planned: BuildCommand = { type: pick.type, x: pick.x, y: pick.y, spend };
        return {
            commands: sanitizeBuildCommands(ctx.state, ctx.playerId, budget, [planned]),
            reason: "Build: лёгкий бот выбрал почти случайную цель и простой расход.",
        };
    }
    if (ctx.difficulty === "medium") {
        const commands: BuildCommand[] = [];
        let budgetLeft = budget;
        for (const target of repairTargets) {
            if (budgetLeft <= 0) break;
            const cell = ctx.state.grid[target.y]![target.x]!;
            const missing = Math.max(0, cell.maxHp - cell.hp);
            const spend = Math.min(2, missing, budgetLeft);
            if (spend > 0) {
                commands.push({ type: "repair", x: target.x, y: target.y, spend });
                budgetLeft -= spend;
            }
        }
        for (const target of buildTargets) {
            if (budgetLeft <= 0) break;
            const spend = Math.min(2, budgetLeft, DICE_FORTS_BLOCK_HP);
            commands.push({ type: "new", x: target.x, y: target.y, spend });
            budgetLeft -= spend;
        }
        return {
            commands: sanitizeBuildCommands(ctx.state, ctx.playerId, budget, commands),
            reason: "Build: средний бот чинит повреждения и затем равномерно строится.",
        };
    }
    const vulnerableBuilds = buildTargets
        .map((target) => ({
            ...target,
            score: vulnerabilityScoreNearCore(ctx.state, ctx.playerId, target.x, target.y),
        }))
        .sort((a, b) => b.score - a.score);
    const vulnerableRepairs = repairTargets
        .map((target) => ({
            ...target,
            score: vulnerabilityScoreNearCore(ctx.state, ctx.playerId, target.x, target.y),
        }))
        .sort((a, b) => b.score - a.score);
    const commands: BuildCommand[] = [];
    let budgetLeft = budget;
    for (const target of vulnerableRepairs) {
        if (budgetLeft <= 0) break;
        const cell = ctx.state.grid[target.y]![target.x]!;
        const missing = Math.max(0, cell.maxHp - cell.hp);
        const spend = Math.min(3, missing, budgetLeft);
        if (spend > 0) {
            commands.push({ type: "repair", x: target.x, y: target.y, spend });
            budgetLeft -= spend;
        }
    }
    for (const target of vulnerableBuilds) {
        if (budgetLeft <= 0) break;
        const spend = Math.min(3, budgetLeft, DICE_FORTS_BLOCK_HP);
        commands.push({ type: "new", x: target.x, y: target.y, spend });
        budgetLeft -= spend;
    }
    return {
        commands: sanitizeBuildCommands(ctx.state, ctx.playerId, budget, commands),
        reason: "Build: сложный бот усиливает уязвимые зоны возле своего ядра.",
    };
}

function pickSlots(ctx: BotPlanningContext): { slots: DiceFortsSlots; reason: string } {
    if (ctx.difficulty === "easy") {
        const sorted = sortDesc(ctx.hand);
        const armCount = sorted[0] !== undefined && sorted[0] >= DICE_FORTS_ARM_THRESHOLD ? 1 : 0;
        return {
            slots: allocateByCounts(sorted, armCount, 1),
            reason: "Слоты: лёгкий бот делает простое распределение без точной оптимизации.",
        };
    }
    if (ctx.difficulty === "medium") {
        return {
            slots: allocateByCounts(ctx.hand, 2, 1),
            reason: "Слоты: средний бот использует сбалансированный план Build/Fortify/Arm.",
        };
    }
    const sorted = sortDesc(ctx.hand);
    const top = sorted[0] ?? 0;
    const second = sorted[1] ?? 0;
    const armCount = top >= DICE_FORTS_ARM_THRESHOLD ? (second >= DICE_FORTS_ARM_THRESHOLD ? 2 : 1) : 0;
    const fortifyCount = armCount === 0 ? 2 : 1;
    return {
        slots: allocateByCounts(sorted, armCount, fortifyCount),
        reason: "Слоты: сложный бот учитывает пороги Arm/Fortify и максимизирует полезность кубов.",
    };
}

function shouldReroll(ctx: BotPlanningContext): { reroll: boolean; reason: string } {
    const avg = averageHand(ctx.hand);
    const maxDie = Math.max(...ctx.hand);
    const lowHand = maxDie < DICE_FORTS_ARM_THRESHOLD;
    if (ctx.rerollsLeft <= 0) {
        return { reroll: false, reason: "Переброс недоступен: лимит исчерпан." };
    }
    if (ctx.difficulty === "easy") {
        const reroll = lowHand && avg <= 2.6;
        return {
            reroll,
            reason: reroll
                ? "Переброс: рука очень слабая, даже для лёгкого профиля."
                : "Переброс: лёгкий бот чаще оставляет руку как есть.",
        };
    }
    if (ctx.difficulty === "medium") {
        const reroll = lowHand || avg < 3;
        return {
            reroll,
            reason: reroll
                ? "Переброс: средний бот увидел умеренно слабую руку."
                : "Переброс: рука уже достаточно рабочая.",
        };
    }
    const expectedGain = 3.5 - avg;
    const reroll = lowHand || expectedGain > 0.7;
    return {
        reroll,
        reason: reroll
            ? "Переброс: сложный бот ожидает заметно лучший outcome после переброса."
            : "Переброс: ожидаемый выигрыш от переброса недостаточен.",
    };
}

export function planBotTurn(ctx: BotPlanningContext): BotTurnPlan {
    const reroll = shouldReroll(ctx);
    const slots = pickSlots(ctx);
    const resolution = resolveDiceFortsSlots(slots.slots);
    const postCtx: BotPostSlotsContext = {
        difficulty: ctx.difficulty,
        playerId: ctx.playerId,
        state: ctx.state,
        hand: ctx.hand,
        resolution,
        rng: ctx.rng,
    };
    const build = pickBuildCommands(postCtx);
    const arm = pickArmColumnByDifficulty(postCtx);
    return {
        reroll: reroll.reroll,
        slots: slots.slots,
        buildCommands: build.commands,
        armColumn: arm.column,
        log: {
            reroll: reroll.reason,
            slots: slots.reason,
            build: build.reason,
            arm: arm.reason,
        },
    };
}

