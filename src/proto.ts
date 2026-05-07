/**
 * CLI-прототип Dice Fortresses: два игрока, ASCII-сетка, ввод распределения кубов и столбца атаки.
 *
 * Слоты — строка из трёх частей через `|`: build | fortify | arm; числа через запятую.
 * Пример: `1,2|3|6,5` или `|4,5|1,2,3`
 *
 * Фаза Build:
 * - `done` — закончить строительство (остаток очков теряется);
 * - `new x y spend` — новый блок на пустой клетке (1..4 HP за spend, соседство с вашей структурой);
 * - `repair x y spend` — ремонт своей клетки (не больше капа +3 на клетку за ход).
 *
 * Фаза Arm: целое `x` (0..width−1) или `skip`.
 *
 * Аргументы: `--seed=N`, `--bot` (игрок 1 — простой бот), `--replay=path/to/script.json`.
 */

import * as readline from "node:readline/promises";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { stdin as input, stdout as output } from "node:process";
import { pathToFileURL } from "node:url";

import {
    DICE_FORTS_BLOCK_HP,
    DICE_FORTS_GRID_WIDTH,
    DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND,
    DICE_FORTS_REROLLS_PER_ROUND,
} from "./constants.js";
import {
    advanceCurrentPlayer,
    applyHandReroll,
    applyArmColumnAttack,
    applyBuildCommand,
    endTurnUpdateFortify,
    hasOwnedBuiltNeighbor,
    initializeTurnRerolls,
    listEnemyHitsInColumn,
    shouldBotReroll,
    validateBuildCommand,
    type BuildCommand,
} from "./game.js";
import { createDiceFortsRng } from "./random.js";
import { isValidSlotPartition, resolveDiceFortsSlots, rollDiceFortsHand } from "./rules.js";
import type { MatchState, Cell, PlayerId } from "./state.js";
import { createInitialMatchState, livingCell, opponentOf, patchPlayerSecrets } from "./state.js";
import type { DiceFortsSlots } from "./types.js";
import type { BuildAppliedOperation, GameLogEvent } from "./log.js";
import { formatTurnLog } from "./log.js";
import {
    TelemetryLiteSession,
    createPlaytestSessionId,
    playtestReportToCsv,
    validateFeedbackRating,
    type PlaytestFeedback,
} from "./telemetry.js";

type ReplayAction =
    | { type: "reroll_or_keep"; value: "reroll" | "keep" }
    | { type: "slots"; build: number[]; fortify: number[]; arm: number[] }
    | { type: "build_cmd"; cmd: "new" | "repair"; x: number; y: number; spend: number }
    | { type: "build_cmd"; cmd: "done" }
    | { type: "arm_column"; x: number };

interface ReplayScript {
    seed: number;
    actions: ReplayAction[];
}

class ReplayExhaustedError extends Error {}

const PROTO_HELP = `Dice Fortresses prototype CLI

Usage:
  npm run proto -- [options]

Options:
  -h, --help           Show this help and exit
  --seed=<int>         RNG seed for deterministic run (default: 12345)
  --bot                Enable bot for player 1
  --replay=<path>      Replay script JSON file
  --playtest           Enable playtest mode (onboarding, telemetry, report export)

Examples:
  npm run proto -- --seed=7
  npm run proto -- --seed=7 --bot
  npm run proto -- --replay=demo/replay.json
`;

export function parseArgs(argv: readonly string[]): {
    seed: number;
    botP1: boolean;
    replayPath: string | null;
    playtest: boolean;
} {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(PROTO_HELP);
        process.exit(0);
    }
    let seed = 12345;
    let botP1 = false;
    let replayPath: string | null = null;
    let playtest = false;
    for (const a of argv) {
        if (a === "--bot") botP1 = true;
        else if (a === "--playtest") playtest = true;
        else if (a.startsWith("--replay=")) replayPath = a.slice("--replay=".length);
        else if (a.startsWith("--seed=")) {
            const n = Number(a.slice("--seed=".length));
            if (!Number.isFinite(n)) throw new Error(`Invalid --seed value: "${a.slice("--seed=".length)}"`);
            seed = Math.floor(n);
        } else throw new Error(`Unknown argument: ${a}. Run with --help for usage.`);
    }
    return { seed, botP1, replayPath, playtest };
}

