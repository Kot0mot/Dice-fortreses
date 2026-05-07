import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import {
    advanceCurrentPlayer,
    applyBuildCommand,
    applyHandReroll,
    endTurnUpdateFortify,
    hasOwnedBuiltNeighbor,
    initializeTurnRerolls,
    listEnemyHitsInColumn,
    validateBuildCommand,
    type BuildCommand,
} from "./game.js";
import { createDiceFortsRng } from "./random.js";
import { applyFortifyChargesToDamage, isValidSlotPartition, resolveDiceFortsSlots, rollDiceFortsHand } from "./rules.js";
import { getBotStrategy } from "./sim/bots.js";
import type { MatchState, Cell, PlayerId } from "./state.js";
import { createInitialMatchState, declareWinner, livingCell, opponentOf, patchPlayerSecrets, setCell } from "./state.js";
import type { DiceFortsSlots } from "./types.js";
import { applyStageResult, createChallengeRunState } from "./challenge/run.js";
import { drawUpgradeChoices, applyUpgradeToRun } from "./challenge/upgrades.js";
import type { ChallengeRunState, RuntimeModifiers, StageResult } from "./challenge/types.js";

interface CliArgs {
    seed: number;
    stages: number;
}

const CHALLENGE_HELP = `Dice Fortresses challenge mode

Usage:
  npm run challenge -- [options]

Options:
  -h, --help          Show this help and exit
  --seed=<int>        Seed for deterministic run generation (default: 1)
  --stages=<int>      Number of stages in run, 3..5 (default: 3)

Examples:
  npm run challenge -- --seed=7 --stages=3
  npm run challenge -- --seed=123 --stages=5
  npm run challenge -- --help
`;

export function parseArgs(argv: readonly string[]): CliArgs {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(CHALLENGE_HELP);
        process.exit(0);
    }
    const out: CliArgs = { seed: 1, stages: 3 };
    for (const arg of argv) {
        if (arg.startsWith("--seed=")) out.seed = Number(arg.slice("--seed=".length));
        else if (arg.startsWith("--stages=")) out.stages = Number(arg.slice("--stages=".length));
        else throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
    if (!Number.isInteger(out.seed)) throw new Error("--seed must be integer");
    if (!Number.isInteger(out.stages) || out.stages < 3 || out.stages > 5) {
        throw new Error("--stages must be integer in range 3..5");
    }
    return out;
}

function parseIntsPart(s: string): number[] | null {
    const t = s.trim();
    if (t === "") return [];
    const parts = t.split(",").map((x) => x.trim());
    const out: number[] = [];
    for (const p of parts) {
        if (p === "") return null;
        const n = Number(p);
        if (!Number.isInteger(n)) return null;
        out.push(n);
    }
    return out;
}

function parseSlotsLine(line: string): DiceFortsSlots | null {
    const parts = line.trim().split("|");
    if (parts.length !== 3) return null;
    const build = parseIntsPart(parts[0] ?? "");
    const fortify = parseIntsPart(parts[1] ?? "");
    const arm = parseIntsPart(parts[2] ?? "");
    if (build === null || fortify === null || arm === null) return null;
    return { build, fortify, arm };
}

function parseBuildLine(line: string): BuildCommand | "done" | null {
    const t = line.trim().toLowerCase();
    if (t === "done") return "done";
    const mNew = /^new\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(t);
    if (mNew) return { type: "new", x: Number(mNew[1]), y: Number(mNew[2]), spend: Number(mNew[3]) };
    const mRep = /^repair\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(t);
    if (mRep) return { type: "repair", x: Number(mRep[1]), y: Number(mRep[2]), spend: Number(mRep[3]) };
    return null;
}

function formatCell(c: Cell): string {
    if (c.kind === "empty") return "....";
    const p = c.owner === 0 ? "0" : "1";
    if (c.kind === "core") return `${p}C${c.hp.toString().padStart(2, "0")}`;
    return `${p}B${c.hp.toString().padStart(2, "0")}`;
}

function printGrid(state: MatchState): void {
    const header = "   " + Array.from({ length: state.width }, (_, x) => x.toString().padStart(4, " ")).join("");
    console.log(header);
    for (let y = 0; y < state.height; y++) {
        const row = state.grid[y]!.map(formatCell).map((s) => s.padEnd(4, " ")).join("");
        console.log(`${y.toString().padStart(2, " ")} ${row}`);
    }
}

function coreHp(state: MatchState, owner: PlayerId): number {
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const c = state.grid[y]![x]!;
            if (c.kind === "core" && c.owner === owner) return c.hp;
        }
    }
    return 0;
}

