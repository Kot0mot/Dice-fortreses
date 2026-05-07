import { readdir, readFile } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";

import type { PlaytestReport } from "./telemetry.js";

export interface AggregatedPlaytestMetrics {
    readonly reportsCount: number;
    readonly avgRulesClarity: number;
    readonly avgDiceChoiceInterest: number;
    readonly avgPlayAgainDesire: number;
    readonly avgMatchDurationMs: number;
    readonly winrateByPlayer: Record<string, number>;
    readonly topInputErrors: Array<{ message: string; count: number }>;
}

export function aggregatePlaytestReports(reports: readonly PlaytestReport[]): AggregatedPlaytestMetrics {
    const ratings = reports
        .map((report) => report.feedback)
        .filter((feedback): feedback is NonNullable<PlaytestReport["feedback"]> => feedback !== null);
    const avgRulesClarity = average(ratings.map((item) => item.rulesClarity));
    const avgDiceChoiceInterest = average(ratings.map((item) => item.diceChoiceInterest));
    const avgPlayAgainDesire = average(ratings.map((item) => item.playAgainDesire));
    const avgMatchDurationMs = average(reports.map((report) => report.summary.sessionDurationMs));

    const wins: Record<string, number> = {};
    for (const report of reports) {
        if (report.summary.winnerPlayerId === null) continue;
        const key = String(report.summary.winnerPlayerId);
        wins[key] = (wins[key] ?? 0) + 1;
    }
    const withWinner = reports.filter((report) => report.summary.winnerPlayerId !== null).length;
    const winrateByPlayer: Record<string, number> = {};
    for (const [playerId, winsCount] of Object.entries(wins)) {
        winrateByPlayer[playerId] = withWinner > 0 ? winsCount / withWinner : 0;
    }

    const inputErrorCounts = new Map<string, number>();
    for (const report of reports) {
        for (const event of report.keyEvents) {
            if (event.type !== "player_error") continue;
            inputErrorCounts.set(event.message, (inputErrorCounts.get(event.message) ?? 0) + 1);
        }
    }
    const topInputErrors = [...inputErrorCounts.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([message, count]) => ({ message, count }));

    return {
        reportsCount: reports.length,
        avgRulesClarity,
        avgDiceChoiceInterest,
        avgPlayAgainDesire,
        avgMatchDurationMs,
        winrateByPlayer,
        topInputErrors,
    };
}

function average(values: readonly number[]): number {
    if (values.length === 0) return 0;
    return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export async function loadPlaytestReports(inputs: readonly string[]): Promise<PlaytestReport[]> {
    const files = await resolveInputFiles(inputs);
    const reports: PlaytestReport[] = [];
    for (const filePath of files) {
        const raw = await readFile(filePath, "utf8");
        reports.push(JSON.parse(raw) as PlaytestReport);
    }
    return reports;
}

async function resolveInputFiles(inputs: readonly string[]): Promise<string[]> {
    if (inputs.length === 0) {
        const cwd = process.cwd();
        const entries = await readdir(resolve(cwd, "playtest-results"));
        return entries.filter((name) => name.endsWith(".json")).map((name) => resolve(cwd, "playtest-results", name));
    }
    const out: string[] = [];
    for (const input of inputs) {
        if (input.includes("*")) {
            const pattern = basename(input);
            const rawDir = dirname(input);
            const dirPath = isAbsolute(rawDir) ? rawDir : resolve(process.cwd(), rawDir);
            const regex = wildcardToRegex(pattern);
            const entries = await readdir(dirPath);
            for (const entry of entries) {
                if (regex.test(entry)) out.push(resolve(dirPath, entry));
            }
        } else {
            out.push(resolve(process.cwd(), input));
        }
    }
    return out;
}

function wildcardToRegex(pattern: string): RegExp {
    const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`^${escaped.replace(/\*/g, ".*")}$`);
}
