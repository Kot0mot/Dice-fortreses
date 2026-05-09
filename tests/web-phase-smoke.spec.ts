import { describe, expect, it } from "vitest";

import {
    advanceCurrentPlayer,
    applyArmColumnAttack,
    applyBuildCommand,
    endTurnUpdateFortify,
    validateBuildCommand,
} from "../src/game.js";
import { resolveDiceFortsSlots } from "../src/rules.js";
import { createInitialMatchState, opponentOf, patchPlayerSecrets } from "../src/state.js";
import { getArmTargets, getBuildTargets } from "../web/ui-helpers.js";

describe("web phase smoke", () => {
    it("supports Build -> Arm -> End flow without manual coordinates", () => {
        let state = createInitialMatchState();
        const pid = state.currentPlayer;
        const defenderId = opponentOf(pid);
        const slots = resolveDiceFortsSlots({ build: [5], fortify: [2], arm: [6] });
        expect(slots.arm.canFire).toBe(true);

        const buildTargets = getBuildTargets(state, pid);
        expect(buildTargets.length).toBeGreaterThan(0);
        const target = buildTargets[0]!;
        const spend = 1;
        const validationError = validateBuildCommand(state, pid, { type: "new", x: target.x, y: target.y, spend }, slots.buildPoints, {});
        expect(validationError).toBeNull();
        const buildOut = applyBuildCommand(state, pid, { type: "new", x: target.x, y: target.y, spend }, slots.buildPoints, {});
        expect(buildOut).not.toBeNull();
        state = buildOut!.state;

        const armTargets = getArmTargets(state, pid);
        expect(armTargets.length).toBeGreaterThan(0);
        const armOut = applyArmColumnAttack(
            state,
            pid,
            armTargets[0]!,
            slots.arm.damage,
            slots.arm.pierceDepth,
            state.players[defenderId]!.savedFortifyCharges
        );
        state = armOut.state;
        state = patchPlayerSecrets(state, defenderId, { savedFortifyCharges: armOut.chargesRemaining });

        state = endTurnUpdateFortify(state, pid, slots.fortifyCharges);
        state = advanceCurrentPlayer(state);
        expect(state.currentPlayer).toBe(defenderId);
    });
});