function applyCoreBonus(state: MatchState, owner: PlayerId, bonus: number): MatchState {
    if (bonus <= 0) return state;
    let next = state;
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const c = next.grid[y]![x]!;
            if (c.kind === "core" && c.owner === owner) {
                const maxHp = c.maxHp + bonus;
                next = setCell(next, x, y, { ...c, hp: maxHp, maxHp });
            }
        }
    }
    return next;
}

function applyStageStartModifiers(state: MatchState, owner: PlayerId, mods: RuntimeModifiers): MatchState {
    let next = applyCoreBonus(state, owner, mods.coreHpBonus);
    if (mods.startFortifyBonus > 0) {
        const current = next.players[owner].savedFortifyCharges;
        next = patchPlayerSecrets(next, owner, { savedFortifyCharges: current + mods.startFortifyBonus });
    }
    return next;
}

function botShouldRerollWithPreset(hand: readonly number[], rerollsLeft: number, thresholdBonus: number): boolean {
    if (rerollsLeft <= 0) return false;
    const threshold = 4 + thresholdBonus;
    return hand.every((v) => v < threshold);
}

function findInsuranceReduction(owner: PlayerId, targetOwner: PlayerId, modsP0: RuntimeModifiers, modsP1: RuntimeModifiers): number {
    if (owner === targetOwner) return 0;
    return targetOwner === 0 ? modsP0.firstCoreHitDamageReduction : modsP1.firstCoreHitDamageReduction;
}

function applyAttackWithModifiers(
    state: MatchState,
    attackerId: PlayerId,
    x: number,
    baseDamage: number,
    pierceDepth: number,
    modsP0: RuntimeModifiers,
    modsP1: RuntimeModifiers,
    insuranceSpent: { p0: boolean; p1: boolean }
): { state: MatchState; chargesRemaining: number } {
    let s = state;
    const defender = opponentOf(attackerId);
    let charges = s.players[defender].savedFortifyCharges;
    const targets = listEnemyHitsInColumn(s, attackerId, x);
    const maxHits = 1 + Math.max(0, pierceDepth);
    let hits = 0;

    for (const target of targets) {
        if (hits >= maxHits) break;
        const cell = s.grid[target.y]![target.x]!;
        if (!livingCell(cell) || cell.owner !== defender) continue;
        const throughFortify = applyFortifyChargesToDamage(baseDamage, charges);
        charges = throughFortify.chargesRemaining;
        let damage = throughFortify.damageRemaining;

        if (cell.kind === "core") {
            const insuranceReduction = findInsuranceReduction(attackerId, defender, modsP0, modsP1);
            if (defender === 0 && !insuranceSpent.p0 && insuranceReduction > 0) {
                damage = Math.max(0, damage - insuranceReduction);
                insuranceSpent.p0 = true;
            }
            if (defender === 1 && !insuranceSpent.p1 && insuranceReduction > 0) {
                damage = Math.max(0, damage - insuranceReduction);
                insuranceSpent.p1 = true;
            }
        }

        const nextHp = cell.hp - damage;
        hits += 1;
        if (nextHp <= 0) {
            if (cell.kind === "core") {
                s = declareWinner(setCell(s, target.x, target.y, { kind: "empty", owner: null, hp: 0, maxHp: 0 }), attackerId);
            } else {
                s = setCell(s, target.x, target.y, { kind: "empty", owner: null, hp: 0, maxHp: 0 });
            }
        } else {
            s = setCell(s, target.x, target.y, { ...cell, hp: nextHp });
        }
        if (s.winner !== null) break;
    }

    return { state: s, chargesRemaining: charges };
}

async function buildPhaseHuman(
    rl: readline.Interface,
    state: MatchState,
    pid: PlayerId,
    baseBudget: number,
    freeRepairPerTurn: number
): Promise<MatchState> {
    let s = state;
    let budget = baseBudget;
    let freeRepairLeft = freeRepairPerTurn;
    const repairUsed: Record<string, number> = {};
    console.log(`Build phase: очков ${budget}, free repair: ${freeRepairLeft}.`);
    while (budget > 0 || freeRepairLeft > 0) {
        const cmdOrDone = parseBuildLine(await rl.question(`Build (${budget} +freeRepair:${freeRepairLeft})> `));
        if (cmdOrDone === "done") break;
        if (cmdOrDone === null) {
            console.log("Формат: new x y spend | repair x y spend | done");
            continue;
        }
        const virtualBudget = cmdOrDone.type === "repair" ? budget + freeRepairLeft : budget;
        const err = validateBuildCommand(s, pid, cmdOrDone, virtualBudget, repairUsed);
        if (err) {
            console.log(`Ошибка: ${err}`);
            continue;
        }
        const out = applyBuildCommand(s, pid, cmdOrDone, virtualBudget, repairUsed);
        if (!out) continue;
        s = out.state;
        if (cmdOrDone.type === "repair") {
            const freeUsed = Math.min(cmdOrDone.spend, freeRepairLeft);
            freeRepairLeft -= freeUsed;
            budget -= cmdOrDone.spend - freeUsed;
        } else {
            budget -= cmdOrDone.spend;
        }
    }
    return s;
}

