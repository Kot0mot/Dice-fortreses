import type { MatchSummary, SimulationAggregateMetrics, SimulationResult } from "./types.js";

function ratio(numerator: number, denominator: number): number {
    if (denominator <= 0) return 0;
    return numerator / denominator;
}

function avg(sum: number, count: number): number {
    if (count <= 0) return 0;
    return sum / count;
}

export function computeAggregateMetrics(matches: readonly MatchSummary[]): SimulationAggregateMetrics {
    const total = matches.length;
    const p0Wins = matches.filter((m) => m.winner === 0).length;
    const p1Wins = matches.filter((m) => m.winner === 1).length;
    const draws = total - p0Wins - p1Wins;
    const roundsSum = matches.reduce((sum, m) => sum + m.rounds, 0);
    const coreDamage = matches.reduce((sum, m) => sum + m.coreDamageByP0 + m.coreDamageByP1, 0);
    const rerolls = matches.reduce((sum, m) => sum + m.rerollsUsedP0 + m.rerollsUsedP1, 0);
    const timeouts = matches.filter((m) => m.timeout).length;
    const buildSpent = matches.reduce((sum, m) => sum + m.buildSpentP0 + m.buildSpentP1, 0);
    const fortifySpent = matches.reduce((sum, m) => sum + m.fortifySpentP0 + m.fortifySpentP1, 0);
    const armSpent = matches.reduce((sum, m) => sum + m.armSpentP0 + m.armSpentP1, 0);

    return {
        totalMatches: total,
        p0Wins,
        p1Wins,
        draws,
        winRateP0: ratio(p0Wins, total),
        winRateP1: ratio(p1Wins, total),
        averageRounds: avg(roundsSum, total),
        winRoundBuckets: {
            rounds1to5: matches.filter((m) => m.winner !== null && m.rounds <= 5).length,
            rounds6to10: matches.filter((m) => m.winner !== null && m.rounds >= 6 && m.rounds <= 10).length,
            rounds11plus: matches.filter((m) => m.winner !== null && m.rounds >= 11).length,
        },
        averageCoreDamagePerMatch: avg(coreDamage, total),
        averageRerollsPerMatch: avg(rerolls, total),
        timeoutRate: ratio(timeouts, total),
        averageBuildSpentPerMatch: avg(buildSpent, total),
        averageFortifySpentPerMatch: avg(fortifySpent, total),
        averageArmSpentPerMatch: avg(armSpent, total),
    };
}

function escapeCsvValue(value: string | number | boolean): string {
    const text = String(value);
    if (text.includes(",") || text.includes('"') || text.includes("\n")) {
        return `"${text.replaceAll('"', '""')}"`;
    }
    return text;
}

export function matchesCsv(matches: readonly MatchSummary[]): string {
    const header = [
        "matchId",
        "seed",
        "winner",
        "rounds",
        "coreHpP0",
        "coreHpP1",
        "rerollsUsedP0",
        "rerollsUsedP1",
        "timeout",
    ];
    const rows = matches.map((m) =>
        [
            m.matchId,
            m.seed,
            m.winner === null ? "draw" : m.winner,
            m.rounds,
            m.coreHpP0,
            m.coreHpP1,
            m.rerollsUsedP0,
            m.rerollsUsedP1,
            m.timeout,
        ]
            .map(escapeCsvValue)
            .join(",")
    );
    return [header.join(","), ...rows].join("\n");
}

export function summaryJson(result: SimulationResult): string {
    return `${JSON.stringify(
        {
            config: result.config,
            aggregate: result.aggregate,
        },
        null,
        2
    )}\n`;
}
