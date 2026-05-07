import { createEmptyModifiers, type StageAiPreset } from "./types.js";

function withBonuses(
    base: ReturnType<typeof createEmptyModifiers>,
    patch: Partial<ReturnType<typeof createEmptyModifiers>>
) {
    return { ...base, ...patch };
}

export function getStageAiPreset(stage: number): StageAiPreset {
    if (stage <= 1) {
        return {
            stage,
            label: "Balanced baseline",
            bot: "balanced",
            modifiers: createEmptyModifiers(),
            rerollThresholdBonus: 0,
        };
    }
    if (stage === 2) {
        return {
            stage,
            label: "Tank/Aggro mix",
            bot: "tank",
            modifiers: withBonuses(createEmptyModifiers(), {
                coreHpBonus: 1,
                startFortifyBonus: 1,
            }),
            rerollThresholdBonus: 0,
        };
    }
    return {
        stage,
        label: "Aggressive scaling",
        bot: "aggro",
        modifiers: withBonuses(createEmptyModifiers(), {
            coreHpBonus: 2,
            startFortifyBonus: 1,
            rerollsPerTurnBonus: 1,
            armDamageOnSixBonus: 1,
        }),
        rerollThresholdBonus: 1,
    };
}
