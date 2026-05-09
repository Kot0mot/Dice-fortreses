export type OwnerId = 0 | 1;

export interface BuildingInstance {
    readonly id: string;
    readonly defId: string;
    readonly owner: OwnerId;
    readonly x: number;
    readonly y: number;
}

export type V2Cell = { type: "empty" } | { type: "building"; instanceId: string };