async function showPlaytestOnboarding(rl: readline.Interface): Promise<void> {
    console.log("\n=== Playtest mode ===");
    console.log("1) Сыграйте обычный матч, вслух проговаривая решения.");
    console.log("2) Не бойтесь ошибаться: ошибки ввода тоже полезны для нас.");
    console.log("3) В конце поставьте 3 оценки и короткий комментарий.\n");
    await rl.question("Нажмите Enter, чтобы начать плейтест... ");
}

async function askFeedback(rl: readline.Interface): Promise<PlaytestFeedback> {
    const askRating = async (question: string): Promise<number> => {
        while (true) {
            const answer = await rl.question(`${question} (1..5)> `);
            const parsed = Number(answer.trim());
            try {
                return validateFeedbackRating(parsed);
            } catch {
                console.log("Введите целое число от 1 до 5.");
            }
        }
    };
    const rulesClarity = await askRating("Насколько понятны правила?");
    const diceChoiceInterest = await askRating("Насколько интересен выбор кубов?");
    const playAgainDesire = await askRating("Насколько хочется сыграть еще?");
    const comment = (await rl.question("Комментарий (опционально)> ")).trim();
    return { rulesClarity, diceChoiceInterest, playAgainDesire, comment };
}

async function exportPlaytestReport(session: TelemetryLiteSession, feedback: PlaytestFeedback): Promise<void> {
    const report = session.report(feedback);
    const outDir = resolve(process.cwd(), "playtest-results");
    await mkdir(outDir, { recursive: true });
    const jsonPath = resolve(outDir, `${report.sessionId}.json`);
    const csvPath = resolve(outDir, `${report.sessionId}.csv`);
    await writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    await writeFile(csvPath, playtestReportToCsv(report), "utf8");
    console.log(`Playtest report saved:\n- ${jsonPath}\n- ${csvPath}`);
}

function formatCell(c: Cell): string {
    if (c.kind === "empty") return "....";
    const p = c.owner === 0 ? "0" : "1";
    if (c.kind === "core") return `${p}C${c.hp.toString().padStart(2, "0")}`;
    return `${p}B${c.hp.toString().padStart(2, "0")}`;
}

function printGrid(state: MatchState): void {
    const header =
        "   " + Array.from({ length: state.width }, (_, x) => x.toString().padStart(4, " ")).join("");
    console.log(header);
    for (let y = 0; y < state.height; y++) {
        const row = state.grid[y]!.map(formatCell).map((s) => s.padEnd(4, " ")).join("");
        console.log(`${y.toString().padStart(2, " ")} ${row}`);
    }
    console.log("Player 0 — низ к противнику вверх по колонке; Player 1 — верх вниз.\n");
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
    if (mNew) {
        return { type: "new", x: Number(mNew[1]), y: Number(mNew[2]), spend: Number(mNew[3]) };
    }
    const mRep = /^repair\s+(\d+)\s+(\d+)\s+(\d+)$/.exec(t);
    if (mRep) {
        return { type: "repair", x: Number(mRep[1]), y: Number(mRep[2]), spend: Number(mRep[3]) };
    }
    return null;
}

function validateReplayAction(v: unknown, index: number): ReplayAction {
    if (typeof v !== "object" || v === null) {
        throw new Error(`Replay action #${index} must be an object`);
    }
    const rec = v as Record<string, unknown>;
    if (typeof rec.type !== "string") {
        throw new Error(`Replay action #${index} is missing required field: type`);
    }
    if (rec.type === "reroll_or_keep") {
        if (rec.value !== "reroll" && rec.value !== "keep") {
            throw new Error(`Replay action #${index} reroll_or_keep is missing required field: value`);
        }
        return { type: "reroll_or_keep", value: rec.value };
    }
    if (rec.type === "slots") {
        if (!Array.isArray(rec.build)) throw new Error(`Replay action #${index} slots is missing required field: build`);
        if (!Array.isArray(rec.fortify)) throw new Error(`Replay action #${index} slots is missing required field: fortify`);
        if (!Array.isArray(rec.arm)) throw new Error(`Replay action #${index} slots is missing required field: arm`);
        return { type: "slots", build: rec.build as number[], fortify: rec.fortify as number[], arm: rec.arm as number[] };
    }
    if (rec.type === "build_cmd") {
        if (rec.cmd === "done") return { type: "build_cmd", cmd: "done" };
        if (rec.cmd !== "new" && rec.cmd !== "repair") {
            throw new Error(`Replay action #${index} build_cmd is missing required field: cmd`);
        }
        if (typeof rec.x !== "number") throw new Error(`Replay action #${index} build_cmd is missing required field: x`);
        if (typeof rec.y !== "number") throw new Error(`Replay action #${index} build_cmd is missing required field: y`);
        if (typeof rec.spend !== "number") {
            throw new Error(`Replay action #${index} build_cmd is missing required field: spend`);
        }
        return { type: "build_cmd", cmd: rec.cmd, x: rec.x, y: rec.y, spend: rec.spend };
    }
    if (rec.type === "arm_column") {
        if (typeof rec.x !== "number") throw new Error(`Replay action #${index} arm_column is missing required field: x`);
        return { type: "arm_column", x: rec.x };
    }
    throw new Error(`Replay action #${index} has unknown type: ${rec.type}`);
}

