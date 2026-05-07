import { describe, expect, it } from "vitest";

import {
    TelemetryLiteSession,
    playtestReportToCsv,
    validateFeedback,
    validateFeedbackRating,
    type PlaytestFeedback,
} from "../src/telemetry.js";

describe("playtest telemetry", () => {
    it("aggregates required session metrics", () => {
        const t = new TelemetryLiteSession("pt-test");
        t.sessionStarted(1_000);
        t.turnStarted(1, 0, 12, 12, 1_100);
        t.rerollUsed(1, 0, 1_200);
        t.armAction(1, 0, false, 4, 1_250);
        t.turnEnded(1, 0, 12, 9, 1_500);
        t.turnStarted(2, 1, 12, 9, 1_600);
        t.playerError(2, 1, "invalid_arm_column", 1_700);
        t.armAction(2, 1, true, null, 1_710);
        t.turnEnded(2, 1, 10, 9, 1_900);
        t.matchEnded(2, 0, 2_000);

        const report = t.report({
            rulesClarity: 4,
            diceChoiceInterest: 5,
            playAgainDesire: 4,
            comment: "Good loop",
        });

        expect(report.summary.turns).toBe(2);
        expect(report.summary.inputErrors).toBe(1);
        expect(report.summary.rerollsUsedPerPlayer[0]).toBe(1);
        expect(report.summary.rerollsUsedPerPlayer[1]).toBe(0);
        expect(report.summary.averageDamageToCorePerTurn).toBe(2.5);
        expect(report.summary.skipArmShare).toBe(0.5);
        expect(report.summary.winnerPlayerId).toBe(0);
        expect(report.summary.roundsToVictory).toBe(2);
    });

    it("validates feedback ratings in 1..5", () => {
        expect(() => validateFeedbackRating(0)).toThrow("1..5");
        expect(() => validateFeedbackRating(6)).toThrow("1..5");
        expect(() => validateFeedback({ rulesClarity: 1, diceChoiceInterest: 5, playAgainDesire: 3, comment: "" })).not.toThrow();
    });

    it("exports JSON report and CSV with required columns", () => {
        const t = new TelemetryLiteSession("pt-export");
        t.sessionStarted(10);
        t.turnStarted(1, 0, 12, 12, 20);
        t.armAction(1, 0, true, null, 30);
        t.turnEnded(1, 0, 12, 12, 40);
        t.matchEnded(1, 1, 50);
        const feedback: PlaytestFeedback = {
            rulesClarity: 3,
            diceChoiceInterest: 4,
            playAgainDesire: 5,
            comment: "ok",
        };
        const report = t.report(feedback);
        const raw = JSON.stringify(report);
        const parsed = JSON.parse(raw) as Record<string, unknown>;
        expect(parsed).toHaveProperty("sessionId");
        expect(parsed).toHaveProperty("summary");
        expect(parsed).toHaveProperty("keyEvents");
        expect(parsed).toHaveProperty("feedback");

        const csv = playtestReportToCsv(report);
        expect(csv).toContain("sessionId,startedAt,endedAt");
        expect(csv).toContain("rulesClarity");
        expect(csv).toContain("pt-export");
    });
});
