export type OwnerId = 0 | 1;

/** Типы балок (материалы) */
export type BeamMaterialId = "wood" | "metal" | "armor_plating" | "energy_shield" | "carbon_fiber" | "reinforced_concrete";

export type DamageType = "kinetic" | "energy" | "blast" | "fire" | "emp";

export interface BeamMaterial {
    readonly id: BeamMaterialId;
    readonly name: string;
    readonly hp: number;
    readonly weight: number;
    readonly capacity: number; // Максимальная нагрузка, которую выдерживает
    readonly cost: { resourceId: string; amount: number };
    readonly resistances: Record<DamageType, number>; // Множитель входящего урона (0.5 = 50% защиты)
    readonly flammability: number; // 0 to 1
    readonly conductivity: boolean;
}

export const BEAM_MATERIALS: Record<BeamMaterialId, BeamMaterial> = {
    wood: {
        id: "wood",
        name: "Дерево",
        hp: 50,
        weight: 1,
        capacity: 100,
        cost: { resourceId: "steel", amount: 2 },
        resistances: { kinetic: 1.0, energy: 2.0, blast: 1.5, fire: 2.0, emp: 0 },
        flammability: 0.8,
        conductivity: false,
    },
    metal: {
        id: "metal",
        name: "Металл",
        hp: 150,
        weight: 3,
        capacity: 400,
        cost: { resourceId: "steel", amount: 5 },
        resistances: { kinetic: 1.0, energy: 1.0, blast: 1.0, fire: 0.5, emp: 0.1 },
        flammability: 0.05,
        conductivity: true,
    },
    armor_plating: {
        id: "armor_plating",
        name: "Броня",
        hp: 500,
        weight: 10,
        capacity: 200,
        cost: { resourceId: "steel", amount: 10 },
        resistances: { kinetic: 0.5, energy: 1.5, blast: 0.7, fire: 0.3, emp: 0.2 },
        flammability: 0,
        conductivity: true,
    },
    energy_shield: {
        id: "energy_shield",
        name: "Энергощит",
        hp: 200,
        weight: 0,
        capacity: 100,
        cost: { resourceId: "power", amount: 10 },
        resistances: { kinetic: 2.0, energy: 0.2, blast: 1.0, fire: 0.5, emp: 5.0 },
        flammability: 0,
        conductivity: false,
    },
    carbon_fiber: {
        id: "carbon_fiber",
        name: "Углеволокно",
        hp: 120,
        weight: 0.5,
        capacity: 600,
        cost: { resourceId: "steel", amount: 15 },
        resistances: { kinetic: 0.8, energy: 1.2, blast: 1.2, fire: 1.5, emp: 0 },
        flammability: 0.3,
        conductivity: false,
    },
    reinforced_concrete: {
        id: "reinforced_concrete",
        name: "Железобетон",
        hp: 800,
        weight: 20,
        capacity: 1000,
        cost: { resourceId: "steel", amount: 12 }, // Simplified cost to match interface
        resistances: { kinetic: 0.7, energy: 0.8, blast: 0.4, fire: 0.1, emp: 0 },
        flammability: 0,
        conductivity: false,
    }
};

/** Узел (соединение балок) */
export interface V2Node {
    readonly id: string;
    readonly x: number; // Координаты на сетке
    readonly y: number;
    readonly owner: OwnerId;
    readonly isGround: boolean; // Прикреплен ли к земле
}

/** Балка (связь между узлами) */
export interface V2Beam {
    readonly id: string;
    readonly nodeAId: string;
    readonly nodeBId: string;
    readonly materialId: BeamMaterialId;
    readonly hp: number;
    readonly owner: OwnerId;
    readonly currentLoad: number; // Текущая нагрузка (вес)
    readonly fireLevel: number; // 0 to 100
    readonly isPowered: boolean;
}

/** Здание, установленное на конструкцию */
export interface BuildingInstance {
    readonly id: string;
    readonly defId: string;
    readonly owner: OwnerId;
    readonly nodeIds: readonly string[]; // Узлы, к которым прикреплено здание
    readonly hp: number;
    readonly isOperational: boolean; // Может ли работать
    readonly level: number; // Уровень постройки (1 или 2)
    readonly fireLevel: number;
    readonly workersAssigned: number;
    readonly isPowered: boolean;
    readonly modules: string[]; // e.g., ["heat_sink", "auto_loader"]
}

export type V2Cell = { type: "empty" } | { type: "node"; nodeId: string };