export function parseReplayScript(raw: string): ReplayScript {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== "object" || parsed === null) {
        throw new Error("Replay script must be a JSON object");
    }
    const rec = parsed as Record<string, unknown>;
    if (typeof rec.seed !== "number" || !Number.isFinite(rec.seed)) {
        throw new Error("Replay script must include numeric seed");
    }
    if (!Array.isArray(rec.actions)) throw new Error("Replay script must include actions[]");
    const actionsRaw = rec.actions as unknown[];
    const actions = actionsRaw.map((action, index) => validateReplayAction(action, index));
    return { seed: Math.floor(rec.seed), actions };
}

class ActionFeed {
    private idx = 0;

    constructor(private readonly script: ReplayScript | null) {}

    private take<T extends ReplayAction["type"]>(type: T): Extract<ReplayAction, { type: T }> {
        if (!this.script) {
            throw new Error("Internal error: replay actions unavailable");
        }
        const next = this.script.actions[this.idx];
        if (!next) throw new ReplayExhaustedError(`Replay exhausted: expected ${type}`);
        if (next.type !== type) {
            throw new Error(`Replay mismatch at action #${this.idx}: expected ${type}, got ${next.type}`);
        }
        this.idx += 1;
        return next as Extract<ReplayAction, { type: T }>;
    }

    async rerollOrKeep(rl: readline.Interface, rerollsLeft: number): Promise<"keep" | "reroll"> {
        if (this.script) {
            const a = this.take("reroll_or_keep");
            return a.value;
        }
        while (true) {
            const line = await rl.question(`Action: keep | reroll (left: ${rerollsLeft})> `);
            const action = line.trim().toLowerCase();
            if (action === "keep" || action === "reroll") return action;
            console.log("Введите keep или reroll.");
        }
    }

    async slots(rl: readline.Interface): Promise<DiceFortsSlots | null> {
        if (this.script) {
            const a = this.take("slots");
            return { build: a.build, fortify: a.fortify, arm: a.arm };
        }
        const line = await rl.question("Распределение (build|fortify|arm), напр. 1,2|3|4,5> ");
        return parseSlotsLine(line);
    }

    async buildCommand(rl: readline.Interface, budget: number): Promise<BuildCommand | "done" | null> {
        if (this.script) {
            const a = this.take("build_cmd");
            if (a.cmd === "done") return "done";
            return { type: a.cmd, x: a.x, y: a.y, spend: a.spend };
        }
        const line = await rl.question(`Build (${budget} осталось)> `);
        return parseBuildLine(line);
    }

    async armColumn(rl: readline.Interface, width: number): Promise<number | null> {
        if (this.script) {
            const a = this.take("arm_column");
            return a.x;
        }
        const ln = await rl.question(`Столбец атаки x (0..${width - 1})> `);
        const t = ln.trim().toLowerCase();
        if (t === "skip") return -1;
        const n = Number(t);
        if (!Number.isInteger(n) || n < 0 || n >= width) return null;
        return n;
    }

    ensureFullyConsumed(): void {
        if (this.script && this.idx !== this.script.actions.length) {
            throw new Error(
                `Replay has ${this.script.actions.length - this.idx} unused actions starting at #${this.idx}`
            );
        }
    }
}

function botPartition(hand: number[]): DiceFortsSlots {
    const sorted = [...hand].sort((a, b) => b - a);
    const [a, b, c, d] = sorted;
    return {
        build: [b ?? 1, c ?? 1],
        fortify: [d ?? 1],
        arm: [a ?? 1],
    };
}