function buildPhaseBot(state: MatchState, pid: PlayerId, baseBudget: number, freeRepairPerTurn: number, stageBot: ReturnType<typeof getBotStrategy>): MatchState {
    let s = state;
    let budget = baseBudget;
    let freeRepairLeft = freeRepairPerTurn;
    const repairUsed: Record<string, number> = {};
    const cmds = stageBot.pickBuildCommands({ playerId: pid, state: s, budget: baseBudget + freeRepairPerTurn });
    for (const cmd of cmds) {
        const virtualBudget = cmd.type === "repair" ? budget + freeRepairLeft : budget;
        const err = validateBuildCommand(s, pid, cmd, virtualBudget, repairUsed);
        if (err) continue;
        const out = applyBuildCommand(s, pid, cmd, virtualBudget, repairUsed);
        if (!out) continue;
        s = out.state;
        if (cmd.type === "repair") {
            const freeUsed = Math.min(cmd.spend, freeRepairLeft);
            freeRepairLeft -= freeUsed;
            budget -= cmd.spend - freeUsed;
        } else {
            budget -= cmd.spend;
        }
        if (budget <= 0 && freeRepairLeft <= 0) break;
    }
    return s;
}

async function playStage(
    run: ChallengeRunState,
    rl: readline.Interface
): Promise<StageResult> {
    const stageSeed = run.config.seed + run.currentStage * 1000;
    const rng = createDiceFortsRng(stageSeed);
    const aiBot = getBotStrategy(run.aiPreset.bot);
    let state = createInitialMatchState();
    state = applyStageStartModifiers(state, 0, run.playerModifiers);
    state = applyStageStartModifiers(state, 1, run.aiModifiers);

    const startedAt = Date.now();
    let rounds = 0;
    const insuranceSpent = { p0: false, p1: false };

    while (state.winner === null && rounds < run.config.maxRoundsPerMatch) {
        rounds += 1;
        for (let half = 0; half < 2; half++) {
            if (state.winner !== null) break;
            const pid = state.currentPlayer;
            const isPlayer = pid === 0;
            const activeMods = isPlayer ? run.playerModifiers : run.aiModifiers;
            state = initializeTurnRerolls(state);
            if (activeMods.rerollsPerTurnBonus > 0) {
                state = { ...state, rerollsLeftThisTurn: state.rerollsLeftThisTurn + activeMods.rerollsPerTurnBonus };
            }
            let hand = rollDiceFortsHand(rng);
            printGrid(state);
            console.log(`Stage ${run.currentStage} | Round ${rounds} | turn P${pid}${isPlayer ? " (you)" : " (AI)"}`);
            console.log(`Hand: [${hand.join(", ")}]`);

            if (isPlayer) {
                while (true) {
                    const action = (await rl.question(`Action: keep | reroll (left: ${state.rerollsLeftThisTurn})> `)).trim().toLowerCase();
                    if (action === "keep") break;
                    if (action !== "reroll") continue;
                    const reroll = applyHandReroll(state, rng);
                    if (!reroll) {
                        console.log("No rerolls left.");
                        continue;
                    }
                    state = reroll.state;
                    hand = reroll.hand;
                    console.log(`Hand: [${hand.join(", ")}]`);
                }
            } else {
                const shouldReroll = botShouldRerollWithPreset(hand, state.rerollsLeftThisTurn, run.aiPreset.rerollThresholdBonus)
                    || aiBot.shouldReroll({ playerId: pid, state, hand, rerollsLeft: state.rerollsLeftThisTurn });
                if (shouldReroll) {
                    const reroll = applyHandReroll(state, rng);
                    if (reroll) {
                        state = reroll.state;
                        hand = reroll.hand;
                    }
                }
            }

            let slots: DiceFortsSlots;
            if (isPlayer) {
                while (true) {
                    const parsed = parseSlotsLine(await rl.question("Slots build|fortify|arm > "));
                    if (!parsed || !isValidSlotPartition(hand, parsed)) {
                        console.log("Нужно разложить ровно эти 4 куба.");
                        continue;
                    }
                    slots = parsed;
                    break;
                }
            } else {
                slots = aiBot.pickSlots({ playerId: pid, state, hand, rerollsLeft: state.rerollsLeftThisTurn });
                if (!isValidSlotPartition(hand, slots)) {
                    throw new Error(`AI ${aiBot.name} generated invalid slots`);
                }
            }
            const resolved = resolveDiceFortsSlots(slots);

            if (isPlayer) {
                state = await buildPhaseHuman(rl, state, pid, resolved.buildPoints, activeMods.freeRepairPerTurn);
            } else {
                state = buildPhaseBot(state, pid, resolved.buildPoints, activeMods.freeRepairPerTurn, aiBot);
            }

            if (resolved.arm.canFire) {
                let column: number | null = null;
                if (isPlayer) {
                    while (column === null) {
                        const raw = (await rl.question(`Arm column x (0..${state.width - 1}, skip)> `)).trim().toLowerCase();
                        if (raw === "skip") {
                            column = -1;
                            break;
                        }
                        const n = Number(raw);
                        if (Number.isInteger(n) && n >= 0 && n < state.width) column = n;
                    }
                } else {
                    column = aiBot.pickArmColumn({ playerId: pid, state, resolution: resolved });
                }
                if (column !== null && column >= 0) {
                    let damage = resolved.arm.damage;
                    let pierce = resolved.arm.pierceDepth + activeMods.pierceDepthBonus;
                    if (resolved.arm.max === 6) damage += activeMods.armDamageOnSixBonus;
                    const out = applyAttackWithModifiers(
                        state,
                        pid,
                        column,
                        damage,
                        pierce,
                        run.playerModifiers,
                        run.aiModifiers,
                        insuranceSpent
                    );
                    state = patchPlayerSecrets(out.state, opponentOf(pid), { savedFortifyCharges: out.chargesRemaining });
                }
            }

            if (state.winner !== null) break;
            state = endTurnUpdateFortify(state, pid, resolved.fortifyCharges + activeMods.startFortifyBonus);
            state = advanceCurrentPlayer(state);
        }
    }

    const result: StageResult = {
        stage: run.currentStage,
        winner: state.winner === 0 ? "player" : "ai",
        rounds,
        playerCoreHp: coreHp(state, 0),
        aiCoreHp: coreHp(state, 1),
        durationMs: Date.now() - startedAt,
        appliedUpgradeId: null,
    };
    return result;
}

