import type { CustomDieDefinition } from "./customDie.js";

/** Стартовый куб от ядра-генератора: 6 разных ресурсов по 1. */
export const STARTER_CUBE: CustomDieDefinition = {
    id: "starter_die",
    faces: [
        { resourceId: "steel", amount: 1 },
        { resourceId: "power", amount: 1 },
        { resourceId: "ore", amount: 1 },
        { resourceId: "tech_fragment", amount: 1 },
        { resourceId: "alloy", amount: 1 },
        { resourceId: "fuel", amount: 1 },
    ],
};

export const DICE_TEMPLATES: ReadonlyMap<string, CustomDieDefinition> = new Map([
    [STARTER_CUBE.id, STARTER_CUBE],
]);

export interface BuildingDefContribution {
    readonly templateId: string;
    readonly count: number;
}

export interface BuildingDefV2 {
    readonly id: string;
    readonly kind: "core_generator";
    readonly diceContribution: readonly BuildingDefContribution[];
}

export const BUILDING_CORE_GENERATOR: BuildingDefV2 = {
    id: "core_generator",
    kind: "core_generator",
    diceContribution: [
        { templateId: STARTER_CUBE.id, count: 2 },
    ],
};

export const BUILDING_CATALOG: ReadonlyMap<string, BuildingDefV2> = new Map([
    [BUILDING_CORE_GENERATOR.id, BUILDING_CORE_GENERATOR],
]);
