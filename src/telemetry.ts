export type TelemetryEventType =
    | "session_started"
    | "turn_started"
    | "reroll_used"
    | "slots_committed"
    | "build_action"
    | "arm_action"
    | "turn_ended"
    | "match_ended"
    | "player_error";

export interface TelemetryEventBase {
    readonly type: TelemetryEventType;
    readonly ts: number;
    readonly round: number | null;
    readonly playerId: number | null;
}

export type TelemetryEvent =
    | (TelemetryEventBase & {
          readonly type: "session_started";
      })
    | (TelemetryEventBase & {
          readonly type: "turn_started";
          readonly coreHpP0: number;
          readonly coreHpP1: number;
      })
    | (TelemetryEventBase & {
          readonly type: "reroll_used";
      })
    | (TelemetryEventBase & {
          readonly type: "slots_committed";
          readonly buildDice: number;
          readonly fortifyDice: number;
          readonly armDice: number;
      })
    | (TelemetryEventBase & {
          readonly type: "build_action";
          readonly action: "new" | "repair";
          readonly spent: number;
      })
    | (TelemetryEventBase & {
          readonly type: "arm_action";
          readonly skipped: boolean;
          readonly column: number | null;
      })
    | (TelemetryEventBase & {
          readonly type: "turn_ended";
          readonly coreHpP0: number;
          readonly coreHpP1: number;
      })
    | (TelemetryEventBase & {
          readonly type: "match_ended";
          readonly winnerPlayerId: number;
      })
    | (TelemetryEventBase & {
          readonly type: "player_error";
          readonly message: string;
      });

export interface PlaytestFeedback {
    readonly rulesClarity: number;
    readonly diceChoiceInterest: number;
    readonly playAgainDesire: number;
    readonly comment: string;
}

export interface TelemetrySummary {
    readonly sessionDurationMs: number;
    readonly turns: number;
    readonly inputErrors: number;
    readonly rerollsUsedPerPlayer: Record<number, number>;
    readonly averageDamageToCorePerTurn: number;
    readonly winnerPlayerId: number | null;
    readonly roundsToVictory: number | null;
    readonly skipArmShare: number;
}

export interface PlaytestReport {
    readonly sessionId: string;
    readonly startedAt: number;
    readonly endedAt: number;
    readonly summary: TelemetrySummary;
    readonly feedback: PlaytestFeedback | null;
    readonly keyEvents: readonly TelemetryEvent[];
}

interface TurnStartSnapshot {
    readonly round: number;
    readonly playerId: number;
    readonly coreHpP0: number;
    readonly coreHpP1: number;
}

export function createPlaytestSessionId(now = Date.now()): string {
    const random = Math.floor(Math.random() * 1_000_000)
        .toString()
        .padStart(6, "0");
    return `pt-${now}-${random}`;
}

export function validateFeedbackRating(value: number): number {
    if (!Number.isInteger(value) || value < 1 || value > 5) {
        throw new Error("Feedback ratings must be integers in range 1..5");
    }
    return value;
}

export function validateFeedback(feedback: PlaytestFeedback): PlaytestFeedback {
    return {
        rulesClarity: validateFeedbackRating(feedback.rulesClarity),
        diceChoiceInterest: validateFeedbackRating(feedback.diceChoiceInterest),
        playAgainDesire: validateFeedbackRating(feedback.playAgainDesire),
        comment: feedback.comment ?? "",
    };
}

export class TelemetryLiteSession {
    private readonly startedAt = Date.now();
    private endedAt = this.startedAt;
    private readonly events: TelemetryEvent[] = [];
    private turns = 0;
    private inputErrors = 0;
    private readonly rerollsUsedPerPlayer: Record<number, number> = { 0: 0, 1: 0 };
    private totalDamageToCore = 0;
    private armActions = 0;
    private armSkips = 0;
    private winnerPlayerId: number | null = null;
    private roundsToVictory: number | null = null;
    private turnStartSnapshot: TurnStartSnapshot | null = null;

    constructor(readonly sessionId: string) {}

    private push(event: TelemetryEvent): void {
        this.events.push(event);
        this.endedAt = event.ts;
    }

    sessionStarted(ts = Date.now()): void {
        this.push({ type: "session_started", ts, round: null, playerId: null });
    }

    turnStarted(round: number, playerId: number, coreHpP0: number, coreHpP1: number, ts = Date.now()): void {
        this.turns += 1;
        this.turnStartSnapshot = { round, playerId, coreHpP0, coreHpP1 };
        this.push({ type: "turn_started", ts, round, playerId, coreHpP0, coreHpP1 });
    }

