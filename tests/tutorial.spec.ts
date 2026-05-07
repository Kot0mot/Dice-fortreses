import { describe, expect, it } from "vitest";
import {
    createTutorialMachine,
    currentTutorialStep,
    TUTORIAL_STEPS,
    tutorialNext,
    tutorialSkip,
} from "../web/tutorial.js";

describe("tutorial state machine", () => {
    it("starts at first step when enabled", () => {
        const state = createTutorialMachine(true);
        expect(state.isActive).toBe(true);
        expect(currentTutorialStep(state)?.id).toBe("roll");
    });

    it("does not show step when disabled", () => {
        const state = createTutorialMachine(false);
        expect(state.isActive).toBe(false);
        expect(currentTutorialStep(state)).toBeNull();
    });

    it("moves through steps and completes at the end", () => {
        let state = createTutorialMachine(true);
        for (let i = 0; i < TUTORIAL_STEPS.length; i++) {
            state = tutorialNext(state);
        }
        expect(state.isActive).toBe(false);
        expect(state.isCompleted).toBe(true);
        expect(currentTutorialStep(state)).toBeNull();
    });

    it("skip completes immediately", () => {
        const skipped = tutorialSkip(createTutorialMachine(true));
        expect(skipped.isActive).toBe(false);
        expect(skipped.isCompleted).toBe(true);
    });
});
