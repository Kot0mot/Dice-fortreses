import {
    advanceCurrentPlayer,
    applyArmColumnAttack,
    applyBuildCommand,
    applyHandReroll,
    endTurnUpdateFortify,
} from "../src/game.js";
import type { DiceFortsRng } from "../src/random.js";
import { isValidSlotPartition, resolveDiceFortsSlots } from "../src/rules.js";
import { opponentOf, patchPlayerSecrets, type MatchState, type PlayerId } from "../src/state.js";
import type { BuildCommand } from "../src/game.js";
import type { DiceFortsSlotResolution, DiceFortsSlots } from "../src/types.js";
import type { SlotName } from "./ui-helpers.js";
import { planBotTurn } from "./bot/strategies.js";
import type { BotDecisionLog, BotDifficulty } from "./bot/types.js";

export type GameMode = "hotseat" | "vsBot";

export interface BotTurnResult {
    state: MatchState;
    hand: number[];
    slots: DiceFortsSlots;
    slotAssignments: SlotName[];
    resolution: DiceFortsSlotResolution;
    buildCommands: BuildCommand[];
    armColumn: number | null;
    rerolled: boolean;
    decisionLog: BotDecisionLog;
}

export function shouldStartBotTurn(
    gameMode: GameMode,
    currentPlayer: PlayerId,
    isBotActing: boolean,
    winner: PlayerId | null
): boolean {
    return gameMode === "vsBot" && currentPlayer === 1 && !isBotActing && winner === null;
}

export function isUiLockedForBotTurn(isBotActing: boolean): boolean {
    return isBotActing;
}

export function claimBotTurnLock(gameMode: GameMode, currentPlayer: PlayerId, isBotActing: boolean, winner: PlayerId | null): boolean {
    return shouldStartBotTurn(gameMode, currentPlayer, isBotActing, winner);
}

function toAssignments(hand: readonly number[], slots: DiceFortsSlots): SlotName[] {
    const remaining = {
        build: [...slots.build],
        fortify: [...slots.fortify],
        arm: [...slots.arm],
    };
    return hand.map((die) => {
        const buildIdx = remaining.build.indexOf(die);
        if (buildIdx >= 0) {
            remaining.build.splice(buildIdx, 1);
            return "build";
        }
        const fortifyIdx = remaining.fortify.indexOf(die);
        if (fortifyIdx >= 0) {
            remaining.fortify.splice(fortifyIdx, 1);
            return "fortify";
        }
        const armIdx = remaining.arm.indexOf(die);
        if (armIdx >= 0) {
            remaining.arm.splice(armIdx, 1);
            return "arm";
        }
        return "build";
    });
}

export function runBotTurn(
    match: MatchState,
    hand: readonly number[],
    rng: DiceFortsRng,
    difficulty: BotDifficulty = "medium"
): BotTurnResult {
    const playerId = match.currentPlayer;
    let state = match;
    let botHand = [...hand];
    let rerolled = false;
    let plan = planBotTurn({
        difficulty,
        playerId,
        state,
        hand: botHand,
        rerollsLeft: state.rerollsLeftThisTurn,
        rng,
    });
    if (plan.reroll) {
        const rerollOut = applyHandReroll(state, rng);
        if (rerollOut) {
            state = rerollOut.state;
            botHand = rerollOut.hand;
            rerolled = true;
            plan = planBotTurn({
                difficulty,
                playerId,
                state,
                hand: botHand,
                rerollsLeft: state.rerollsLeftThisTurn,
                rng,
            });
        }
    }

    const slots = plan.slots;
    if (!isValidSlotPartition(botHand, slots)) {
        throw new Error(`Bot(${difficulty}) generated invalid slot partition.`);
    }
    const resolution = resolveDiceFortsSlots(slots);
    const buildCommands = plan.buildCommands;

    let budget = resolution.buildPoints;
    const repairUsed: Record<string, number> = {};
    for (const cmd of buildCommands) {
        const out = applyBuildCommand(state, playerId, cmd, budget, repairUsed);
        if (!out) continue;
        state = out.state;
        budget = out.budget;
    }

    let armColumn: number | null = null;
    if (resolution.arm.canFire) {
        const pickedColumn = plan.armColumn;
        if (pickedColumn !== null && pickedColumn >= 0 && pickedColumn < state.width) {
            const defId = opponentOf(playerId);
            const armOut = applyArmColumnAttack(
                state,
                playerId,
                pickedColumn,
                resolution.arm.damage,
                resolution.arm.pierceDepth,
                state.players[defId]!.savedFortifyCharges
            );
            state = patchPlayerSecrets(armOut.state, defId, { savedFortifyCharges: armOut.chargesRemaining });
            armColumn = pickedColumn;
        }
    }

    if (state.winner === null) {
        state = endTurnUpdateFortify(state, playerId, resolution.fortifyCharges);
        state = advanceCurrentPlayer(state);
    }

    return {
        state,
        hand: botHand,
        slots,
        slotAssignments: toAssignments(botHand, slots),
        resolution,
        buildCommands,
        armColumn,
        rerolled,
        decisionLog: plan.log,
    };
}