    rerollUsed(round: number, playerId: number, ts = Date.now()): void {
        this.rerollsUsedPerPlayer[playerId] = (this.rerollsUsedPerPlayer[playerId] ?? 0) + 1;
        this.push({ type: "reroll_used", ts, round, playerId });
    }

    slotsCommitted(round: number, playerId: number, buildDice: number, fortifyDice: number, armDice: number, ts = Date.now()): void {
        this.push({ type: "slots_committed", ts, round, playerId, buildDice, fortifyDice, armDice });
    }

    buildAction(round: number, playerId: number, action: "new" | "repair", spent: number, ts = Date.now()): void {
        this.push({ type: "build_action", ts, round, playerId, action, spent });
    }

    armAction(round: number, playerId: number, skipped: boolean, column: number | null, ts = Date.now()): void {
        this.armActions += 1;
        if (skipped) this.armSkips += 1;
        this.push({ type: "arm_action", ts, round, playerId, skipped, column });
    }

    turnEnded(round: number, playerId: number, coreHpP0: number, coreHpP1: number, ts = Date.now()): void {
        const start = this.turnStartSnapshot;
        if (start && start.round === round && start.playerId === playerId) {
            const p0Damage = Math.max(0, start.coreHpP0 - coreHpP0);
            const p1Damage = Math.max(0, start.coreHpP1 - coreHpP1);
            this.totalDamageToCore += p0Damage + p1Damage;
        }
        this.push({ type: "turn_ended", ts, round, playerId, coreHpP0, coreHpP1 });
    }

    matchEnded(round: number, winnerPlayerId: number, ts = Date.now()): void {
        this.winnerPlayerId = winnerPlayerId;
        this.roundsToVictory = round;
        this.push({ type: "match_ended", ts, round, playerId: null, winnerPlayerId });
    }

    playerError(round: number, playerId: number | null, message: string, ts = Date.now()): void {
        this.inputErrors += 1;
        this.push({ type: "player_error", ts, round, playerId, message });
    }

    summary(): TelemetrySummary {
        return {
            sessionDurationMs: this.endedAt - this.startedAt,
            turns: this.turns,
            inputErrors: this.inputErrors,
            rerollsUsedPerPlayer: { ...this.rerollsUsedPerPlayer },
            averageDamageToCorePerTurn: this.turns > 0 ? this.totalDamageToCore / this.turns : 0,
            winnerPlayerId: this.winnerPlayerId,
            roundsToVictory: this.roundsToVictory,
            skipArmShare: this.armActions > 0 ? this.armSkips / this.armActions : 0,
        };
    }

    report(feedback: PlaytestFeedback | null): PlaytestReport {
        return {
            sessionId: this.sessionId,
            startedAt: this.startedAt,
            endedAt: this.endedAt,
            summary: this.summary(),
            feedback: feedback ? validateFeedback(feedback) : null,
            keyEvents: [...this.events],
        };
    }
}

export function playtestReportToCsv(report: PlaytestReport): string {
    const header = [
        "sessionId",
        "startedAt",
        "endedAt",
        "sessionDurationMs",
        "turns",
        "inputErrors",
        "rerollsP0",
        "rerollsP1",
        "avgCoreDamagePerTurn",
        "winnerPlayerId",
        "roundsToVictory",
        "skipArmShare",
        "rulesClarity",
        "diceChoiceInterest",
        "playAgainDesire",
        "comment",
    ];
    const row = [
        report.sessionId,
        String(report.startedAt),
        String(report.endedAt),
        String(report.summary.sessionDurationMs),
        String(report.summary.turns),
        String(report.summary.inputErrors),
        String(report.summary.rerollsUsedPerPlayer[0] ?? 0),
        String(report.summary.rerollsUsedPerPlayer[1] ?? 0),
        report.summary.averageDamageToCorePerTurn.toFixed(3),
        report.summary.winnerPlayerId === null ? "" : String(report.summary.winnerPlayerId),
        report.summary.roundsToVictory === null ? "" : String(report.summary.roundsToVictory),
        report.summary.skipArmShare.toFixed(3),
        report.feedback ? String(report.feedback.rulesClarity) : "",
        report.feedback ? String(report.feedback.diceChoiceInterest) : "",
        report.feedback ? String(report.feedback.playAgainDesire) : "",
        csvEscape(report.feedback?.comment ?? ""),
    ];
    return `${header.join(",")}\n${row.join(",")}\n`;
}

function csvEscape(value: string): string {
    const escaped = value.replace(/"/g, "\"\"");
    if (/[",\n]/.test(escaped)) {
        return `"${escaped}"`;
    }
    return escaped;
}
