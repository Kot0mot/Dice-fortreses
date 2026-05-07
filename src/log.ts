import type { DiceFortsSlotResolution, DiceFortsSlots } from "./types.js";
import type { PlayerId } from "./state.js";

export interface BuildAppliedOperation {
    readonly kind: "new" | "repair";
    readonly x: number;
    readonly y: number;
    readonly spent: number;
    readonly hpBefore: number;
    readonly hpAfter: number;
}

export interface ArmHitTarget {
    readonly x: number;
    readonly y: number;
    readonly kind: "block" | "core";
    readonly hpBefore: number;
    readonly hpAfter: number;
    readonly destroyed: boolean;
}

export type GameLogEvent =
    | {
          readonly type: "turn_started";
          readonly round: number;
          readonly playerId: PlayerId;
          readonly rerollsAvailable: number;
      }
    | {
          readonly type: "dice_rolled";
          readonly hand: readonly number[];
          readonly reason: "initial" | "reroll";
      }
    | {
          readonly type: "reroll_used";
          readonly remaining: number;
      }
    | {
          readonly type: "slots_committed";
          readonly build: readonly number[];
          readonly fortify: readonly number[];
          readonly arm: readonly number[];
          readonly resolved: DiceFortsSlotResolution;
      }
    | {
          readonly type: "build_applied";
          readonly operations: readonly BuildAppliedOperation[];
      }
    | {
          readonly type: "arm_fired";
          readonly column: number;
          readonly damage: number;
          readonly pierceDepth: number;
          readonly targetsHit: readonly ArmHitTarget[];
      }
    | {
          readonly type: "fortify_applied";
          readonly chargesBefore: number;
          readonly absorbed: number;
          readonly chargesAfter: number;
      }
    | {
          readonly type: "turn_ended";
          readonly coreHpP0: number;
          readonly coreHpP1: number;
          readonly nextPlayerId: PlayerId;
      }
    | {
          readonly type: "game_ended";
          readonly winnerPlayerId: PlayerId;
          readonly round: number;
      };

function fmtSlots(slots: DiceFortsSlots): string {
    return `build=[${slots.build.join(",")}] fortify=[${slots.fortify.join(",")}] arm=[${slots.arm.join(",")}]`;
}

export function formatTurnLog(events: readonly GameLogEvent[]): string {
    const out: string[] = [];
    for (const ev of events) {
        switch (ev.type) {
            case "turn_started":
                out.push(
                    `[turn_started] round=${ev.round} player=${ev.playerId} rerolls=${ev.rerollsAvailable}`
                );
                break;
            case "dice_rolled":
                out.push(`[dice_rolled] reason=${ev.reason} hand=[${ev.hand.join(", ")}]`);
                break;
            case "reroll_used":
                out.push(`[reroll_used] remaining=${ev.remaining}`);
                break;
            case "slots_committed":
                out.push(
                    `[slots_committed] ${fmtSlots({
                        build: ev.build,
                        fortify: ev.fortify,
                        arm: ev.arm,
                    })} => buildPts=${ev.resolved.buildPoints} fortify=${ev.resolved.fortifyCharges} armDamage=${ev.resolved.arm.damage} pierce=${ev.resolved.arm.pierceDepth}`
                );
                break;
            case "build_applied":
                out.push(
                    `[build_applied] operations=${ev.operations
                        .map(
                            (o) =>
                                `${o.kind}@(${o.x},${o.y}) spent=${o.spent} hp:${o.hpBefore}->${o.hpAfter}`
                        )
                        .join("; ")}`
                );
                break;
            case "arm_fired":
                out.push(
                    `[arm_fired] x=${ev.column} damage=${ev.damage} pierce=${ev.pierceDepth} hits=${ev.targetsHit
                        .map((t) => `(${t.x},${t.y}) ${t.kind} ${t.hpBefore}->${t.hpAfter}${t.destroyed ? " destroyed" : ""}`)
                        .join("; ")}`
                );
                break;
            case "fortify_applied":
                out.push(
                    `[fortify_applied] charges=${ev.chargesBefore}->${ev.chargesAfter} absorbed=${ev.absorbed}`
                );
                break;
            case "turn_ended":
                out.push(
                    `[turn_ended] coreHpP0=${ev.coreHpP0} coreHpP1=${ev.coreHpP1} nextPlayer=${ev.nextPlayerId}`
                );
                break;
            case "game_ended":
                out.push(`[game_ended] winner=${ev.winnerPlayerId} round=${ev.round}`);
                break;
        }
    }
    return out.join("\n");
}
