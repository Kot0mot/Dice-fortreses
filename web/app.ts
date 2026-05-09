import {
    advanceCurrentPlayer,
    applyArmColumnAttack,
    applyBuildCommand,
    applyHandReroll,
    endTurnUpdateFortify,
    initializeTurnRerolls,
    validateBuildCommand,
    type BuildCommand,
} from "../src/game.js";
import { DiceFortsRng } from "../src/random.js";
import { isValidSlotPartition, resolveDiceFortsSlots, rollDiceFortsHand } from "../src/rules.js";
import { deserializeSavedRun, RUN_SAVE_FORMAT_VERSION, serializeSavedRun, type SavedRunFile } from "../src/runSave.js";
import { createInitialMatchState, opponentOf, patchPlayerSecrets, type MatchState, type PlayerId } from "../src/state.js";
import {
    TelemetryLiteSession,
    createPlaytestSessionId,
    playtestReportToCsv,
    validateFeedback,
    validateFeedbackRating,
    type PlaytestFeedback,
} from "../src/telemetry.js";
import type { DiceFortsSlotResolution } from "../src/types.js";
import { claimBotTurnLock, isUiLockedForBotTurn, runBotTurn, type GameMode } from "./bot-turn.js";
import type { BotDifficulty } from "./bot/types.js";
import {
    canRunUiPhaseAction,
    filterUiLogEntries,
    getArmTargets,
    getBuildTargets,
    getRepairTargets,
    parseColumn,
    slotsFromAssignments,
    type SlotName,
    type UiLogCategory,
    type UiLogEntry,
} from "./ui-helpers.js";
import {
    createTutorialMachine,
    currentTutorialStep,
    tutorialNext,
    tutorialSkip,
    type TutorialMachineState,
} from "./tutorial.js";
import { RU } from "./i18n/ru.js";
import { mountV2Sandbox } from "./v2-sandbox-ui.js";

type UiPhase = "roll" | "slots" | "build" | "arm" | "end";
type Screen = "menu" | "tutorial" | "game" | "v2sandbox";

interface UiState {
    round: number;
    match: MatchState;
    phase: UiPhase;
    hand: number[];
    slotAssignments: SlotName[];
    slotResolution: DiceFortsSlotResolution | null;
    buildBudgetLeft: number;
    selectedBuildSpend: number;
    repairUsed: Record<string, number>;
    lastMessage: string;
    gameMode: GameMode;
    botDifficulty: BotDifficulty;
    isBotActing: boolean;
}

interface AppState {
    screen: Screen;
    gameMode: GameMode;
    isModeSelected: boolean;
    seed: number | null;
    soundEnabled: boolean;
    tutorialEnabled: boolean;
    botDifficulty: BotDifficulty;
}

interface MatchStats {
    coreDamageByPlayer: Record<PlayerId, number>;
    rerollsUsedByPlayer: Record<PlayerId, number>;
}

const menuScreenEl = requireElement("menu-screen");
const tutorialScreenEl = requireElement("tutorial-screen");
const v2SandboxScreenEl = requireElement("v2-sandbox-screen");
const v2SandboxRootEl = requireElement("v2-sandbox-root");
const gameScreenEl = requireElement("game-screen");
const menuModeVsBotEl = requireElement("menu-mode-vsbot");
const menuModeHotseatEl = requireElement("menu-mode-hotseat");
const menuHowToPlayEl = requireElement("menu-how-to-play");
const menuV2SandboxEl = requireElement("menu-v2-sandbox");
const menuSeedInputEl = requireInputElement("menu-seed-input");
const menuSoundToggleEl = requireInputElement("menu-sound-toggle");
const menuBotDifficultyRowEl = requireElement("menu-bot-difficulty-row");
const menuBotDifficultySelectEl = requireElement("menu-bot-difficulty") as HTMLSelectElement;
const menuStartGameEl = requireElement("menu-start-game");
const tutorialBackEl = requireElement("tutorial-back");
const tutorialPracticeEl = requireElement("tutorial-practice");
const topBarModeEl = requireElement("topbar-mode");
const topBarRoundEl = requireElement("topbar-round");
const topBarPlayerEl = requireElement("topbar-player");
const backToMenuEl = requireElement("back-to-menu");

const statusEl = requireElement("status");
const nextActionEl = requireElement("next-action");
const rollPanelEl = requireElement("roll-panel");
const slotsPanelEl = requireElement("slots-panel");
const buildPanelEl = requireElement("build-panel");
const armPanelEl = requireElement("arm-panel");
const boardLegendEl = requireElement("board-legend");
const boardEl = requireElement("board");
const logControlsEl = requireElement("log-controls");
const logListEl = requireElement("log-list");
const runControlsEl = requireElement("run-controls");
const loadRunInputEl = requireInputElement("load-run-input");
const noticeEl = requireElement("notice");
const endgameOverlayEl = requireElement("endgame-overlay");
const endgameTitleEl = requireElement("endgame-title");
const endgameStatsEl = requireElement("endgame-stats");
const playAgainBtnEl = requireElement("play-again-btn");
const endBackToMenuBtnEl = requireElement("end-back-to-menu-btn");
const tutorialOverlayEl = requireElement("tutorial-overlay");
const MAX_LOG_EVENTS = 200;
const DISPLAY_LOG_EVENTS = 30;
const NOTICE_TIMEOUT_MS = 1600;
const CELL_FLASH_TIMEOUT_MS = 1000;
const TUTORIAL_STORAGE_KEY = "dice-fortresses.tutorial-enabled";
const BOT_DIFFICULTY_STORAGE_KEY = "dice-fortresses.bot-difficulty";
const isPlaytestMode = new URLSearchParams(window.location.search).get("playtest") === "1";
const playtestSession = isPlaytestMode ? new TelemetryLiteSession(createPlaytestSessionId()) : null;
let playtestExported = false;

const uiLogFilters: Record<UiLogCategory, boolean> = {
    dice: true,
    build: true,
    combat: true,
    system: true,
};
let uiLogEntries: UiLogEntry[] = [];
let noticeTimeout: number | null = null;
let changedCellTimeout: number | null = null;
const changedCells = new Set<string>();
let matchStats = createMatchStats();
let v2SandboxUnmount: (() => void) | null = null;

