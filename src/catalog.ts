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

import type { DamageType } from "./mapTypes.js";

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
    readonly damageType?: DamageType;
    readonly reloadTime?: number;
    readonly resourceCapBonus?: Partial<Record<ResourceId, number>>;
    readonly techRequired?: string;
    readonly powerRequired?: number;
    readonly workersRequired?: number;
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
    power_plant: {
        id: "power_plant",
        name: "Электростанция",
        kind: "generator",
        hp: 150,
        weight: 25,
        cost: { steel: 20, ore: 10 },
        upgradeCost: { steel: 30, tech_fragment: 15 },
        diceContribution: [{ templateId: "power_die", count: 1 }],
        upgradedDiceContribution: [{ templateId: "mega_power_die", count: 1 }],
    },
    ammo_factory: {
        id: "ammo_factory",
        name: "Завод БК",
        kind: "generator",
        hp: 180,
        weight: 30,
        cost: { steel: 20, ore: 15 },
        upgradeCost: { steel: 35, tech_fragment: 20 },
        diceContribution: [{ templateId: "ammo_die", count: 1 }],
        upgradedDiceContribution: [{ templateId: "mega_ammo_die", count: 1 }],
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
        damageType: "kinetic",
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
        damageType: "blast",
        techRequired: "tech_station",
    },
    laser_turret: {
        id: "laser_turret",
        name: "Лазер",
        kind: "weapon",
        hp: 120,
        weight: 30,
        cost: { steel: 30, power: 15 },
        ammoPerShot: 5,
        damage: 40,
        damageType: "energy",
        techRequired: "tech_station",
        powerRequired: 10,
        workersRequired: 1,
    },
    emp_launcher: {
        id: "emp_launcher",
        name: "ЭМИ-установка",
        kind: "weapon",
        hp: 100,
        weight: 25,
        cost: { steel: 40, power: 30 },
        ammoPerShot: 2,
        damage: 5,
        damageType: "emp",
        techRequired: "tech_station",
        powerRequired: 20,
        workersRequired: 2,
    },
    flak_cannon: {
        id: "flak_cannon",
        name: "Зенитка (Флак)",
        kind: "weapon",
        hp: 200,
        weight: 45,
        cost: { steel: 50, ammo: 20 },
        ammoPerShot: 5,
        damage: 15,
        damageType: "blast",
        workersRequired: 3,
    },
    railgun: {
        id: "railgun",
        name: "Рельсотрон",
        kind: "weapon",
        hp: 300,
        weight: 80,
        cost: { steel: 100, power: 50, tech_fragment: 30 },
        ammoPerShot: 10,
        damage: 150,
        damageType: "kinetic",
        techRequired: "tech_station",
        powerRequired: 50,
        workersRequired: 4,
    },
    tech_station: {
        id: "tech_station",
        name: "Тех-станция",
        kind: "tech_station",
        hp: 120,
        weight: 25,
        cost: { steel: 20, power: 10 },
        workersRequired: 1,
    },
    storage_steel: {
        id: "storage_steel",
        name: "Склад стали",
        kind: "storage",
        hp: 150,
        weight: 20,
        cost: { steel: 10 },
        resourceCapBonus: { steel: 100 },
    },
    storage_ammo: {
        id: "storage_ammo",
        name: "Склад БК",
        kind: "storage",
        hp: 150,
        weight: 20,
        cost: { steel: 10 },
        resourceCapBonus: { ammo: 50 },
    },
    storage_power: {
        id: "storage_power",
        name: "Батарея",
        kind: "storage",
        hp: 100,
        weight: 15,
        cost: { steel: 10, ore: 5 },
        resourceCapBonus: { power: 50 },
        techRequired: "power_plant",
    },
    foundry_upgrade: {
        id: "foundry_upgrade",
        name: "Доменная печь",
        kind: "tech_station",
        hp: 200,
        weight: 40,
        cost: { steel: 60, tech_fragment: 15 },
        workersRequired: 2,
    },
    advanced_foundry: {
        id: "advanced_foundry",
        name: "Алле-завод",
        kind: "generator",
        hp: 300,
        weight: 50,
        cost: { steel: 80, power: 40 },
        diceContribution: [{ templateId: "mega_steel_die", count: 1 }],
        techRequired: "foundry_upgrade",
        workersRequired: 4,
    },
    repair_station: {
        id: "repair_station",
        name: "Ремонтная станция",
        kind: "repair_station",
        hp: 120,
        weight: 15,
        cost: { steel: 10, tech_fragment: 5 },
    },
    shield_generator: {
        id: "shield_generator",
        name: "Генератор поля",
        kind: "tech_station",
        hp: 100,
        weight: 40,
        cost: { steel: 50, power: 100, tech_fragment: 20 },
        powerRequired: 40,
        workersRequired: 2,
    },
    solar_panel: {
        id: "solar_panel",
        name: "Солнечная панель",
        kind: "generator",
        hp: 50,
        weight: 5,
        cost: { steel: 10, tech_fragment: 5 },
        diceContribution: [{ templateId: "power_die", count: 1 }],
    },
    fire_suppressor: {
        id: "fire_suppressor",
        name: "Пожаротушитель",
        kind: "tech_station",
        hp: 100,
        weight: 15,
        cost: { steel: 20, power: 10 },
        powerRequired: 5,
        workersRequired: 1,
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
    },
    {
        id: "power_die",
        faces: [
            { resourceId: "power", amount: 2 },
            { resourceId: "power", amount: 2 },
            { resourceId: "power", amount: 1 },
            { resourceId: "steel", amount: 1 },
            { resourceId: "tech_fragment", amount: 1 },
            { effectId: "disable_generator" },
        ]
    },
    {
        id: "mega_power_die",
        faces: [
            { resourceId: "power", amount: 4 },
            { resourceId: "power", amount: 4 },
            { resourceId: "power", amount: 3 },
            { resourceId: "power", amount: 3 },
            { resourceId: "steel", amount: 2 },
            { resourceId: "power", amount: 2 },
        ]
    },
    {
        id: "ammo_die",
        faces: [
            { resourceId: "ammo", amount: 3 },
            { resourceId: "ammo", amount: 2 },
            { resourceId: "ammo", amount: 2 },
            { resourceId: "ore", amount: 1 },
            { effectId: "worker_gain" },
            { effectId: "disable_generator" },
        ]
    },
    {
        id: "mega_ammo_die",
        faces: [
            { resourceId: "ammo", amount: 6 },
            { resourceId: "ammo", amount: 5 },
            { resourceId: "ammo", amount: 4 },
            { resourceId: "ammo", amount: 4 },
            { resourceId: "steel", amount: 2 },
            { resourceId: "ammo", amount: 2 },
        ]
    }
];

ADDITIONAL_DICE.forEach(d => DICE_TEMPLATES.set(d.id, d));
