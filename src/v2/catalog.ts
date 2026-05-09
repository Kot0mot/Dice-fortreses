import type { CustomDieDefinition, DiceFaceEffect } from "./customDie.js";
import type { ResourceId } from "./resources.js";

/** Стартовый куб от ядра-генератора */
export const STARTER_CUBE: CustomDieDefinition = {
    id: "starter_die",
    faces: [
        { resourceId: "steel", amount: 2 },
        { resourceId: "power", amount: 1 },
        { resourceId: "ammo", amount: 1 },
        { resourceId: "ore", amount: 1 },
        { resourceId: "tech_fragment", amount: 1 },
        { effectId: "disable_generator" },
    ],
};

/** Улучшенный стартовый куб (нет негатива, больше ресурсов) */
export const SUPERIOR_STARTER_CUBE: CustomDieDefinition = {
    id: "superior_starter_die",
    faces: [
        { resourceId: "steel", amount: 4 },
        { resourceId: "power", amount: 2 },
        { resourceId: "ammo", amount: 2 },
        { resourceId: "ore", amount: 2 },
        { resourceId: "tech_fragment", amount: 2 },
        { resourceId: "steel", amount: 3 },
    ],
};

export const DICE_TEMPLATES: Map<string, CustomDieDefinition> = new Map([
    [STARTER_CUBE.id, STARTER_CUBE],
    [SUPERIOR_STARTER_CUBE.id, SUPERIOR_STARTER_CUBE],
]);

export interface BuildingDefContribution {
    readonly templateId: string;
    readonly count: number;
}

export type BuildingKind =
    | "core_generator"
    | "generator"
    | "tech_station"
    | "weapon"
    | "storage"
    | "repair_station";

export interface BuildingDefV2 {
    readonly id: string;
    readonly name: string;
    readonly kind: BuildingKind;
    readonly hp: number;
    readonly weight: number;
    readonly cost: Partial<Record<ResourceId, number>>;
    readonly upgradeCost?: Partial<Record<ResourceId, number>>;
    readonly diceContribution?: readonly BuildingDefContribution[];
    readonly upgradedDiceContribution?: readonly BuildingDefContribution[];
    readonly ammoPerShot?: number;
    readonly damage?: number;
    readonly reloadTime?: number;
    readonly resourceCapBonus?: Partial<Record<ResourceId, number>>;
    readonly techRequired?: string;
}

export const BUILDING_CATALOG: Record<string, BuildingDefV2> = {
    core_generator: {
        id: "core_generator",
        name: "Ядро-генератор",
        kind: "core_generator",
        hp: 1000,
        weight: 50,
        cost: {},
        upgradeCost: { steel: 50, tech_fragment: 20 },
        diceContribution: [{ templateId: STARTER_CUBE.id, count: 2 }],
        upgradedDiceContribution: [{ templateId: SUPERIOR_STARTER_CUBE.id, count: 2 }],
    },
    steel_foundry: {
        id: "steel_foundry",
        name: "Сталелитейный завод",
        kind: "generator",
        hp: 200,
        weight: 30,
        cost: { ore: 10, power: 5 },
        upgradeCost: { steel: 20, tech_fragment: 10 },
        diceContribution: [{ templateId: "steel_die", count: 1 }],
        upgradedDiceContribution: [{ templateId: "mega_steel_die", count: 1 }],
    },
    machine_gun: {
        id: "machine_gun",
        name: "Пулемет",
        kind: "weapon",
        hp: 100,
        weight: 15,
        cost: { steel: 15, power: 2 },
        ammoPerShot: 1,
        damage: 10,
    },
    cannon: {
        id: "cannon",
        name: "Пушка",
        kind: "weapon",
        hp: 150,
        weight: 40,
        cost: { steel: 25, power: 5 },
        ammoPerShot: 3,
        damage: 50,
        techRequired: "tech_station",
    },
    tech_station: {
        id: "tech_station",
        name: "Тех-станция",
        kind: "tech_station",
        hp: 120,
        weight: 25,
        cost: { steel: 20, power: 10 },
    },
    storage_depot: {
        id: "storage_depot",
        name: "Склад",
        kind: "storage",
        hp: 150,
        weight: 20,
        cost: { steel: 10 },
        resourceCapBonus: { steel: 50, ore: 50, ammo: 20 },
    },
    repair_station: {
        id: "repair_station",
        name: "Ремонтная станция",
        kind: "repair_station",
        hp: 120,
        weight: 15,
        cost: { steel: 10, tech_fragment: 5 },
    }
};

/** Дополнительные шаблоны кубов */
export const ADDITIONAL_DICE: CustomDieDefinition[] = [
    {
        id: "steel_die",
        faces: [
            { resourceId: "steel", amount: 3 },
            { resourceId: "steel", amount: 2 },
            { resourceId: "steel", amount: 2 },
            { resourceId: "ore", amount: 1 },
            { resourceId: "power", amount: 1 },
            { effectId: "disable_generator" },
        ]
    },
    {
        id: "mega_steel_die",
        faces: [
            { resourceId: "steel", amount: 6 },
            { resourceId: "steel", amount: 5 },
            { resourceId: "steel", amount: 4 },
            { resourceId: "steel", amount: 4 },
            { resourceId: "ore", amount: 2 },
            { resourceId: "power", amount: 2 },
        ]
    }
];

ADDITIONAL_DICE.forEach(d => DICE_TEMPLATES.set(d.id, d));