const initialSeed = Math.floor(Date.now());
let runSeed = initialSeed;
let rng = new DiceFortsRng(initialSeed);
const appState: AppState = {
    screen: "menu",
    gameMode: "hotseat",
    isModeSelected: false,
    seed: null,
    soundEnabled: true,
    tutorialEnabled: readTutorialEnabled(),
    botDifficulty: readBotDifficulty(),
};
let tutorialState: TutorialMachineState = createTutorialMachine(appState.tutorialEnabled);
let ui: UiState = {
    round: 1,
    match: createInitialMatchState(),
    phase: "roll",
    hand: [],
    slotAssignments: [],
    slotResolution: null,
    buildBudgetLeft: 0,
    selectedBuildSpend: 1,
    repairUsed: {},
    lastMessage: RU.appReady,
    gameMode: appState.gameMode,
    botDifficulty: appState.botDifficulty,
    isBotActing: false,
};
const BOT_DELAY_MS = 220;

setupRunControls();
setupLogControls();
setupMenuControls();
syncScreenVisibility();
if (isPlaytestMode) {
    playtestSession?.sessionStarted();
    showPlaytestOnboarding();
}

function requireElement(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) {
        throw new Error(`Missing element #${id}`);
    }
    return el;
}

function requireInputElement(id: string): HTMLInputElement {
    const el = document.getElementById(id);
    if (!(el instanceof HTMLInputElement)) {
        throw new Error(`Missing input element #${id}`);
    }
    return el;
}

function readTutorialEnabled(): boolean {
    const raw = window.localStorage.getItem(TUTORIAL_STORAGE_KEY);
    if (raw === "0") return false;
    return true;
}

function persistTutorialEnabled(enabled: boolean): void {
    window.localStorage.setItem(TUTORIAL_STORAGE_KEY, enabled ? "1" : "0");
}

function readBotDifficulty(): BotDifficulty {
    const raw = window.localStorage.getItem(BOT_DIFFICULTY_STORAGE_KEY);
    if (raw === "easy" || raw === "medium" || raw === "hard") {
        return raw;
    }
    return "medium";
}

function persistBotDifficulty(difficulty: BotDifficulty): void {
    window.localStorage.setItem(BOT_DIFFICULTY_STORAGE_KEY, difficulty);
}

function setupRunControls(): void {
    runControlsEl.innerHTML = "";
    const playtestToggleBtn = button(
        isPlaytestMode ? RU.playtestModeOff : RU.playtestModeOn,
        () => {
            const url = new URL(window.location.href);
            if (isPlaytestMode) {
                url.searchParams.delete("playtest");
            } else {
                url.searchParams.set("playtest", "1");
            }
            window.location.href = url.toString();
        },
        false
    );
    const tutorialToggleWrap = document.createElement("label");
    tutorialToggleWrap.className = "log-filter";
    tutorialToggleWrap.textContent = `${RU.tutorialLabel} `;
    const tutorialToggle = document.createElement("input");
    tutorialToggle.type = "checkbox";
    tutorialToggle.checked = appState.tutorialEnabled;
    tutorialToggle.addEventListener("change", () => {
        appState.tutorialEnabled = tutorialToggle.checked;
        persistTutorialEnabled(appState.tutorialEnabled);
        if (!appState.tutorialEnabled) {
            tutorialState = tutorialSkip(tutorialState);
        } else if (appState.screen === "game") {
            tutorialState = createTutorialMachine(true);
        }
        render();
    });
    tutorialToggleWrap.appendChild(tutorialToggle);
    runControlsEl.append(
        playtestToggleBtn,
        tutorialToggleWrap,
        button(RU.saveRun, saveRunToFile, false),
        button(RU.loadRun, () => loadRunInputEl.click(), false)
    );
    loadRunInputEl.addEventListener("change", async () => {
        const file = loadRunInputEl.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            loadRunFromText(text);
        } catch {
            ui.lastMessage = RU.loadFailedRead;
            render();
        } finally {
            loadRunInputEl.value = "";
        }
    });
}

function setupMenuControls(): void {
    menuModeVsBotEl.addEventListener("click", () => {
        appState.gameMode = "vsBot";
        appState.isModeSelected = true;
        updateMenuSelection();
    });
    menuModeHotseatEl.addEventListener("click", () => {
        appState.gameMode = "hotseat";
        appState.isModeSelected = true;
        updateMenuSelection();
    });
    menuHowToPlayEl.addEventListener("click", () => {
        appState.screen = "tutorial";
        syncScreenVisibility();
    });
    menuV2SandboxEl.addEventListener("click", () => {
        appState.screen = "v2sandbox";
        syncScreenVisibility();
    });
    tutorialBackEl.addEventListener("click", () => {
        appState.screen = "menu";
        syncScreenVisibility();
    });
    tutorialPracticeEl.addEventListener("click", () => {
        appState.gameMode = "vsBot";
        appState.isModeSelected = true;
        updateMenuSelection();
        startNewGame();
    });
    menuSeedInputEl.addEventListener("change", () => {
        const raw = menuSeedInputEl.value.trim();
        if (raw === "") {
            appState.seed = null;
            return;
        }
        const parsed = Number(raw);
        appState.seed = Number.isInteger(parsed) ? parsed : null;
    });
    menuSoundToggleEl.addEventListener("change", () => {
        appState.soundEnabled = menuSoundToggleEl.checked;
    });
    menuBotDifficultySelectEl.value = appState.botDifficulty;
    menuBotDifficultySelectEl.addEventListener("change", () => {
        const value = menuBotDifficultySelectEl.value;
        if (value === "easy" || value === "medium" || value === "hard") {
            appState.botDifficulty = value;
            persistBotDifficulty(value);
            updateMenuSelection();
        }
    });
    menuStartGameEl.addEventListener("click", () => {
        if (!appState.isModeSelected) return;
        startNewGame();
    });
    backToMenuEl.addEventListener("click", () => {
        if (!window.confirm(RU.confirmBackToMenu)) return;
        appState.screen = "menu";
        ui.isBotActing = false;
        hideEndgameOverlay();
        syncScreenVisibility();
    });
    playAgainBtnEl.addEventListener("click", () => {
        hideEndgameOverlay();
        startNewGame();
    });
    endBackToMenuBtnEl.addEventListener("click", () => {
        hideEndgameOverlay();
        appState.screen = "menu";
        syncScreenVisibility();
    });
    updateMenuSelection();
}

function updateMenuSelection(): void {
    menuModeVsBotEl.classList.toggle("selected", appState.isModeSelected && appState.gameMode === "vsBot");
    menuModeHotseatEl.classList.toggle("selected", appState.isModeSelected && appState.gameMode === "hotseat");
    menuBotDifficultyRowEl.toggleAttribute("hidden", appState.gameMode !== "vsBot");
    menuBotDifficultySelectEl.disabled = appState.gameMode !== "vsBot";
    menuStartGameEl.toggleAttribute("disabled", !appState.isModeSelected);
}

