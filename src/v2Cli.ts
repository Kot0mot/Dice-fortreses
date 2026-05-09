/**
 * Sandbox v2: большое поле, ядро-генератор → два одинаковых кубика, ресурсы с капом.
 * Команды: roll | r — бросок пула текущего игрока; next — сменить игрока без броска; q — выход.
 * Запуск: npm run v2:play
 * Сид: V2_SEED или SEED в окружении (удобно в PowerShell/npm), либо `node dist/v2Cli.js --seed=123`
 */

import * as readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";

import { createDiceFortsRng } from "./random.js";
import { applyResourceGains, type PlayerEconomy } from "./v2/economy.js";
import { buildDicePoolForPlayer, rollEntireDicePool } from "./v2/dicePool.js";
import { createInitialV2Match, withCurrentPlayer, withEconomy, type V2MatchState } from "./v2/matchState.js";

function parseSeed(): number {
    const env = process.env.V2_SEED ?? process.env.SEED;
    if (env !== undefined && env !== "") {
        const n = Number(env);
        if (Number.isFinite(n)) return Math.floor(n);
    }
    for (const a of process.argv.slice(2)) {
        if (a.startsWith("--seed=")) {
            const n = Number(a.slice("--seed=".length));
            return Number.isFinite(n) ? Math.floor(n) : 1;
        }
    }
    return 1;
}

function fmtBag(e: PlayerEconomy): string {
    const entries = Object.entries(e.resources).filter(([, v]) => (v ?? 0) > 0);
    if (entries.length === 0) return "(пусто)";
    return entries.map(([k, v]) => `${k}:${v}`).join(", ");
}

function explain(): void {
    console.log(`
Dice Fortresses — режим v2 (sandbox CLI)
────────────────────────────────────────
Ядро-генератор даёт каждому игроку 2 одинаковых кубика «starter_die» (6 разных ресурсов).
Бросок: все кубики пула суммируются в склад; при превышении капа остаток отбрасывается.

Команды:
  roll / r  — бросить пул текущего игрока и перейти к сопернику
  next / n — сменить игрока без броска
  help / h — эта справка
  q / quit — выход
────────────────────────────────────────
`);
}

async function main(): Promise<void> {
    const seed = parseSeed();
    const rng = createDiceFortsRng(seed);
    let state: V2MatchState = createInitialV2Match();
    const rl = readline.createInterface({ input, output });

    explain();
    console.log(`Seed=${seed}, поле ${state.width}×${state.height}\n`);

    try {
        while (true) {
            const pid = state.currentPlayer;
            console.log(`\n=== Ход игрока ${pid} ===`);
            console.log(`Склады: ${fmtBag(state.economy[pid]!)}`);
            const ln = (await rl.question("> ")).trim().toLowerCase();
            if (ln === "" || ln === "h" || ln === "help") {
                explain();
                continue;
            }
            if (ln === "q" || ln === "quit") break;
            if (ln === "n" || ln === "next") {
                state = withCurrentPlayer(state, pid === 0 ? 1 : 0);
                console.log(`Игрок сменён на ${state.currentPlayer}.`);
                continue;
            }
            if (ln !== "roll" && ln !== "r") {
                console.log("Не понял. Введи roll, next, help или q.");
                continue;
            }

            const pool = buildDicePoolForPlayer(state, pid);
            console.log(`Пул кубиков: ${pool.length} шт. (${pool.map((p) => p.template.id).join(", ")})`);
            const { results, bag } = rollEntireDicePool(pool, rng);
            for (const r of results) {
                console.log(
                    `  [${r.dieId}] → грань ${r.faceIndex} → ${r.yield.resourceId} +${r.yield.amount}`
                );
            }
            const econ = state.economy;
            const nextEcon: [PlayerEconomy, PlayerEconomy] = [
                econ[0]!,
                econ[1]!,
            ] as const;
            const cur = econ[pid]!;
            nextEcon[pid] = applyResourceGains(cur, bag);

            console.log(`Итого в броске: ${JSON.stringify(bag)}`);

            state = withEconomy(withCurrentPlayer(state, pid === 0 ? 1 : 0), nextEcon);
            console.log(`Теперь ход игрока ${state.currentPlayer}.`);
        }
        console.log("Выход.");
    } finally {
        rl.close();
    }
}

main().catch((e) => {
    console.error(e);
    process.exitCode = 1;
});
