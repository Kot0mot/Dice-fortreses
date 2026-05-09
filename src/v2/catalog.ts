import type { CustomDieDefinition } from "./customDie.js";
import type { ResourceId } from "./resources.js";

/** Расширенные типы граней */
export interface DiceFaceEffect {
    readonly resourceId?: ResourceId;
    readonly amount?: number;
    readonly effectId?: "disable_generator" | "repair_boost" | "extra_reroll";
}

/** Стартовый куб от ядра-генератора */
export const STARTER_CUBE: CustomDieDefinition = {
    id: "starter_die",
    faces: [
        { resourceId: "steel", amount: 2 },
        { resourceId: "power", amount: 1 },
        { resourceId: "ammo", amount: 1 },
        { resourceId: "ore", amount: 1 },
        { resourceId: "tech_fragment", amount: 1 },
        { effectId: "disable_generator" }, // Негативный эффект
    ],
};

export const DICE_TEMPLATES: Map<string, CustomDieDefinition> = new Map([
    [STARTER_CUBE.id, STARTER_CUBE],
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
    readonly cost: Partial<Record<ResourceId, number>>;
    readonly diceContribution?: readonly BuildingDefContribution[];
    readonly ammoPerShot?: number; // Для оружия
    readonly damage?: number;
    readonly reloadTime?: number;
    readonly resourceCapBonus?: Partial<Record<ResourceId, number>>; // Для хранилищ
    readonly techRequired?: string;
}

export const BUILDING_CATALOG: Record<string, BuildingDefV2> = {
    core_generator: {
        id: "core_generator",
        name: "Ядро-генератор",
        kind: "core_generator",
        hp: 1000,
        cost: {},
        diceContribution: [{ templateId: STARTER_CUBE.id, count: 2 }],
    },
    steel_foundry: {
        id: "steel_foundry",
        name: "Сталелитейный завод",
        kind: "generator",
        hp: 200,
        cost: { ore: 10, power: 5 },
        diceContribution: [{ templateId: "steel_die", count: 1 }],
    },
    machine_gun: {
        id: "machine_gun",
        name: "Пулемет",
        kind: "weapon",
        hp: 100,
        cost: { steel: 15, power: 2 },
        ammoPerShot: 1,
        damage: 10,
    },
    cannon: {
        id: "cannon",
        name: "Пушка",
        kind: "weapon",
        hp: 150,
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
        cost: { steel: 20, power: 10 },
    },
    storage_depot: {
        id: "storage_depot",
        name: "Склад",
        kind: "storage",
        hp: 150,
        cost: { steel: 10 },
        resourceCapBonus: { steel: 50, ore: 50, ammo: 20 },
    },
    repair_station: {
        id: "repair_station",
        name: "Ремонтная станция",
        kind: "repair_station",
        hp: 120,
        cost: { steel: 10, tech_fragment: 5 },
    }
};

/** Дополнительные шаблоны кубов (для заводов) */
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
    }
];

ADDITIONAL_DICE.forEach(d => (DICE_TEMPLATES as Map<string, CustomDieDefinition>).set(d.id, d));
