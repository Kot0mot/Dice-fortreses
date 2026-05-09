/** Идентификаторы ресурсов v2 (код), отображаемые имена — в CLI/README. */
export type ResourceId =
    | "steel"
    | "power"
    | "ore"
    | "tech_fragment"
    | "alloy"
    | "fuel";

export type ResourceBag = Partial<Record<ResourceId, number>>;
