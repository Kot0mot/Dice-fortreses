export type TutorialStepId = "roll" | "slots" | "build" | "arm" | "end";

export interface TutorialStep {
    id: TutorialStepId;
    title: string;
    text: string;
    phase: TutorialStepId;
    highlightTarget: string;
}

export const TUTORIAL_STEPS: readonly TutorialStep[] = [
    {
        id: "roll",
        title: "Roll",
        text: "Брось кубы и при желании сделай один реролл, чтобы улучшить руку.",
        phase: "roll",
        highlightTarget: "roll",
    },
    {
        id: "slots",
        title: "Slots",
        text: "Разложи кубы по слотам Build / Fortify / Arm и зафиксируй выбор.",
        phase: "slots",
        highlightTarget: "slots",
    },
    {
        id: "build",
        title: "Build",
        text: "Трать Build points на новые блоки и ремонт существующих.",
        phase: "build",
        highlightTarget: "build",
    },
    {
        id: "arm",
        title: "Arm",
        text: "Выбери колонку и нанеси урон по вражеским клеткам сверху вниз.",
        phase: "arm",
        highlightTarget: "arm",
    },
    {
        id: "end",
        title: "End Turn",
        text: "Заверши ход, чтобы сохранить Fortify-заряды и передать ход сопернику.",
        phase: "end",
        highlightTarget: "status",
    },
] as const;

export interface TutorialMachineState {
    stepIndex: number;
    isActive: boolean;
    isCompleted: boolean;
}

export function createTutorialMachine(enabled: boolean): TutorialMachineState {
    return {
        stepIndex: 0,
        isActive: enabled,
        isCompleted: false,
    };
}

export function currentTutorialStep(state: TutorialMachineState): TutorialStep | null {
    if (!state.isActive) return null;
    return TUTORIAL_STEPS[state.stepIndex] ?? null;
}

export function tutorialNext(state: TutorialMachineState): TutorialMachineState {
    if (!state.isActive) return state;
    const lastIndex = TUTORIAL_STEPS.length - 1;
    if (state.stepIndex >= lastIndex) {
        return {
            ...state,
            isActive: false,
            isCompleted: true,
        };
    }
    return {
        ...state,
        stepIndex: state.stepIndex + 1,
    };
}

export function tutorialSkip(state: TutorialMachineState): TutorialMachineState {
    if (!state.isActive) return state;
    return {
        ...state,
        isActive: false,
        isCompleted: true,
    };
}

export function tutorialReset(enabled: boolean): TutorialMachineState {
    return createTutorialMachine(enabled);
}
