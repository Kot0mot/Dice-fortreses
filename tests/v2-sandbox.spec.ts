import { describe, it, expect } from "vitest";
import type { Rng } from "../src/types.js";
import { assertValidDieDefinition, rollCustomDie } from "../src/customDie.js";
import { STARTER_CUBE } from "../src/catalog.js";
import { createInitialV2Match } from "../src/matchState.js";
import { getDicePoolDefinitions } from "../src/diceSystems.js";

const mockRng = (next: number): Rng => ({
    nextInt: (_min: number, _max: number) => next,
});

describe("v2 sandbox", () => {
    it("STARTER_CUBE валиден", () => {
        assertValidDieDefinition(STARTER_CUBE);
        expect(STARTER_CUBE.id).toBe("starter_die");
    });

    it("rollCustomDie детерминирован при фиксированном RNG", () => {
        assertValidDieDefinition(STARTER_CUBE);
        const r = rollCustomDie(STARTER_CUBE, "test#0", mockRng(2));
        expect(r.faceIndex).toBe(2);
        expect(r.yield.resourceId).toBe(STARTER_CUBE.faces[2]!.resourceId);
    });

    it("у каждого игрока в пуле ровно 2 кубика от генератора", () => {
        const s = createInitialV2Match();
        expect(getDicePoolDefinitions(s, 0).length).toBe(2);
        expect(getDicePoolDefinitions(s, 1).length).toBe(2);
        expect(getDicePoolDefinitions(s, 0).every((id) => id === "starter_die")).toBe(true);
    });
});