function botArmColumn(state: MatchState, pid: PlayerId): number {
    let bestX = Math.floor(DICE_FORTS_GRID_WIDTH / 2);
    let bestScore = -1;
    for (let x = 0; x < state.width; x++) {
        const hits = listEnemyHitsInColumn(state, pid, x);
        const score = hits.length * 100 - x;
        if (score > bestScore) {
            bestScore = score;
            bestX = x;
        }
    }
    return bestX;
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

async function buildPhase(
    rl: readline.Interface,
    actionFeed: ActionFeed,
    state: MatchState,
    pid: PlayerId,
    budget: number,
    useBot: boolean,
    onPlayerError?: (message: string) => void
): Promise<{ state: MatchState; operations: BuildAppliedOperation[] }> {
    let s = state;
    const repairUsed: Record<string, number> = {};
    let b = budget;
    const operations: BuildAppliedOperation[] = [];

    if (useBot) {
        while (b > 0) {
            let placed = false;
            for (let y = 0; y < s.height && !placed; y++) {
                for (let x = 0; x < s.width && !placed; x++) {
                    const cell = s.grid[y]![x]!;
                    if (cell.kind !== "empty") continue;
                    if (!hasOwnedBuiltNeighbor(s, pid, x, y)) continue;
                    const spend = Math.min(b, DICE_FORTS_BLOCK_HP);
                    const cmd: BuildCommand = { type: "new", x, y, spend };
                    const hpBefore = s.grid[y]![x]!.hp;
                    const r = applyBuildCommand(s, pid, cmd, b, repairUsed);
                    if (r) {
                        const hpAfter = r.state.grid[y]![x]!.hp;
                        operations.push({ kind: "new", x, y, spent: spend, hpBefore, hpAfter });
                        s = r.state;
                        b = r.budget;
                        placed = true;
                    }
                }
            }
            if (!placed) break;
        }
        for (let y = 0; y < s.height && b > 0; y++) {
            for (let x = 0; x < s.width && b > 0; x++) {
                const cell = s.grid[y]![x]!;
                if (cell.owner !== pid || !livingCell(cell) || cell.hp >= cell.maxHp) continue;
                const key = `${x},${y}`;
                const capLeft =
                    DICE_FORTS_MAX_REPAIR_PER_CELL_PER_ROUND - (repairUsed[key] ?? 0);
                const missing = cell.maxHp - cell.hp;
                const spend = Math.min(b, capLeft, missing);
                if (spend < 1) continue;
                const cmd: BuildCommand = { type: "repair", x, y, spend };
                const hpBefore = s.grid[y]![x]!.hp;
                const r = applyBuildCommand(s, pid, cmd, b, repairUsed);
                if (r) {
                    const hpAfter = r.state.grid[y]![x]!.hp;
                    operations.push({ kind: "repair", x, y, spent: spend, hpBefore, hpAfter });
                    s = r.state;
                    b = r.budget;
                }
            }
        }
        return { state: s, operations };
    }

    console.log(`Build phase: очков ${b}. Команды: new x y spend | repair x y spend | done\n`);
    while (b > 0) {
        const cmdOrDone = await actionFeed.buildCommand(rl, b);
        if (cmdOrDone === null) {
            console.log("Не понято. Пример: new 5 6 4 или repair 5 7 2 или done.");
            onPlayerError?.("invalid_build_command_format");
            continue;
        }
        if (cmdOrDone === "done") break;
        const err = validateBuildCommand(s, pid, cmdOrDone, b, repairUsed);
        if (err) {
            console.log(`Ошибка: ${err}`);
            onPlayerError?.(`invalid_build_command:${err}`);
            continue;
        }
        const hpBefore = s.grid[cmdOrDone.y]![cmdOrDone.x]!.hp;
        const r = applyBuildCommand(s, pid, cmdOrDone, b, repairUsed);
        if (!r) {
            console.log("Команда не применилась.");
            onPlayerError?.("build_command_not_applied");
            continue;
        }
        const hpAfter = r.state.grid[cmdOrDone.y]![cmdOrDone.x]!.hp;
        operations.push({
            kind: cmdOrDone.type,
            x: cmdOrDone.x,
            y: cmdOrDone.y,
            spent: cmdOrDone.spend,
            hpBefore,
            hpAfter,
        });
        s = r.state;
        b = r.budget;
    }

    return { state: s, operations };
}

async function main(): Promise<void> {
    const { seed, botP1, replayPath, playtest } = parseArgs(process.argv.slice(2));
    const replayScript = replayPath ? parseReplayScript(await readFile(replayPath, "utf8")) : null;
    const effectiveSeed = replayScript?.seed ?? seed;
    const actionFeed = new ActionFeed(replayScript);
    const rng = createDiceFortsRng(effectiveSeed);
    let state = createInitialMatchState();
    const rl = readline.createInterface({ input, output });
    const allEvents: GameLogEvent[] = [];
    let round = 1;
    const playtestSession = playtest ? new TelemetryLiteSession(createPlaytestSessionId()) : null;

    console.log("Dice Fortresses — CLI MVP. Слоты: build|fortify|arm — четыре ваших куба через запятую.\n");
    console.log(`Seed=${effectiveSeed}${botP1 ? " (бот — игрок 1)" : ""}${replayPath ? " [replay]" : ""}\n`);
    console.log(`Rerolls per turn: ${DICE_FORTS_REROLLS_PER_ROUND}\n`);
    if (playtestSession) {
        playtestSession.sessionStarted();
        console.log(`Playtest session: ${playtestSession.sessionId}`);
        if (!replayScript) {
            await showPlaytestOnboarding(rl);
        }
    }

    try {
        while (state.winner === null) {
            state = initializeTurnRerolls(state);
            const pid = state.currentPlayer;
            const useBot = botP1 && pid === 1;
            playtestSession?.turnStarted(round, pid, coreHp(state, 0), coreHp(state, 1));
            const turnEvents: GameLogEvent[] = [
                {
                    type: "turn_started",
                    round,
                    playerId: pid,
                    rerollsAvailable: state.rerollsLeftThisTurn,
                },
            ];

            printGrid(state);
            console.log(`Ход игрока ${pid}${useBot ? " (бот)" : ""}`);

            let hand = rollDiceFortsHand(rng);
            console.log(`Кубы: [${hand.join(", ")}]`);
            turnEvents.push({ type: "dice_rolled", hand: [...hand], reason: "initial" });

            if (useBot) {
                if (shouldBotReroll(hand, state.rerollsLeftThisTurn)) {
                    const reroll = applyHandReroll(state, rng);
                    if (reroll) {
                        state = reroll.state;
                        hand = reroll.hand;
                        playtestSession?.rerollUsed(round, pid);
                        turnEvents.push({ type: "reroll_used", remaining: state.rerollsLeftThisTurn });
                        turnEvents.push({ type: "dice_rolled", hand: [...hand], reason: "reroll" });
                        console.log(
                            `Бот использует reroll. Кубы: [${hand.join(", ")}], осталось reroll: ${state.rerollsLeftThisTurn}`
                        );
                    }
                } else {
                    console.log(`Бот оставляет руку (reroll left: ${state.rerollsLeftThisTurn}).`);
                }
            } else {
                let confirmed = false;
                while (!confirmed) {
                    const action = await actionFeed.rerollOrKeep(rl, state.rerollsLeftThisTurn);
                    if (action === "keep") {
                        confirmed = true;
                        continue;
                    }
                    if (action === "reroll") {
                        const reroll = applyHandReroll(state, rng);
                        if (!reroll) {
                            console.log("No rerolls left this round");
                            playtestSession?.playerError(round, pid, "reroll_without_charges");
                            continue;
                        }
                        state = reroll.state;
                        hand = reroll.hand;
                        playtestSession?.rerollUsed(round, pid);
                        turnEvents.push({ type: "reroll_used", remaining: state.rerollsLeftThisTurn });
                        turnEvents.push({ type: "dice_rolled", hand: [...hand], reason: "reroll" });
                        console.log(`Кубы: [${hand.join(", ")}]`);
                        continue;
                    }
                }
            }

            let slots: DiceFortsSlots | null = null;
            if (useBot) {
                slots = botPartition(hand);
                console.log(`Бот слоты: build=[${slots.build}] fortify=[${slots.fortify}] arm=[${slots.arm}]`);
            } else {
                while (slots === null) {
                    const parsed = await actionFeed.slots(rl);
                    if (!parsed) {
                        console.log("Формат: ровно два символа '|', числа через запятую.");
                        playtestSession?.playerError(round, pid, "invalid_slots_format");
                        continue;
                    }
                    if (!isValidSlotPartition(hand, parsed)) {
                        console.log("Нужно разложить ровно эти четыре куба по слотам.");
                        playtestSession?.playerError(round, pid, "invalid_slots_partition");
                        continue;
                    }
                    slots = parsed;
                }
            }

            const res = resolveDiceFortsSlots(slots!);
            playtestSession?.slotsCommitted(round, pid, slots!.build.length, slots!.fortify.length, slots!.arm.length);
            turnEvents.push({
                type: "slots_committed",
                build: [...slots!.build],
                fortify: [...slots!.fortify],
                arm: [...slots!.arm],
                resolved: res,
            });
            console.log(
                `→ build=${res.buildPoints} fortify charges (на ваш следующий входящий урон)=${res.fortifyCharges} arm max=${res.arm.max} damage=${res.arm.damage} pierce=${res.arm.pierceDepth}`
            );

            const build = await buildPhase(rl, actionFeed, state, pid, res.buildPoints, useBot, (message) =>
                playtestSession?.playerError(round, pid, message)
            );
            state = build.state;
            turnEvents.push({ type: "build_applied", operations: build.operations });
            for (const op of build.operations) {
                playtestSession?.buildAction(round, pid, op.kind, op.spent);
            }

            const defId = opponentOf(pid);
            if (res.arm.canFire) {
                let col = 0;
                if (useBot) {
                    col = botArmColumn(state, pid);
                    console.log(`Бот стреляет по x=${col}`);
                } else {
                    let ok = false;
                    while (!ok) {
                        const replayCol = await actionFeed.armColumn(rl, state.width);
                        if (replayCol === null) {
                            console.log("Нужно целое x в пределах сетки.");
                            playtestSession?.playerError(round, pid, "invalid_arm_column");
                            continue;
                        }
                        if (replayCol === -1) {
                            ok = true;
                            col = -1;
                            break;
                        }
                        col = replayCol;
                        ok = true;
                    }
                }

                if (col >= 0) {
                    playtestSession?.armAction(round, pid, false, col);
                    const defCharges = state.players[defId].savedFortifyCharges;
                    const out = applyArmColumnAttack(
                        state,
                        pid,
                        col,
                        res.arm.damage,
                        res.arm.pierceDepth,
                        defCharges
                    );
                    state = out.state;
                    turnEvents.push({
                        type: "arm_fired",
                        column: col,
                        damage: res.arm.damage,
                        pierceDepth: res.arm.pierceDepth,
                        targetsHit: out.targetsHit,
                    });
                    for (const f of out.fortifyApplications) {
                        turnEvents.push({
                            type: "fortify_applied",
                            chargesBefore: f.chargesBefore,
                            absorbed: f.absorbed,
                            chargesAfter: f.chargesAfter,
                        });
                    }
                    state = patchPlayerSecrets(state, defId, {
                        savedFortifyCharges: out.chargesRemaining,
                    });
                } else {
                    playtestSession?.armAction(round, pid, true, null);
                }
            } else {
                playtestSession?.armAction(round, pid, true, null);
            }

            if (state.winner !== null) {
                turnEvents.push({
                    type: "game_ended",
                    winnerPlayerId: state.winner,
                    round,
                });
                allEvents.push(...turnEvents);
                console.log("\n--- TURN LOG ---");
                console.log(formatTurnLog(turnEvents));
                printGrid(state);
                console.log(`Победа игрока ${state.winner}.`);
                playtestSession?.turnEnded(round, pid, coreHp(state, 0), coreHp(state, 1));
                playtestSession?.matchEnded(round, state.winner);
                break;
            }

            state = endTurnUpdateFortify(state, pid, res.fortifyCharges);
            state = advanceCurrentPlayer(state);
            turnEvents.push({
                type: "turn_ended",
                coreHpP0: coreHp(state, 0),
                coreHpP1: coreHp(state, 1),
                nextPlayerId: state.currentPlayer,
            });
            playtestSession?.turnEnded(round, pid, coreHp(state, 0), coreHp(state, 1));
            allEvents.push(...turnEvents);
            console.log("\n--- TURN LOG ---");
            console.log(formatTurnLog(turnEvents));
            round += 1;
        }
        actionFeed.ensureFullyConsumed();
        console.log(`\nTotal log events: ${allEvents.length}`);
    } catch (error) {
        if (error instanceof ReplayExhaustedError) {
            console.log("\nReplay scenario finished.");
            console.log(`Total log events: ${allEvents.length}`);
        } else {
            throw error;
        }
    } finally {
        if (playtestSession && state.winner !== null) {
            const shouldExport = await rl.question("Экспортировать playtest-отчет? [Y/n]> ");
            if (shouldExport.trim().toLowerCase() !== "n") {
                const feedback = await askFeedback(rl);
                await exportPlaytestReport(playtestSession, feedback);
            }
        }
        rl.close();
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((e) => {
        console.error(e instanceof Error ? e.message : String(e));
        process.exitCode = 1;
    });
}
