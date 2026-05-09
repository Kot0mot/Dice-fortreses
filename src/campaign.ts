import type { AiDifficulty } from "./ai.js";
import type { V2MatchState } from "./matchState.js";

export interface CampaignStage {
    readonly id: string;
    readonly title: string;
    readonly description: string;
    readonly aiDifficulty: AiDifficulty;
    readonly enemyInitialBuildings?: string[]; // IDs from catalog
    readonly playerInitialResources?: Record<string, number>;
    readonly stageRewardId: string;
}

export const V2_CAMPAIGN_STAGES: CampaignStage[] = [
    {
        id: "stage_1",
        title: "Первое столкновение",
        description: "Ваш первый бой. Враг слаб и не умеет строить сложные защиты.",
        aiDifficulty: "easy",
        stageRewardId: "perk_extra_steel",
    },
    {
        id: "stage_2",
        title: "Укрепленный аванпост",
        description: "Противник научился использовать металл. Вам понадобится больше огневой мощи.",
        aiDifficulty: "medium",
        stageRewardId: "perk_early_tech",
    },
    {
        id: "stage_3",
        title: "Крепость генералов",
        description: "Финальное испытание. Враг вооружен до зубов и использует тяжелую броню.",
        aiDifficulty: "hard",
        stageRewardId: "perk_superior_core",
    }
];

export interface CampaignPerk {
    readonly id: string;
    readonly name: string;
    readonly description: string;
    readonly effect: (state: V2MatchState) => V2MatchState;
}

export const CAMPAIGN_PERKS: Record<string, CampaignPerk> = {
    perk_extra_steel: {
        id: "perk_extra_steel",
        name: "Запасы стали",
        description: "Начинайте каждый бой с +20 стали.",
        effect: (state) => {
            const eco = [...state.economy];
            eco[0] = { ...eco[0], resources: { ...eco[0].resources, steel: (eco[0].resources.steel ?? 0) + 20 } };
            return { ...state, economy: eco as any };
        }
    },
    perk_early_tech: {
        id: "perk_early_tech",
        name: "Инженерный чертеж",
        description: "Тех-станция стоит на 50% дешевле.",
        effect: (state) => state // Logical effect handled during construction check
    }
};

export interface CampaignState {
    currentStageIndex: number;
    unlockedPerks: string[];
}

export function createInitialCampaign(): CampaignState {
    return {
        currentStageIndex: 0,
        unlockedPerks: []
    };
}

/** Получить 3 случайных перка для выбора (для простоты пока возвращаем фиксированные если их мало) */
export function getRandomPerkOptions(count: number = 3): CampaignPerk[] {
    const all = Object.values(CAMPAIGN_PERKS);
    // В MVP просто возвращаем все доступные, если их меньше или равно count
    return all.slice(0, count);
}

/** Применить все разблокированные перки к начальному состоянию матча */
export function applyCampaignPerks(state: V2MatchState, perks: string[]): V2MatchState {
    let curr = state;
    for (const pid of perks) {
        const perk = CAMPAIGN_PERKS[pid];
        if (perk) {
            curr = perk.effect(curr);
        }
    }
    return curr;
}
