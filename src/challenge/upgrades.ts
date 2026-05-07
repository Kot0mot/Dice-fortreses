import type { Rng } from "../types.js";
import {
    createEmptyModifiers,
    type ActiveUpgrade,
    type ChallengeRunState,
    type ChallengeUpgradeDefinition,
    type RuntimeModifiers,
} from "./types.js";

export const UPGRADE_POOL: readonly ChallengeUpgradeDefinition[] = [
    {
        id: "core_hp_plus_1",
        name: "Reinforced Core",
        description: "+1 max HP of your core (up to +3).",
        maxStacks: 3,
        apply: (mods) => ({ ...mods, coreHpBonus: Math.min(3, mods.coreHpBonus + 1) }),
    },
    {
        id: "fortify_plus_1",
        name: "Shield Capacitors",
        description: "+1 fortify charge each turn.",
        maxStacks: 2,
        apply: (mods) => ({ ...mods, startFortifyBonus: Math.min(2, mods.startFortifyBonus + 1) }),
    },
    {
        id: "free_repair_1",
        name: "Nanobots",
        description: "1 free repair point each turn.",
        maxStacks: 1,
        apply: (mods) => ({ ...mods, freeRepairPerTurn: 1 }),
    },
    {
        id: "reroll_plus_1",
        name: "Loaded Dice",
        description: "+1 reroll each turn (up to +2).",
        maxStacks: 2,
        apply: (mods) => ({ ...mods, rerollsPerTurnBonus: Math.min(2, mods.rerollsPerTurnBonus + 1) }),
    },
    {
        id: "arm_six_damage_plus_1",
        name: "Overcharged Barrel",
        description: "Arm shots with max=6 deal +1 damage.",
        maxStacks: 2,
        apply: (mods) => ({ ...mods, armDamageOnSixBonus: Math.min(2, mods.armDamageOnSixBonus + 1) }),
    },
    {
        id: "pierce_plus_1",
        name: "Drill Shell",
        description: "+1 pierce depth (up to +2).",
        maxStacks: 2,
        apply: (mods) => ({ ...mods, pierceDepthBonus: Math.min(2, mods.pierceDepthBonus + 1) }),
    },
    {
        id: "insurance_core_minus_1",
        name: "Core Insurance",
        description: "First incoming core hit each match is reduced by 1.",
        maxStacks: 1,
        apply: (mods) => ({ ...mods, firstCoreHitDamageReduction: 1 }),
    },
    {
        id: "hybrid_shield",
        name: "Hybrid Plating",
        description: "+1 core HP and +1 start fortify.",
        maxStacks: 1,
        apply: (mods) => ({
            ...mods,
            coreHpBonus: Math.min(3, mods.coreHpBonus + 1),
            startFortifyBonus: Math.min(2, mods.startFortifyBonus + 1),
        }),
    },
];

function currentStacks(state: ChallengeRunState, id: string): number {
    return state.activeUpgrades.find((u) => u.id === id)?.stacks ?? 0;
}

function availablePool(state: ChallengeRunState): ChallengeUpgradeDefinition[] {
    return UPGRADE_POOL.filter((upg) => currentStacks(state, upg.id) < upg.maxStacks);
}

export function drawUpgradeChoices(state: ChallengeRunState, rng: Rng, count = 3): ChallengeUpgradeDefinition[] {
    const pool = availablePool(state);
    const out: ChallengeUpgradeDefinition[] = [];
    const mutable = [...pool];
    while (out.length < count && mutable.length > 0) {
        const idx = rng.nextInt(0, mutable.length - 1);
        const [picked] = mutable.splice(idx, 1);
        if (picked) out.push(picked);
    }
    return out;
}

export function applyUpgrade(mods: RuntimeModifiers, id: string): RuntimeModifiers {
    const upgrade = UPGRADE_POOL.find((u) => u.id === id);
    if (!upgrade) return mods;
    return upgrade.apply(mods);
}

export function applyUpgradeToRun(state: ChallengeRunState, id: string): ChallengeRunState {
    const upgrade = UPGRADE_POOL.find((u) => u.id === id);
    if (!upgrade) return state;

    const nextPlayerMods = upgrade.apply(state.playerModifiers);
    const existing = state.activeUpgrades.find((u) => u.id === id);
    const activeUpgrades: ActiveUpgrade[] = existing
        ? state.activeUpgrades.map((u) => (u.id === id ? { ...u, stacks: u.stacks + 1 } : u))
        : [...state.activeUpgrades, { id, name: upgrade.name, stacks: 1 }];

    return { ...state, playerModifiers: nextPlayerMods, activeUpgrades };
}

export function createBasePlayerModifiers(): RuntimeModifiers {
    return createEmptyModifiers();
}
