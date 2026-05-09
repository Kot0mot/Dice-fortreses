export type OwnerId = 0 | 1;

/** Типы балок (материалы) */
export type BeamMaterialId = "wood" | "metal" | "armor_plating";

export interface BeamMaterial {
    readonly id: BeamMaterialId;
    readonly name: string;
    readonly hp: number;
    readonly weight: number;
    readonly capacity: number; // Максимальная нагрузка, которую выдерживает
    readonly cost: { resourceId: string; amount: number };
}

export const BEAM_MATERIALS: Record<BeamMaterialId, BeamMaterial> = {
    wood: {
        id: "wood",
        name: "Дерево",
        hp: 50,
        weight: 1,
        capacity: 100,
        cost: { resourceId: "steel", amount: 2 }, // Условно используем сталь как основной ресурс стройки пока
    },
    metal: {
        id: "metal",
        name: "Металл",
        hp: 150,
        weight: 3,
        capacity: 400,
        cost: { resourceId: "steel", amount: 5 },
    },
    armor_plating: {
        id: "armor_plating",
        name: "Броня",
        hp: 500,
        weight: 10,
        capacity: 200, // Тяжелая, но сама держит меньше, чем металл (нужна опора)
        cost: { resourceId: "alloy", amount: 10 },
    },
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
}

/** Здание, установленное на конструкцию */
export interface BuildingInstance {
    readonly id: string;
    readonly defId: string;
    readonly owner: OwnerId;
    readonly nodeIds: readonly string[]; // Узлы, к которым прикреплено здание
    readonly hp: number;
    readonly isOperational: boolean; // Может ли работать (не выведено ли из строя негативной гранью)
}

export type V2Cell = { type: "empty" } | { type: "node"; nodeId: string };
