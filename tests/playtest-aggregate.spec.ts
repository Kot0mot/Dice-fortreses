import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { aggregatePlaytestReports, loadPlaytestReports } from "../src/playtestAggregate.js";
import type { PlaytestReport } from "../src/telemetry.js";

function makeReport(id: string, winner: number, duration: number, comment: string, errors: string[]): PlaytestReport {
    return {
        sessionId: id,
        startedAt: 1_000,
        endedAt: 1_000 + duration,
        summary: {
            sessionDurationMs: duration,
            turns: 4,
            inputErrors: errors.length,
            rerollsUsedPerPlayer: { 0: 1, 1: 2 },
            averageDamageToCorePerTurn: 1.25,
            winnerPlayerId: winner,
            roundsToVictory: 4,
            skipArmShare: 0.25,
        },
        feedback: {
            rulesClarity: winner === 0 ? 4 : 2,
            diceChoiceInterest: 3,
            playAgainDesire: winner === 0 ? 5 : 3,
            comment,
        },
        keyEvents: errors.map((message, index) => ({
            type: "player_error" as const,
            ts: 2_000 + index,
            round: index + 1,
            playerId: 0,
            message,
        })),
    };
}

describe("playtest aggregate helper", () => {
    it("aggregates averages, winrate, and top input errors", () => {
        const reports = [
            makeReport("a", 0, 9000, "nice", ["invalid_arm_column", "invalid_arm_column"]),
            makeReport("b", 1, 7000, "hard", ["invalid_slots_partition"]),
            makeReport("c", 0, 8000, "good", ["invalid_arm_column"]),
        ];
        const out = aggregatePlaytestReports(reports);
        expect(out.reportsCount).toBe(3);
        expect(out.avgRulesClarity).toBeCloseTo((4 + 2 + 4) / 3, 5);
        expect(out.avgMatchDurationMs).toBe(8000);
        expect(out.winrateByPlayer["0"]).toBeCloseTo(2 / 3, 5);
        expect(out.winrateByPlayer["1"]).toBeCloseTo(1 / 3, 5);
        expect(out.topInputErrors[0]?.message).toBe("invalid_arm_column");
        expect(out.topInputErrors[0]?.count).toBe(3);
    });

    it("loads reports from wildcard path", async () => {
        const root = await mkdtemp(join(tmpdir(), "playtest-agg-"));
        try {
            const dir = join(root, "playtest-results");
            await mkdir(dir, { recursive: true });
            await writeFile(join(dir, "one.json"), JSON.stringify(makeReport("one", 0, 1000, "", [])), "utf8");
            await writeFile(join(dir, "two.json"), JSON.stringify(makeReport("two", 1, 2000, "", [])), "utf8");
            const loaded = await loadPlaytestReports([join(dir, "*.json")]);
            expect(loaded.length).toBe(2);
        } finally {
            await rm(root, { recursive: true, force: true });
        }
    });
});
