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
import { getBotStrategy } from "../src/sim/bots.js";
import type { BotName } from "../src/sim/types.js";
import type { BuildCommand } from "../src/game.js";
import type { DiceFortsSlotResolution, DiceFortsSlots } from "../src/types.js";
import type { SlotName } from "./ui-helpers.js";

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

export function runBotTurn(match: MatchState, hand: readonly number[], rng: DiceFortsRng, botName: BotName = "balanced"): BotTurnResult {
    const playerId = match.currentPlayer;
    const bot = getBotStrategy(botName);
    let state = match;
    let botHand = [...hand];
    let rerolled = false;

    if (bot.shouldReroll({ playerId, state, hand: botHand, rerollsLeft: state.rerollsLeftThisTurn })) {
        const rerollOut = applyHandReroll(state, rng);
        if (rerollOut) {
            state = rerollOut.state;
            botHand = rerollOut.hand;
            rerolled = true;
        }
    }

    const slots = bot.pickSlots({ playerId, state, hand: botHand, rerollsLeft: state.rerollsLeftThisTurn });
    if (!isValidSlotPartition(botHand, slots)) {
        throw new Error(`Bot ${bot.name} generated invalid slot partition.`);
    }
    const resolution = resolveDiceFortsSlots(slots);
    const buildCommands = bot.pickBuildCommands({ playerId, state, budget: resolution.buildPoints });

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
        const pickedColumn = bot.pickArmColumn({ playerId, state, resolution });
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
    };
}