async function chooseUpgrade(rl: readline.Interface, run: ChallengeRunState, stageSeed: number): Promise<string | null> {
    const rng = createDiceFortsRng(stageSeed + 77);
    const choices = drawUpgradeChoices(run, rng, 3);
    if (choices.length === 0) return null;
    console.log("\nChoose upgrade:");
    choices.forEach((u, i) => {
        console.log(`${i + 1}. ${u.name} — ${u.description}`);
    });
    while (true) {
        const n = Number((await rl.question("Pick 1..3 > ")).trim());
        if (Number.isInteger(n) && n >= 1 && n <= choices.length) {
            return choices[n - 1]!.id;
        }
    }
}

function printStageSummary(res: StageResult): void {
    console.log(`\nStage ${res.stage} result: ${res.winner.toUpperCase()}`);
    console.log(`Rounds: ${res.rounds}, Duration: ${res.durationMs} ms`);
    console.log(`Core HP — You: ${res.playerCoreHp}, AI: ${res.aiCoreHp}`);
    if (res.appliedUpgradeId) console.log(`Picked upgrade: ${res.appliedUpgradeId}`);
}

function printRunSummary(run: ChallengeRunState): void {
    console.log("\n=== Challenge Summary ===");
    console.log(`Status: ${run.status}`);
    if (run.status === "defeat") {
        const last = run.history[run.history.length - 1];
        console.log(`Defeated on stage ${last?.stage ?? run.currentStage}`);
    } else {
        console.log(`Completed all ${run.config.stages} stages`);
    }
    if (run.activeUpgrades.length === 0) {
        console.log("Upgrades: none");
    } else {
        console.log("Upgrades:");
        for (const u of run.activeUpgrades) {
            console.log(`- ${u.name} x${u.stacks}`);
        }
    }
}

async function main(): Promise<void> {
    const args = parseArgs(process.argv.slice(2));
    const rl = readline.createInterface({ input, output });
    let run = createChallengeRunState({ stages: args.stages, seed: args.seed });

    console.log(`Dice Fortresses Challenge | seed=${args.seed}, stages=${run.config.stages}`);
    try {
        while (run.status === "ongoing") {
            console.log(`\n== Stage ${run.currentStage}/${run.config.stages} ==`);
            console.log(`AI preset: ${run.aiPreset.label} (${run.aiPreset.bot})`);
            let stageRes = await playStage(run, rl);
            run = applyStageResult(run, stageRes);
            if (stageRes.winner === "player" && run.status === "ongoing") {
                const picked = await chooseUpgrade(rl, run, args.seed + stageRes.stage * 100);
                if (picked) {
                    stageRes = { ...stageRes, appliedUpgradeId: picked };
                    run = { ...run, history: [...run.history.slice(0, -1), stageRes] };
                    run = applyUpgradeToRun(run, picked);
                }
            }
            printStageSummary(stageRes);
        }
    } finally {
        rl.close();
    }
    printRunSummary(run);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
