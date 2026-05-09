import type { ResourceId } from "./resources.js";

/** Одна грань кубика: ресурс и количество. */
export interface DiceFaceYield {
    readonly resourceId: ResourceId;
    readonly amount: number;
}
