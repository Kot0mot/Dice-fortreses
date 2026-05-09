import { describe, it, expect, vi } from "vitest";
import { createInitialV2Match, tryPlaceNode, tryPlaceBeam, tryPlaceBuilding, tryRepairAll } from "../src/matchState.js";
import { performCollapse } from "../src/physics.js";

describe("Dice Fortresses v2 Advanced Mechanics", () => {
    it("should collapse structures not connected to ground", () => {
        let state = createInitialV2Match();
        state.economy[0].resources.steel = 100;

        // Place nodes in the air (Y=5)
        state = tryPlaceNode(state, 10, 5, 0);
        state = tryPlaceNode(state, 11, 5, 0);
        state = tryPlaceBeam(state, "node-0-10-5", "node-0-11-5", "wood", 0);

        const physState = {
            nodes: new Map(state.nodes),
            beams: new Map(state.beams),
            buildings: new Map(state.buildings)
        };
        const { collapsedBeams } = performCollapse(physState);

        expect(collapsedBeams).toContain("beam-node-0-10-5-node-0-11-5");
        expect(physState.nodes.has("node-0-10-5")).toBe(false);
    });

    it("should handle building technology dependencies", () => {
        let state = createInitialV2Match();
        state.economy[0].resources.steel = 500;
        state.economy[0].resources.power = 500;
        // @ts-ignore
        state.economy[0] = { ...state.economy[0], workers: 10, workersTotal: 10 };

        // Ground nodes exist in createInitialV2Match
        const groundId = "ground-0-0";

        // Use a building that DOES NOT have tech requirements first
        state = tryPlaceBuilding(state, "tech_station", [groundId], 0);
        const techId = Array.from(state.buildings.keys()).find(k => k !== "core-0" && k !== "core-1");
        expect(techId).toBeDefined();

        // Now place Laser turret which requires tech_station
        state = tryPlaceBuilding(state, "laser_turret", ["ground-0-1"], 0);
        const turretId = Array.from(state.buildings.keys()).find(k => k !== "core-0" && k !== "core-1" && k !== techId);
        expect(turretId).toBeDefined();

        const physState1 = {
            nodes: new Map(state.nodes),
            beams: new Map(state.beams),
            buildings: new Map(state.buildings)
        };
        performCollapse(physState1);
        expect(physState1.buildings.get(turretId!)!.isOperational).toBe(true);

        // Remove tech station
        physState1.buildings.delete(techId!);
        performCollapse(physState1);
        expect(physState1.buildings.get(turretId!)!.isOperational).toBe(false);
    });
});