function syncScreenVisibility(): void {
    menuScreenEl.classList.toggle("hidden", appState.screen !== "menu");
    tutorialScreenEl.classList.toggle("hidden", appState.screen !== "tutorial");
    v2SandboxScreenEl.classList.toggle("hidden", appState.screen !== "v2sandbox");
    gameScreenEl.classList.toggle("hidden", appState.screen !== "game");

    if (appState.screen === "v2sandbox") {
        v2SandboxUnmount?.();
        const chosenSeed = appState.seed ?? Math.floor(Date.now());
        v2SandboxUnmount = mountV2Sandbox(v2SandboxRootEl, {
            seed: chosenSeed,
            onBack: () => {
                v2SandboxUnmount?.();
                v2SandboxUnmount = null;
                appState.screen = "menu";
                syncScreenVisibility();
            },
        });
    } else {
        v2SandboxUnmount?.();
        v2SandboxUnmount = null;
    }

    if (appState.screen === "game") {
        render();
    }
}

function startNewGame(): void {
    const chosenSeed = appState.seed ?? Math.floor(Date.now());
    runSeed = chosenSeed;
    rng = new DiceFortsRng(chosenSeed);
    matchStats = createMatchStats();
    changedCells.clear();
    hideNotice();
    ui = {
        round: 1,
        match: createInitialMatchState(),
        phase: "roll",
        hand: [],
        slotAssignments: [],
        slotResolution: null,
        buildBudgetLeft: 0,
        selectedBuildSpend: 1,
        repairUsed: {},
        lastMessage: RU.newMatchStarted(chosenSeed),
        gameMode: appState.gameMode,
        botDifficulty: appState.botDifficulty,
        isBotActing: false,
    };
    tutorialState = createTutorialMachine(appState.tutorialEnabled);
    addUiLog("system", ui.lastMessage);
    appState.screen = "game";
    syncScreenVisibility();
    startTurn();
}

function setupLogControls(): void {
    logControlsEl.innerHTML = "";
    const filterWrap = document.createElement("div");
    filterWrap.className = "log-filters";
    const categories: UiLogCategory[] = ["dice", "build", "combat", "system"];
    for (const category of categories) {
        const label = document.createElement("label");
        label.className = "log-filter";
        const input = document.createElement("input");
        input.type = "checkbox";
        input.checked = uiLogFilters[category];
        input.addEventListener("change", () => {
            uiLogFilters[category] = input.checked;
            renderLogPanel();
        });
        label.append(input, document.createTextNode(RU.logCategory(category)));
        filterWrap.appendChild(label);
    }
    const clearBtn = button(RU.logClear, () => {
        uiLogEntries = [];
        renderLogPanel();
    }, false);
    logControlsEl.append(filterWrap, clearBtn);
}

function addUiLog(category: UiLogCategory, message: string): void {
    uiLogEntries.push({
        ts: Date.now(),
        turn: ui.round,
        playerId: ui.match.currentPlayer,
        category,
        message,
    });
    if (uiLogEntries.length > MAX_LOG_EVENTS) {
        uiLogEntries = uiLogEntries.slice(uiLogEntries.length - MAX_LOG_EVENTS);
    }
}

