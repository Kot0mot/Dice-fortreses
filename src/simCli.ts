import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import type { BotName, SimulationConfig } from "./sim/types.js";
import { runSimulation, runSweep, writeSimulationReports } from "./sim/runSimulation.js";

interface CliArgs {
    matches: number;
    seed: number;
    p0: BotName;
    p1: BotName;
    maxRounds: number;
    out: string;
    sweep: string | null;
}

const SIM_HELP = `Dice Fortresses simulation runner

Usage:
  npm run sim -- [options]

Options:
  -h, --help              Show this help and exit
  --matches=<int>         Number of matches (default: 1000)
  --seed=<int>            First seed for deterministic run (default: 1)
  --p0=<bot>              Bot for player 0: aggro|tank|balanced (default: balanced)
  --p1=<bot>              Bot for player 1: aggro|tank|balanced (default: balanced)
  --max-rounds=<int>      Max rounds per match before timeout (default: 40)
  --out=<path>            Output prefix for reports (default: ./sim-results/run-001)
  --sweep=<preset>        Run preset sweep and save combined summary

Examples:
  npm run sim -- --matches=500 --seed=42 --p0=aggro --p1=tank
  npm run sim -- --sweep=bots --out=./sim-results/sweep-bots
  npm run sim -- --max-rounds=60 --out=./sim-results/long-run
`;

const BOT_NAMES: readonly BotName[] = ["aggro", "tank", "balanced"];

function parseBot(value: string, name: string): BotName {
    if ((BOT_NAMES as readonly string[]).includes(value)) return value as BotName;
    throw new Error(`Invalid ${name} bot "${value}". Expected: ${BOT_NAMES.join("|")}`);
}

export function parseArgs(argv: readonly string[]): CliArgs {
    if (argv.includes("--help") || argv.includes("-h")) {
        console.log(SIM_HELP);
        process.exit(0);
    }
    const args: CliArgs = {
        matches: 1000,
        seed: 1,
        p0: "balanced",
        p1: "balanced",
        maxRounds: 40,
        out: "./sim-results/run-001",
        sweep: null,
    };
    for (const arg of argv) {
        if (arg.startsWith("--matches=")) args.matches = Number(arg.slice("--matches=".length));
        else if (arg.startsWith("--seed=")) args.seed = Number(arg.slice("--seed=".length));
        else if (arg.startsWith("--p0=")) args.p0 = parseBot(arg.slice("--p0=".length), "p0");
        else if (arg.startsWith("--p1=")) args.p1 = parseBot(arg.slice("--p1=".length), "p1");
        else if (arg.startsWith("--max-rounds=")) args.maxRounds = Number(arg.slice("--max-rounds=".length));
        else if (arg.startsWith("--out=")) args.out = arg.slice("--out=".length);
        else if (arg.startsWith("--sweep=")) args.sweep = arg.slice("--sweep=".length);
        else if (arg.trim() !== "") throw new Error(`Unknown argument: ${arg}. Run with --help for usage.`);
    }
    if (!Number.isInteger(args.matches) || args.matches < 1) throw new Error("--matches must be positive integer");
    if (!Number.isInteger(args.seed)) throw new Error("--seed must be integer");
    if (!Number.isInteger(args.maxRounds) || args.maxRounds < 1) {
        throw new Error("--max-rounds must be positive integer");
    }
    return args;
}

async function main(): Promise<void> {
    const parsed = parseArgs(process.argv.slice(2));
    const config: SimulationConfig = {
        matches: parsed.matches,
        seedStart: parsed.seed,
        maxRoundsPerMatch: parsed.maxRounds,
        p0Bot: parsed.p0,
        p1Bot: parsed.p1,
    };

    if (parsed.sweep) {
        const runs = runSweep(config, parsed.sweep);
        const payload = {
            baseConfig: config,
            sweep: parsed.sweep,
            runs: runs.map((r) => ({
                overrideLabel: r.overrideLabel,
                config: r.result.config,
                aggregate: r.result.aggregate,
            })),
        };
        await mkdir(dirname(parsed.out), { recursive: true });
        await writeFile(`${parsed.out}.summary.json`, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
        console.log(`Sweep complete: ${runs.length} runs -> ${parsed.out}.summary.json`);
        return;
    }

    const result = runSimulation(config);
    await writeSimulationReports(parsed.out, result);
    console.log(
        `Simulation complete (${result.aggregate.totalMatches} matches): P0 winrate=${result.aggregate.winRateP0.toFixed(3)}, P1 winrate=${result.aggregate.winRateP1.toFixed(3)}`
    );
    console.log(`Saved: ${parsed.out}.summary.json and ${parsed.out}.matches.csv`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
