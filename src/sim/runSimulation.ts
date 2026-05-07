import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { advanceCurrentPlayer, applyArmColumnAttack, applyBuildCommand, applyHandReroll, endTurnUpdateFortify, initializeTurnRerolls } from "../game.js";
import { createDiceFortsRng } from "../random.js";
import { isValidSlotPartition, resolveDiceFortsSlots, rollDiceFortsHand } from "../rules.js";
import { createInitialMatchState, declareWinner, patchPlayerSecrets } from "../state.js";
import type { MatchState, PlayerId } from "../state.js";
import type { SimulationConfig, SimulationResult, SimulationOverrides, SweepRunSummary } from "./types.js";
import type { MatchSummary } from "./types.js";
import { getBotStrategy } from "./bots.js";
import { computeAggregateMetrics, matchesCsv, summaryJson } from "./metrics.js";

function coreHp(state: MatchState, owner: PlayerId): number {
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind === "core" && cell.owner === owner) return cell.hp;
        }
    }
    return 0;
}

function withOverrides(state: MatchState, overrides: SimulationOverrides | undefined): MatchState {
    if (!overrides?.coreHp) return state;
    const hp = overrides.coreHp;
    const grid = state.grid.map((row) => row.map((cell) => ({ ...cell })));
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = grid[y]![x]!;
            if (cell.kind === "core") {
                grid[y]![x] = { ...cell, hp, maxHp: hp };
            }
        }
    }
    return { ...state, grid };
}

function playSingleMatch(config: SimulationConfig, matchId: number): MatchSummary {
    const seed = config.seedStart + matchId;
    const rng = createDiceFortsRng(seed);
    let state = withOverrides(createInitialMatchState(), config.overrides);
    let rounds = 0;
    const rerollsUsed: [number, number] = [0, 0];
    const buildSpent: [number, number] = [0, 0];
    const fortifySpent: [number, number] = [0, 0];
    const armSpent: [number, number] = [0, 0];
    const coreDamageBy: [number, number] = [0, 0];

    while (state.winner === null && rounds < config.maxRoundsPerMatch) {
        rounds += 1;
        for (let halfTurn = 0; halfTurn < 2; halfTurn++) {
            if (state.winner !== null) break;
            const pid = state.currentPlayer;
            const bot = getBotStrategy(pid === 0 ? config.p0Bot : config.p1Bot);
            state = initializeTurnRerolls(state);
            let hand = rollDiceFortsHand(rng);
            if (bot.shouldReroll({ playerId: pid, state, hand, rerollsLeft: state.rerollsLeftThisTurn })) {
                const rerolled = applyHandReroll(state, rng);
                if (rerolled) {
                    state = rerolled.state;
                    hand = rerolled.hand;
                    rerollsUsed[pid] += 1;
                }
            }
            const slots = bot.pickSlots({ playerId: pid, state, hand, rerollsLeft: state.rerollsLeftThisTurn });
            if (!isValidSlotPartition(hand, slots)) {
                throw new Error(`Bot ${bot.name} generated invalid slot partition.`);
            }
            const resolved = resolveDiceFortsSlots(slots);
            buildSpent[pid] += resolved.buildPoints;
            fortifySpent[pid] += resolved.fortifyCharges;
            armSpent[pid] += slots.arm.reduce((sum, v) => sum + v, 0);

            let budget = resolved.buildPoints;
            const repairUsed: Record<string, number> = {};
            for (const cmd of bot.pickBuildCommands({ playerId: pid, state, budget })) {
                const out = applyBuildCommand(state, pid, cmd, budget, repairUsed);
                if (!out) continue;
                state = out.state;
                budget = out.budget;
            }

            if (resolved.arm.canFire) {
                const column = bot.pickArmColumn({ playerId: pid, state, resolution: resolved });
                if (column !== null && column >= 0 && column < state.width) {
                    const beforeP0 = coreHp(state, 0);
                    const beforeP1 = coreHp(state, 1);
                    const defId = pid === 0 ? 1 : 0;
                    const out = applyArmColumnAttack(
                        state,
                        pid,
                        column,
                        resolved.arm.damage,
                        resolved.arm.pierceDepth,
                        state.players[defId].savedFortifyCharges
                    );
                    state = patchPlayerSecrets(out.state, defId, { savedFortifyCharges: out.chargesRemaining });
                    const afterP0 = coreHp(state, 0);
                    const afterP1 = coreHp(state, 1);
                    coreDamageBy[pid] += Math.max(0, beforeP0 - afterP0) + Math.max(0, beforeP1 - afterP1);
                }
            }

            if (state.winner !== null) break;
            state = endTurnUpdateFortify(state, pid, resolved.fortifyCharges);
            state = advanceCurrentPlayer(state);
        }
        if (state.winner === null && rounds >= 20) {
            const hp0 = coreHp(state, 0);
            const hp1 = coreHp(state, 1);
            const diff = Math.abs(hp0 - hp1);
            const leader = hp0 > hp1 ? 0 : 1;
            if ((diff >= 8) || (diff >= 5 && (hp0 <= 6 || hp1 <= 6))) {
                state = declareWinner(state, leader);
            }
        }
    }

    return {
        matchId,
        seed,
        winner: state.winner,
        rounds,
        coreHpP0: coreHp(state, 0),
        coreHpP1: coreHp(state, 1),
        rerollsUsedP0: rerollsUsed[0],
        rerollsUsedP1: rerollsUsed[1],
        timeout: state.winner === null,
        coreDamageByP0: coreDamageBy[0],
        coreDamageByP1: coreDamageBy[1],
        buildSpentP0: buildSpent[0],
        buildSpentP1: buildSpent[1],
        fortifySpentP0: fortifySpent[0],
        fortifySpentP1: fortifySpent[1],
        armSpentP0: armSpent[0],
        armSpentP1: armSpent[1],
    };
}

export function runSimulation(config: SimulationConfig): SimulationResult {
    const matches: MatchSummary[] = [];
    for (let i = 0; i < config.matches; i++) {
        matches.push(playSingleMatch(config, i));
    }
    return { config, matches, aggregate: computeAggregateMetrics(matches) };
}

export async function writeSimulationReports(prefixPath: string, result: SimulationResult): Promise<void> {
    const parent = dirname(prefixPath);
    await mkdir(parent, { recursive: true });
    await writeFile(`${prefixPath}.summary.json`, summaryJson(result), "utf8");
    await writeFile(`${prefixPath}.matches.csv`, matchesCsv(result.matches), "utf8");
}

export function runSweep(base: SimulationConfig, sweepName: string): SweepRunSummary[] {
    if (sweepName !== "core-hp") {
        throw new Error(`Unknown sweep "${sweepName}". Supported: core-hp`);
    }
    const values = [16, 20, 24];
    return values.map((coreHp) => {
        const config: SimulationConfig = {
            ...base,
            overrides: { ...(base.overrides ?? {}), coreHp },
        };
        return {
            overrideLabel: `coreHp=${coreHp}`,
            result: runSimulation(config),
        };
    });
}