function saveRunToFile(): void {
    const payload: SavedRunFile = {
        formatVersion: RUN_SAVE_FORMAT_VERSION,
        seed: runSeed,
        rngState: rng.getState(),
        uiState: {
            round: ui.round,
            phase: ui.phase,
            hand: [...ui.hand],
            slotAssignments: [...ui.slotAssignments],
            slotResolution: ui.slotResolution ? { ...ui.slotResolution } : null,
            buildBudgetLeft: ui.buildBudgetLeft,
            repairUsed: { ...ui.repairUsed },
            lastMessage: ui.lastMessage,
            gameMode: ui.gameMode,
            isBotActing: ui.isBotActing,
        },
        matchState: ui.match,
        log: [ui.lastMessage],
    };
    const blob = new Blob([serializeSavedRun(payload)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dice-fortresses-run-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
    ui.lastMessage = RU.runSaved;
    addUiLog("system", ui.lastMessage);
    render();
}

function loadRunFromText(raw: string): void {
    try {
        const saved = deserializeSavedRun(raw);
        runSeed = saved.seed;
        rng = new DiceFortsRng(saved.seed);
        rng.setState(saved.rngState);
        ui = {
            round: saved.uiState.round,
            match: saved.matchState,
            phase: saved.uiState.phase,
            hand: [...saved.uiState.hand],
            slotAssignments: [...saved.uiState.slotAssignments],
            slotResolution: saved.uiState.slotResolution ? { ...saved.uiState.slotResolution } : null,
            buildBudgetLeft: saved.uiState.buildBudgetLeft,
            selectedBuildSpend: 1,
            repairUsed: { ...saved.uiState.repairUsed },
            lastMessage: saved.uiState.lastMessage || RU.runLoaded,
            gameMode: saved.uiState.gameMode ?? "hotseat",
            botDifficulty: appState.botDifficulty,
            isBotActing: false,
        };
        matchStats = createMatchStats();
        ui.lastMessage = RU.runLoadedFormat(saved.formatVersion, ui.phase);
        addUiLog("system", ui.lastMessage);
    } catch (error) {
        ui.lastMessage = error instanceof Error ? RU.loadFailed(error.message) : RU.loadFailedUnknown;
        addUiLog("system", ui.lastMessage);
    }
    render();
    maybeTriggerBotTurn();
}

function coreHp(state: MatchState, owner: PlayerId): number {
    for (let y = 0; y < state.height; y++) {
        for (let x = 0; x < state.width; x++) {
            const cell = state.grid[y]![x]!;
            if (cell.kind === "core" && cell.owner === owner) return cell.hp;
        }
    }
    return 0;
}

function startTurn(): void {
    ui.match = initializeTurnRerolls(ui.match);
    ui.hand = rollDiceFortsHand(rng);
    ui.phase = "roll";
    ui.slotAssignments = ui.hand.map(() => "build");
    ui.slotResolution = null;
    ui.buildBudgetLeft = 0;
    ui.selectedBuildSpend = 1;
    ui.repairUsed = {};
    ui.isBotActing = false;
    ui.lastMessage = RU.playerRolled(ui.match.currentPlayer, ui.hand);
    addUiLog("dice", ui.lastMessage);
    playtestSession?.turnStarted(ui.round, ui.match.currentPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
    render();
    maybeTriggerBotTurn();
}

function canInteract(phase: UiPhase): boolean {
    return canRunUiPhaseAction(ui.phase, phase, ui.match.winner, isUiLockedForBotTurn(ui.isBotActing));
}

function maybeTriggerBotTurn(): void {
    if (!claimBotTurnLock(ui.gameMode, ui.match.currentPlayer, ui.isBotActing, ui.match.winner)) {
        return;
    }
    ui.isBotActing = true;
    ui.lastMessage = RU.botThinkingDifficulty(ui.botDifficulty);
    addUiLog("system", RU.botTurnStarted);
    render();
    window.setTimeout(() => {
        if (ui.match.winner !== null || ui.gameMode !== "vsBot" || ui.match.currentPlayer !== 1) {
            ui.isBotActing = false;
            render();
            return;
        }
        try {
            const endingPlayer = ui.match.currentPlayer;
            const coreBeforeP0 = coreHp(ui.match, 0);
            const botTurn = runBotTurn(ui.match, ui.hand, rng, ui.botDifficulty);
            ui.hand = botTurn.hand;
            ui.slotAssignments = botTurn.slotAssignments;
            ui.slotResolution = botTurn.resolution;
            ui.buildBudgetLeft = 0;
            ui.selectedBuildSpend = 1;
            ui.repairUsed = {};
            ui.match = botTurn.state;
            matchStats.coreDamageByPlayer[1] += Math.max(0, coreBeforeP0 - coreHp(ui.match, 0));
            if (botTurn.rerolled) {
                matchStats.rerollsUsedByPlayer[1] += 1;
            }
            playtestSession?.turnEnded(ui.round, endingPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
            addUiLog("dice", RU.botRerollKeep(botTurn.rerolled));
            addUiLog("dice", RU.botDecisionReason("Reroll", botTurn.decisionLog.reroll));
            addUiLog(
                "system",
                RU.botSlots(botTurn.slots.build, botTurn.slots.fortify, botTurn.slots.arm)
            );
            addUiLog("system", RU.botDecisionReason("Slots", botTurn.decisionLog.slots));
            addUiLog(
                "build",
                RU.botBuildOps(
                    botTurn.buildCommands.length > 0
                        ? botTurn.buildCommands.map((cmd) => `${cmd.type}@(${cmd.x},${cmd.y})/${cmd.spend}`).join("; ")
                        : RU.none
                )
            );
            addUiLog("build", RU.botDecisionReason("Build", botTurn.decisionLog.build));
            addUiLog("combat", RU.botArmColumn(botTurn.armColumn));
            addUiLog("combat", RU.botDecisionReason("Arm", botTurn.decisionLog.arm));
            addUiLog("system", RU.botTurnEnded);
            ui.isBotActing = false;
            if (ui.match.winner !== null) {
                playtestSession?.matchEnded(ui.round, ui.match.winner);
                ui.lastMessage = RU.winner(ui.match.winner);
                maybeCompletePlaytest();
                showEndgameOverlay();
                render();
                return;
            }
            ui.round += 1;
            startTurn();
        } catch (error) {
            ui.isBotActing = false;
            ui.lastMessage = error instanceof Error ? RU.botTurnFailed(error.message) : RU.botTurnFailed();
            addUiLog("system", ui.lastMessage);
            render();
        }
    }, BOT_DELAY_MS);
}

function applyReroll(): void {
    if (!canInteract("roll")) return;
    const out = applyHandReroll(ui.match, rng);
    if (!out) {
        ui.lastMessage = RU.noRerollsLeft;
        render();
        return;
    }
    ui.match = out.state;
    ui.hand = out.hand;
    ui.slotAssignments = ui.hand.map(() => "build");
    ui.lastMessage = RU.rerolled(ui.hand);
    matchStats.rerollsUsedByPlayer[ui.match.currentPlayer] += 1;
    showNotice(RU.rerollUsedNotice);
    playtestSession?.rerollUsed(ui.round, ui.match.currentPlayer);
    addUiLog("dice", ui.lastMessage);
    render();
}

function keepHandAndGoSlots(): void {
    if (!canInteract("roll")) return;
    ui.phase = "slots";
    ui.lastMessage = RU.assignSlotsHint;
    render();
}

function commitSlots(): void {
    if (!canInteract("slots")) return;
    const slots = slotsFromAssignments(ui.hand, ui.slotAssignments);
    if (!slots) {
        ui.lastMessage = "Не удалось разложить кубы по слотам. Проверь каждый кубик.";
        playtestSession?.playerError(ui.round, ui.match.currentPlayer, "slot_assignment_mismatch");
        render();
        return;
    }
    if (!isValidSlotPartition(ui.hand, slots)) {
        ui.lastMessage = "Такое распределение кубов недоступно для текущей руки.";
        playtestSession?.playerError(ui.round, ui.match.currentPlayer, "invalid_slot_partition");
        render();
        return;
    }

    const res = resolveDiceFortsSlots(slots);
    playtestSession?.slotsCommitted(
        ui.round,
        ui.match.currentPlayer,
        slots.build.length,
        slots.fortify.length,
        slots.arm.length
    );
    ui.slotResolution = res;
    ui.buildBudgetLeft = res.buildPoints;
    ui.selectedBuildSpend = 1;
    ui.repairUsed = {};
    ui.phase = "build";
    ui.lastMessage = RU.slotCommitSummary(res);
    addUiLog("system", ui.lastMessage);
    render();
}

function applyBuild(cmd: BuildCommand): void {
    if (!canInteract("build")) return;
    const pid = ui.match.currentPlayer;
    const err = validateBuildCommand(ui.match, pid, cmd, ui.buildBudgetLeft, ui.repairUsed);
    if (err) {
        ui.lastMessage = humanBuildError(err);
        playtestSession?.playerError(ui.round, ui.match.currentPlayer, `invalid_build:${err}`);
        render();
        return;
    }

    const out = applyBuildCommand(ui.match, pid, cmd, ui.buildBudgetLeft, ui.repairUsed);
    if (!out) {
        ui.lastMessage = RU.buildApplyFailed;
        render();
        return;
    }

    const previousState = ui.match;
    ui.match = out.state;
    markChangedCells(cellsChangedBetween(previousState, out.state));
    ui.buildBudgetLeft = out.budget;
    ui.lastMessage = RU.buildApplied(cmd.type, cmd.x, cmd.y, cmd.spend);
    showNotice(RU.buildAppliedNotice);
    playtestSession?.buildAction(ui.round, ui.match.currentPlayer, cmd.type, cmd.spend);
    addUiLog("build", ui.lastMessage);
    render();
}

function handleBuildBoardClick(x: number, y: number): void {
    if (!canInteract("build")) return;
    if (ui.buildBudgetLeft <= 0) {
        ui.lastMessage = "Build: бюджет на ход уже исчерпан. Нажмите «Завершить Build».";
        render();
        return;
    }
    const playerId = ui.match.currentPlayer;
    const key = `${x},${y}`;
    const canNew = new Set(getBuildTargets(ui.match, playerId).map((cell) => `${cell.x},${cell.y}`)).has(key);
    const canRepair = new Set(getRepairTargets(ui.match, playerId, ui.repairUsed).map((cell) => `${cell.x},${cell.y}`)).has(key);
    if (!canNew && !canRepair) {
        ui.lastMessage = "Эта клетка сейчас не подходит ни для постройки, ни для ремонта.";
        render();
        return;
    }
    const type: BuildCommand["type"] = canNew ? "new" : "repair";
    const spend = Math.max(1, Math.min(ui.selectedBuildSpend, ui.buildBudgetLeft));
    applyBuild({ type, x, y, spend });
}

function doneBuild(): void {
    if (!canInteract("build")) return;
    ui.phase = "arm";
    ui.lastMessage = RU.goToArm;
    render();
}

function fireArm(column: number): void {
    if (!canInteract("arm")) return;
    if (!ui.slotResolution) return;
    if (!ui.slotResolution.arm.canFire) {
        ui.lastMessage = RU.armBlocked(armFailureReason(ui.slotResolution.arm));
        render();
        return;
    }
    const pid = ui.match.currentPlayer;
    const defId = opponentOf(pid);
    const out = applyArmColumnAttack(
        ui.match,
        pid,
        column,
        ui.slotResolution.arm.damage,
        ui.slotResolution.arm.pierceDepth,
        ui.match.players[defId]!.savedFortifyCharges
    );
    const previousState = ui.match;
    ui.match = out.state;
    markChangedCells(cellsChangedBetween(previousState, out.state));
    ui.match = patchPlayerSecrets(ui.match, defId, { savedFortifyCharges: out.chargesRemaining });
    ui.phase = "end";
    playtestSession?.armAction(ui.round, ui.match.currentPlayer, false, column);
    ui.lastMessage = RU.armFired(column, out.targetsHit.length);
    addUiLog("combat", ui.lastMessage);
    let showedFortifyNotice = false;
    let showedCoreHitNotice = false;
    out.targetsHit.forEach((target, idx) => {
        const fortify = out.fortifyApplications[idx];
        if (fortify && fortify.absorbed > 0) {
            if (!showedFortifyNotice) {
                showNotice(RU.fortifyAbsorbedNotice);
                showedFortifyNotice = true;
            }
            addUiLog(
                "combat",
                RU.fortifyAbsorbedLog(fortify.absorbed, target.x, target.y, fortify.chargesBefore, fortify.chargesAfter)
            );
        }
        if (target.kind === "core") {
            const dealt = Math.max(0, target.hpBefore - target.hpAfter);
            matchStats.coreDamageByPlayer[pid] += dealt;
            if (!showedCoreHitNotice) {
                showNotice(RU.coreHitNotice);
                showedCoreHitNotice = true;
            }
            addUiLog("combat", RU.coreHitLog(target.x, target.y, target.hpBefore, target.hpAfter));
        } else {
            addUiLog("combat", RU.blockHitLog(target.x, target.y, target.hpBefore, target.hpAfter));
        }
    });
    render();
}

function skipArm(): void {
    if (!canInteract("arm")) return;
    ui.phase = "end";
    ui.lastMessage = RU.armSkipped;
    playtestSession?.armAction(ui.round, ui.match.currentPlayer, true, null);
    addUiLog("combat", ui.lastMessage);
    render();
}

function endTurn(): void {
    if (!canInteract("end")) return;
    const endingPlayer = ui.match.currentPlayer;
    if (ui.slotResolution) {
        ui.match = endTurnUpdateFortify(ui.match, ui.match.currentPlayer, ui.slotResolution.fortifyCharges);
        addUiLog("system", RU.endTurnStoredFortify(ui.slotResolution.fortifyCharges, ui.match.currentPlayer));
    }
    if (ui.match.winner !== null) {
        playtestSession?.turnEnded(ui.round, ui.match.currentPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
        playtestSession?.matchEnded(ui.round, ui.match.winner);
        ui.lastMessage = RU.winner(ui.match.winner);
        addUiLog("system", ui.lastMessage);
        maybeCompletePlaytest();
        showEndgameOverlay();
        render();
        return;
    }
    ui.match = advanceCurrentPlayer(ui.match);
    playtestSession?.turnEnded(ui.round, endingPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
    ui.round += 1;
    startTurn();
}

function render(): void {
    if (appState.screen !== "game") return;
    renderTopBar();
    renderStatus();
    renderRollPanel();
    renderSlotsPanel();
    renderBuildPanel();
    renderArmPanel();
    renderBoard();
    renderLogPanel();
}

function renderTopBar(): void {
    topBarModeEl.textContent = RU.modeLabel(ui.gameMode);
    topBarRoundEl.textContent = RU.roundLabel(ui.round);
    topBarPlayerEl.textContent = RU.activePlayerLabel(ui.match.currentPlayer);
}

function renderLogPanel(): void {
    const filtered = filterUiLogEntries(uiLogEntries, uiLogFilters);
    const entries = filtered.slice(Math.max(0, filtered.length - DISPLAY_LOG_EVENTS));
    logListEl.innerHTML = "";
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = uiLogEntries.length === 0 ? RU.emptyLog : RU.emptyFilteredLog;
        logListEl.appendChild(empty);
    } else {
        entries.forEach((entry) => {
            const row = document.createElement("div");
            row.className = `log-entry log-${entry.category}`;
            row.textContent = `T${entry.turn} И${entry.playerId} [${RU.logCategory(entry.category)}] ${entry.message}`;
            logListEl.appendChild(row);
        });
    }
    logListEl.scrollTop = logListEl.scrollHeight;
}

function renderStatus(): void {
    statusEl.innerHTML = "";
    const p = document.createElement("div");
    p.innerHTML = `
        <div>${RU.statusRound}: <strong>${ui.round}</strong></div>
        <div>${RU.statusActivePlayer}: <strong>${ui.match.currentPlayer}</strong></div>
        <div>${RU.statusCoreHp}: <strong>${coreHp(ui.match, 0)} / ${coreHp(ui.match, 1)}</strong></div>
        <div>${RU.statusFortify}: <strong>${ui.match.players[0]!.savedFortifyCharges} / ${ui.match.players[1]!.savedFortifyCharges}</strong></div>
        <div>${RU.statusPhase}: <strong>${ui.phase}</strong></div>
        <div>${RU.statusMode}: <strong>${ui.gameMode === "vsBot" ? RU.modeVsBot : RU.modeHotseat}</strong></div>
        <div>${RU.statusCurrentStep}: <strong>${currentPhaseHint()}</strong></div>
        <div class="muted">${RU.statusRerollsLeft(ui.match.rerollsLeftThisTurn)}</div>
        ${ui.isBotActing ? `<div class="muted">${RU.botThinkingDifficulty(ui.botDifficulty)}</div>` : ""}
    `;
    statusEl.appendChild(p);
    nextActionEl.innerHTML = `<strong>${RU.nextActionLabel}</strong> ${nextActionHint()}<br><span class="muted">${phaseWhyHint()}</span>`;
}

function renderRollPanel(): void {
    rollPanelEl.innerHTML = "";
    const hand = document.createElement("div");
    hand.textContent = RU.handLabel(ui.hand);
    rollPanelEl.appendChild(hand);

    const rerollBtn = button(RU.rerollButton, applyReroll, !canInteract("roll") || ui.match.rerollsLeftThisTurn <= 0, RU.rerollButton);
    const keepBtn = button(RU.keepHandButton, keepHandAndGoSlots, !canInteract("roll"), RU.keepHandButton);
    rollPanelEl.append(rerollBtn, keepBtn);
}

function renderSlotsPanel(): void {
    slotsPanelEl.innerHTML = "";
    if (ui.hand.length === 0) return;
    const slotTips = document.createElement("div");
    slotTips.className = "panel-note muted";
    slotTips.textContent =
        "Fortify (щит): эффективные щиты за ход считаются как floor(среднее)-1 (не ниже 0), поэтому защита стала мягче. Arm (атака): выстрел доступен уже при max=3+, так что матч идет динамичнее.";
    slotsPanelEl.appendChild(slotTips);

    ui.hand.forEach((die, idx) => {
        const row = document.createElement("div");
        row.textContent = `Кубик #${idx + 1} (${die}) `;
        const select = document.createElement("select");
        for (const slot of ["build", "fortify", "arm"] as const) {
            const option = document.createElement("option");
            option.value = slot;
            option.textContent = slot === "build" ? "Build (стройка)" : slot === "fortify" ? "Fortify (щит)" : "Arm (атака)";
            option.selected = ui.slotAssignments[idx] === slot;
            select.appendChild(option);
        }
        select.disabled = !canInteract("slots");
        select.addEventListener("change", () => {
            ui.slotAssignments[idx] = select.value as SlotName;
        });
        row.appendChild(select);
        slotsPanelEl.appendChild(row);
    });

    slotsPanelEl.appendChild(button(RU.commitSlotsButton, commitSlots, !canInteract("slots"), RU.commitSlotsButton));
}

function renderBuildPanel(): void {
    buildPanelEl.innerHTML = "";
    const budget = document.createElement("div");
    budget.textContent = RU.buildBudget(ui.buildBudgetLeft);
    buildPanelEl.appendChild(budget);
    const buildTip = document.createElement("div");
    buildTip.className = "panel-note muted";
    buildTip.textContent = "Выберите, где строить или чинить. Строить можно рядом со своими блоками или ядром.";
    buildPanelEl.appendChild(buildTip);
    const playerId = ui.match.currentPlayer;
    const hasBuildTargets =
        getBuildTargets(ui.match, playerId).length > 0 || getRepairTargets(ui.match, playerId, ui.repairUsed).length > 0;
    if (ui.phase === "build" && !hasBuildTargets) {
        const emptyState = document.createElement("div");
        emptyState.className = "muted panel-note";
        emptyState.textContent = "Сейчас нет доступных целей для строительства или ремонта. Можно завершить фазу.";
        buildPanelEl.appendChild(emptyState);
    }
    const spendWrap = document.createElement("div");
    spendWrap.className = "panel-note";
    spendWrap.textContent = "Расход Build за клик:";
    for (const spend of [1, 2, 3, 4]) {
        const spendBtn = button(
            `+${spend}`,
            () => {
                ui.selectedBuildSpend = spend;
                renderBuildPanel();
            },
            !canInteract("build") || ui.buildBudgetLeft <= 0
        );
        if (ui.selectedBuildSpend === spend) {
            spendBtn.classList.add("selected");
        }
        spendWrap.appendChild(spendBtn);
    }
    buildPanelEl.appendChild(spendWrap);
    const clickTip = document.createElement("div");
    clickTip.className = "panel-note muted";
    clickTip.textContent = "Клик по подсвеченной клетке: пустая = новый блок, своя поврежденная = ремонт.";
    buildPanelEl.appendChild(clickTip);
    const doneBtn = button(RU.doneBuildButton, doneBuild, !canInteract("build"), RU.doneBuildButton);
    buildPanelEl.append(doneBtn);
    const advanced = document.createElement("details");
    advanced.className = "panel-note";
    const summary = document.createElement("summary");
    summary.textContent = "Advanced: ручной ввод координат (debug)";
    advanced.appendChild(summary);
    const typeInput = document.createElement("select");
    ["new", "repair"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value === "new" ? "new (новый блок)" : "repair (ремонт)";
        typeInput.appendChild(option);
    });
    const xInput = numericInput("x");
    const yInput = numericInput("y");
    const spendInput = numericInput("очки");
    const applyBtn = button(
        RU.applyBuildButton,
        () => {
            const x = Number(xInput.value);
            const y = Number(yInput.value);
            const spend = Number(spendInput.value);
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(spend)) {
                ui.lastMessage = RU.buildRequiresIntegers;
                render();
                return;
            }
            applyBuild({ type: typeInput.value as "new" | "repair", x, y, spend });
        },
        !canInteract("build")
    );
    advanced.append(typeInput, xInput, yInput, spendInput, applyBtn);
    buildPanelEl.appendChild(advanced);
}

function renderArmPanel(): void {
    armPanelEl.innerHTML = "";
    const armInfo = document.createElement("div");
    const arm = ui.slotResolution?.arm;
    const armColumns = arm?.canFire ? getArmTargets(ui.match, ui.match.currentPlayer) : [];
    armInfo.textContent = arm
        ? `Arm: max=${arm.max}, выстрел=${arm.canFire ? "да" : "нет"}, урон=${arm.damage}, пробитие=${arm.pierceDepth}`
        : RU.armUnavailable;
    armPanelEl.appendChild(armInfo);
    const armTip = document.createElement("div");
    armTip.className = "panel-note muted";
    armTip.textContent =
        "Arm (атака): выберите колонку для удара. Выстрел доступен при max=3+, а если попадание дошло до ядра, оно нанесет минимум 1 урона.";
    armPanelEl.appendChild(armTip);
    if (ui.phase === "arm" && (!arm?.canFire || armColumns.length === 0)) {
        const armReason = document.createElement("div");
        armReason.className = "muted panel-note";
        armReason.textContent = RU.armBlocked(armFailureReason(arm));
        armPanelEl.appendChild(armReason);
    }

    const clickHint = document.createElement("div");
    clickHint.className = "panel-note muted";
    clickHint.textContent = "Клик по подсвеченной колонке или вражеской клетке в колонке запускает выстрел.";
    armPanelEl.appendChild(clickHint);
    const skipBtn = button(RU.skipButton, skipArm, !canInteract("arm"), RU.skipButton);
    const endBtn = button(RU.endTurnButton, endTurn, !canInteract("end"), RU.endTurnButton);
    armPanelEl.append(skipBtn, endBtn);
    const advanced = document.createElement("details");
    advanced.className = "panel-note";
    const summary = document.createElement("summary");
    summary.textContent = "Advanced: ручной выбор колонки (debug)";
    advanced.appendChild(summary);
    const xInput = numericInput("колонка x");
    const fireBtn = button(
        RU.fireButton,
        () => {
            const col = parseColumn(xInput.value, ui.match.width);
            if (col === null) {
                ui.lastMessage = RU.chooseIntegerColumn(ui.match.width - 1);
                playtestSession?.playerError(ui.round, ui.match.currentPlayer, "invalid_arm_column");
                render();
                return;
            }
            fireArm(col);
        },
        !canInteract("arm") || !arm?.canFire,
        RU.fireButton
    );
    advanced.append(xInput, fireBtn);
    armPanelEl.appendChild(advanced);
}

function renderBoard(): void {
    boardEl.innerHTML = "";
    const playerId = ui.match.currentPlayer;
    const newHints = new Set(getBuildTargets(ui.match, playerId).map((cell) => `${cell.x},${cell.y}`));
    const repairHints = new Set(getRepairTargets(ui.match, playerId, ui.repairUsed).map((cell) => `${cell.x},${cell.y}`));
    const armHints =
        ui.phase === "arm" && ui.slotResolution?.arm.canFire
            ? new Set(getArmTargets(ui.match, playerId))
            : new Set<number>();

    for (let x = 0; x < ui.match.width; x++) {
        const header = document.createElement("div");
        header.className = "col-header";
        if (armHints.has(x)) {
            header.classList.add("hint-arm-col");
        }
        if (canInteract("arm") && armHints.has(x)) {
            header.classList.add("clickable-target");
            header.title = `Клик: атаковать колонку ${x}`;
            header.addEventListener("click", () => fireArm(x));
        }
        header.textContent = String(x);
        boardEl.appendChild(header);
    }
    for (let y = 0; y < ui.match.height; y++) {
        for (let x = 0; x < ui.match.width; x++) {
            const c = ui.match.grid[y]![x]!;
            const cell = document.createElement("div");
            cell.className = "cell";
            if (c.kind === "empty") {
                cell.classList.add("cell-empty");
                cell.textContent = "·";
            } else if (c.kind === "block") {
                cell.classList.add(c.owner === 0 ? "cell-block-p0" : "cell-block-p1");
                cell.textContent = `B${c.owner}\n${c.hp}`;
            } else {
                cell.classList.add(c.owner === 0 ? "cell-core-p0" : "cell-core-p1");
                cell.textContent = `C${c.owner}\n${c.hp}`;
            }
            const key = `${x},${y}`;
            if (ui.phase === "build" && newHints.has(key)) {
                cell.classList.add("hint-new");
            }
            if (ui.phase === "build" && repairHints.has(key)) {
                cell.classList.add("hint-repair");
            }
            if (canInteract("build") && (newHints.has(key) || repairHints.has(key))) {
                cell.classList.add("clickable-target");
            }
            if (canInteract("arm") && armHints.has(x)) {
                cell.classList.add("clickable-target");
            }
            if (changedCells.has(key)) {
                cell.classList.add("cell-flash");
            }
            cell.title = `(${x},${y})`;
            if (ui.phase === "build") {
                cell.addEventListener("click", () => handleBuildBoardClick(x, y));
            } else if (ui.phase === "arm" && armHints.has(x)) {
                cell.addEventListener("click", () => fireArm(x));
            }
            boardEl.appendChild(cell);
        }
    }
    boardLegendEl.innerHTML = `
        <span class="legend-chip legend-empty">${RU.legendEmpty}</span>
        <span class="legend-chip legend-block-p0">${RU.legendBlockP0}</span>
        <span class="legend-chip legend-block-p1">${RU.legendBlockP1}</span>
        <span class="legend-chip legend-core-p0">${RU.legendCoreP0}</span>
        <span class="legend-chip legend-core-p1">${RU.legendCoreP1}</span>
        <span class="legend-chip legend-new">${RU.legendBuildNew}</span>
        <span class="legend-chip legend-repair">${RU.legendBuildRepair}</span>
        <span class="legend-chip legend-arm">${RU.legendArmColumn}</span>
    `;
}

function createMatchStats(): MatchStats {
    return {
        coreDamageByPlayer: { 0: 0, 1: 0 },
        rerollsUsedByPlayer: { 0: 0, 1: 0 },
    };
}

function currentPhaseHint(): string {
    if (ui.isBotActing) {
        return RU.phaseBot;
    }
    switch (ui.phase) {
        case "roll":
            return RU.phaseRoll;
        case "slots":
            return RU.phaseSlots;
        case "build":
            return RU.phaseBuild;
        case "arm":
            return RU.phaseArm;
        case "end":
            return RU.phaseEnd;
        default:
            return RU.phaseDefault;
    }
}

function nextActionHint(): string {
    if (ui.match.winner !== null) {
        return RU.nextMatchEnded;
    }
    if (ui.isBotActing) {
        return RU.nextWaitBot;
    }
    if (ui.phase === "build") {
        const playerId = ui.match.currentPlayer;
        const hasTargets =
            getBuildTargets(ui.match, playerId).length > 0 || getRepairTargets(ui.match, playerId, ui.repairUsed).length > 0;
        if (!hasTargets) {
            return RU.nextNoBuildTargets;
        }
    }
    if (ui.phase === "arm") {
        const arm = ui.slotResolution?.arm;
        const armColumns = arm?.canFire ? getArmTargets(ui.match, ui.match.currentPlayer) : [];
        if (!arm?.canFire || armColumns.length === 0) {
            return RU.nextArmBlocked(armFailureReason(arm));
        }
    }
    switch (ui.phase) {
        case "roll":
            return RU.nextRoll(ui.match.rerollsLeftThisTurn > 0);
        case "slots":
            return RU.nextSlots;
        case "build":
            return RU.nextBuild;
        case "arm":
            return RU.nextArm;
        case "end":
            return RU.nextEnd;
        default:
            return RU.nextDefault;
    }
}

function phaseWhyHint(): string {
    switch (ui.phase) {
        case "roll":
            return RU.whyRoll;
        case "slots":
            return RU.whySlots;
        case "build":
            return RU.whyBuild;
        case "arm":
            return RU.whyArm;
        case "end":
            return RU.whyEnd;
        default:
            return RU.whyFortify;
    }
}

function armFailureReason(arm: DiceFortsSlotResolution["arm"] | null | undefined): string {
    if (!arm || arm.max === null) {
        return RU.armFailNoDice;
    }
    if (!arm.canFire) {
        return RU.armFailThreshold(arm.max);
    }
    return RU.armFailNoTargets;
}

function showNotice(message: string): void {
    noticeEl.textContent = message;
    noticeEl.classList.add("show");
    if (noticeTimeout !== null) {
        window.clearTimeout(noticeTimeout);
    }
    noticeTimeout = window.setTimeout(() => hideNotice(), NOTICE_TIMEOUT_MS);
}

function hideNotice(): void {
    noticeEl.classList.remove("show");
}

function markChangedCells(keys: string[]): void {
    keys.forEach((key) => changedCells.add(key));
    if (changedCellTimeout !== null) {
        window.clearTimeout(changedCellTimeout);
    }
    changedCellTimeout = window.setTimeout(() => {
        changedCells.clear();
        renderBoard();
    }, CELL_FLASH_TIMEOUT_MS);
}

function cellsChangedBetween(previousState: MatchState, nextState: MatchState): string[] {
    const changed: string[] = [];
    for (let y = 0; y < previousState.height; y++) {
        for (let x = 0; x < previousState.width; x++) {
            const before = previousState.grid[y]![x]!;
            const after = nextState.grid[y]![x]!;
            if (before.kind !== after.kind) {
                changed.push(`${x},${y}`);
                continue;
            }
            if (before.kind !== "empty" && after.kind !== "empty" && (before.owner !== after.owner || before.hp !== after.hp)) {
                changed.push(`${x},${y}`);
            }
        }
    }
    return changed;
}

function showEndgameOverlay(): void {
    tutorialOverlayEl.classList.add("hidden");
    clearTutorialHighlights();
    if (ui.gameMode === "vsBot") {
        endgameTitleEl.textContent = ui.match.winner === 0 ? RU.endVictory : RU.endDefeat;
    } else {
        endgameTitleEl.textContent = RU.endWinnerPlayer(String(ui.match.winner ?? "-"));
    }
    endgameStatsEl.textContent = RU.endStats(
        ui.round,
        matchStats.coreDamageByPlayer[0],
        matchStats.coreDamageByPlayer[1],
        matchStats.rerollsUsedByPlayer[0],
        matchStats.rerollsUsedByPlayer[1]
    );
    endgameOverlayEl.classList.remove("hidden");
}

function hideEndgameOverlay(): void {
    endgameOverlayEl.classList.add("hidden");
}

function button(label: string, onClick: () => void, disabled: boolean, ariaLabel?: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = disabled;
    if (ariaLabel) {
        btn.setAttribute("aria-label", ariaLabel);
    }
    btn.addEventListener("click", onClick);
    return btn;
}

function humanBuildError(error: string): string {
    const mapped: Record<string, string> = {
        "spend must be >= 1": "Build: укажи расход не меньше 1.",
        "not enough build points": "Build: не хватает очков для этого действия.",
        "out of bounds": "Build: эта клетка вне поля.",
        "cell is not empty": "Build: для создания нужна пустая клетка.",
        "not adjacent to your structure": "Build: строй рядом со своими блоками или ядром.",
        "nothing to repair": "Build: в этой клетке нечего чинить.",
        "not your cell": "Build: можно чинить только свои клетки.",
        "cell is destroyed": "Build: разрушенную клетку чинить нельзя.",
        "repair cap for this cell this turn reached": "Build: лимит ремонта этой клетки на ход исчерпан.",
        "already full HP": "Build: клетка уже с полным HP.",
    };
    return mapped[error] ?? `Build отклонен: ${error}`;
}

function numericInput(placeholder: string): HTMLInputElement {
    const input = document.createElement("input");
    input.type = "number";
    input.placeholder = placeholder;
    input.min = "0";
    input.step = "1";
    return input;
}

function showPlaytestOnboarding(): void {
    window.alert(
        RU.playtestOnboarding
    );
}

function maybeCompletePlaytest(): void {
    if (!isPlaytestMode || !playtestSession || playtestExported) return;
    const feedback = promptPlaytestFeedback();
    if (!feedback) return;
    const report = playtestSession.report(feedback);
    downloadText(`${report.sessionId}.json`, `${JSON.stringify(report, null, 2)}\n`, "application/json");
    downloadText(`${report.sessionId}.csv`, playtestReportToCsv(report), "text/csv");
    playtestExported = true;
    addUiLog("system", RU.playtestExported);
}

function promptPlaytestFeedback(): PlaytestFeedback | null {
    const askRating = (question: string): number | null => {
        const raw = window.prompt(`${question} (1..5)`);
        if (raw === null) return null;
        try {
            return validateFeedbackRating(Number(raw.trim()));
        } catch {
            window.alert(RU.playtestRatingInput);
            return askRating(question);
        }
    };
    const rulesClarity = askRating(RU.playtestQRules);
    if (rulesClarity === null) return null;
    const diceChoiceInterest = askRating(RU.playtestQDice);
    if (diceChoiceInterest === null) return null;
    const playAgainDesire = askRating(RU.playtestQReplay);
    if (playAgainDesire === null) return null;
    const comment = window.prompt(RU.playtestComment) ?? "";
    return validateFeedback({ rulesClarity, diceChoiceInterest, playAgainDesire, comment });
}

function downloadText(fileName: string, content: string, mime: string): void {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    link.click();
    URL.revokeObjectURL(url);
}
