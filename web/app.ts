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
import type { BotName } from "../src/sim/types.js";
import type { DiceFortsSlotResolution } from "../src/types.js";
import { isUiLockedForBotTurn, runBotTurn, shouldStartBotTurn, type GameMode } from "./bot-turn.js";
import {
    filterUiLogEntries,
    getValidArmColumns,
    getValidNewCells,
    getValidRepairCells,
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

type UiPhase = "roll" | "slots" | "build" | "arm" | "end";
type Screen = "menu" | "tutorial" | "game";

interface UiState {
    round: number;
    match: MatchState;
    phase: UiPhase;
    hand: number[];
    slotAssignments: SlotName[];
    slotResolution: DiceFortsSlotResolution | null;
    buildBudgetLeft: number;
    repairUsed: Record<string, number>;
    lastMessage: string;
    gameMode: GameMode;
    isBotActing: boolean;
}

interface AppState {
    screen: Screen;
    gameMode: GameMode;
    isModeSelected: boolean;
    seed: number | null;
    soundEnabled: boolean;
    tutorialEnabled: boolean;
}

interface MatchStats {
    coreDamageByPlayer: Record<PlayerId, number>;
    rerollsUsedByPlayer: Record<PlayerId, number>;
}

const menuScreenEl = requireElement("menu-screen");
const tutorialScreenEl = requireElement("tutorial-screen");
const gameScreenEl = requireElement("game-screen");
const menuModeVsBotEl = requireElement("menu-mode-vsbot");
const menuModeHotseatEl = requireElement("menu-mode-hotseat");
const menuHowToPlayEl = requireElement("menu-how-to-play");
const menuSeedInputEl = requireInputElement("menu-seed-input");
const menuSoundToggleEl = requireInputElement("menu-sound-toggle");
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
    repairUsed: {},
    lastMessage: "Web MVP ready.",
    gameMode: appState.gameMode,
    isBotActing: false,
};
const BOT_PRESET: BotName = "balanced";
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

function setupRunControls(): void {
    runControlsEl.innerHTML = "";
    const playtestToggleBtn = button(
        isPlaytestMode ? "Disable Playtest Mode" : "Enable Playtest Mode",
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
    tutorialToggleWrap.textContent = "Tutorial ";
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
        button("Save Run", saveRunToFile, false),
        button("Load Run", () => loadRunInputEl.click(), false)
    );
    loadRunInputEl.addEventListener("change", async () => {
        const file = loadRunInputEl.files?.[0];
        if (!file) return;
        try {
            const text = await file.text();
            loadRunFromText(text);
        } catch {
            ui.lastMessage = "Load failed: unable to read selected file.";
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
    menuStartGameEl.addEventListener("click", () => {
        if (!appState.isModeSelected) return;
        startNewGame();
    });
    backToMenuEl.addEventListener("click", () => {
        if (!window.confirm("Return to menu? Current match progress will be lost.")) return;
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
    menuStartGameEl.toggleAttribute("disabled", !appState.isModeSelected);
}

function syncScreenVisibility(): void {
    menuScreenEl.classList.toggle("hidden", appState.screen !== "menu");
    tutorialScreenEl.classList.toggle("hidden", appState.screen !== "tutorial");
    gameScreenEl.classList.toggle("hidden", appState.screen !== "game");
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
        repairUsed: {},
        lastMessage: `New match started. Seed=${chosenSeed}`,
        gameMode: appState.gameMode,
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
        label.append(input, document.createTextNode(category));
        filterWrap.appendChild(label);
    }
    const clearBtn = button("Clear log", () => {
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
    ui.lastMessage = "Run saved to JSON file.";
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
            repairUsed: { ...saved.uiState.repairUsed },
            lastMessage: saved.uiState.lastMessage || "Run loaded.",
            gameMode: saved.uiState.gameMode ?? "hotseat",
            isBotActing: false,
        };
        matchStats = createMatchStats();
        ui.lastMessage = `Run loaded (format ${saved.formatVersion}). Continue from phase "${ui.phase}".`;
        addUiLog("system", ui.lastMessage);
    } catch (error) {
        ui.lastMessage = error instanceof Error ? `Load failed: ${error.message}` : "Load failed: unknown error.";
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
    ui.repairUsed = {};
    ui.isBotActing = false;
    ui.lastMessage = `Player ${ui.match.currentPlayer} rolled [${ui.hand.join(", ")}]`;
    addUiLog("dice", ui.lastMessage);
    playtestSession?.turnStarted(ui.round, ui.match.currentPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
    render();
    maybeTriggerBotTurn();
}

function canInteract(phase: UiPhase): boolean {
    return ui.phase === phase && ui.match.winner === null && !isUiLockedForBotTurn(ui.isBotActing);
}

function maybeTriggerBotTurn(): void {
    if (!shouldStartBotTurn(ui.gameMode, ui.match.currentPlayer, ui.isBotActing, ui.match.winner)) {
        return;
    }
    ui.isBotActing = true;
    ui.lastMessage = "Bot is thinking...";
    addUiLog("system", "Bot turn started");
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
            const botTurn = runBotTurn(ui.match, ui.hand, rng, BOT_PRESET);
            ui.hand = botTurn.hand;
            ui.slotAssignments = botTurn.slotAssignments;
            ui.slotResolution = botTurn.resolution;
            ui.buildBudgetLeft = 0;
            ui.repairUsed = {};
            ui.match = botTurn.state;
            matchStats.coreDamageByPlayer[1] += Math.max(0, coreBeforeP0 - coreHp(ui.match, 0));
            if (botTurn.rerolled) {
                matchStats.rerollsUsedByPlayer[1] += 1;
            }
            playtestSession?.turnEnded(ui.round, endingPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
            addUiLog("dice", botTurn.rerolled ? "Bot reroll/keep: reroll" : "Bot reroll/keep: keep");
            addUiLog(
                "system",
                `Bot slots: B[${botTurn.slots.build.join(",")}], F[${botTurn.slots.fortify.join(",")}], A[${botTurn.slots.arm.join(",")}]`
            );
            addUiLog(
                "build",
                `Bot build ops: ${
                    botTurn.buildCommands.length > 0
                        ? botTurn.buildCommands.map((cmd) => `${cmd.type}@(${cmd.x},${cmd.y})/${cmd.spend}`).join("; ")
                        : "none"
                }`
            );
            addUiLog("combat", `Bot arm column: ${botTurn.armColumn === null ? "skip" : botTurn.armColumn}`);
            addUiLog("system", "Bot turn ended");
            ui.isBotActing = false;
            if (ui.match.winner !== null) {
                playtestSession?.matchEnded(ui.round, ui.match.winner);
                ui.lastMessage = `Winner: Player ${ui.match.winner}`;
                maybeCompletePlaytest();
                showEndgameOverlay();
                render();
                return;
            }
            ui.round += 1;
            startTurn();
        } catch (error) {
            ui.isBotActing = false;
            ui.lastMessage = error instanceof Error ? `Bot turn failed: ${error.message}` : "Bot turn failed.";
            addUiLog("system", ui.lastMessage);
            render();
        }
    }, BOT_DELAY_MS);
}

function applyReroll(): void {
    if (!canInteract("roll")) return;
    const out = applyHandReroll(ui.match, rng);
    if (!out) {
        ui.lastMessage = "No rerolls left this turn.";
        render();
        return;
    }
    ui.match = out.state;
    ui.hand = out.hand;
    ui.slotAssignments = ui.hand.map(() => "build");
    ui.lastMessage = `Rerolled: [${ui.hand.join(", ")}]`;
    matchStats.rerollsUsedByPlayer[ui.match.currentPlayer] += 1;
    showNotice("Reroll использован");
    playtestSession?.rerollUsed(ui.round, ui.match.currentPlayer);
    addUiLog("dice", ui.lastMessage);
    render();
}

function keepHandAndGoSlots(): void {
    if (!canInteract("roll")) return;
    ui.phase = "slots";
    ui.lastMessage = "Assign each die into Build/Fortify/Arm and commit.";
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
    ui.repairUsed = {};
    ui.phase = "build";
    ui.lastMessage = `Slots committed. Build=${res.buildPoints}, Fortify=${res.fortifyCharges}, Arm damage=${res.arm.damage}.`;
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
        ui.lastMessage = "Не удалось применить Build-команду. Попробуй другой ход.";
        render();
        return;
    }

    const previousState = ui.match;
    ui.match = out.state;
    markChangedCells(cellsChangedBetween(previousState, out.state));
    ui.buildBudgetLeft = out.budget;
    ui.lastMessage = `Build applied: ${cmd.type} at (${cmd.x},${cmd.y}) spend ${cmd.spend}.`;
    showNotice("Build применен");
    playtestSession?.buildAction(ui.round, ui.match.currentPlayer, cmd.type, cmd.spend);
    addUiLog("build", ui.lastMessage);
    render();
}

function doneBuild(): void {
    if (!canInteract("build")) return;
    ui.phase = "arm";
    ui.lastMessage = "Choose a column to fire or skip attack.";
    render();
}

function fireArm(column: number): void {
    if (!canInteract("arm")) return;
    if (!ui.slotResolution) return;
    if (!ui.slotResolution.arm.canFire) {
        ui.lastMessage = `Arm не может стрелять: ${armFailureReason(ui.slotResolution.arm)} Попробуй Skip.`;
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
    ui.lastMessage = `Arm fired at x=${column}. Hits=${out.targetsHit.length}.`;
    addUiLog("combat", ui.lastMessage);
    let showedFortifyNotice = false;
    let showedCoreHitNotice = false;
    out.targetsHit.forEach((target, idx) => {
        const fortify = out.fortifyApplications[idx];
        if (fortify && fortify.absorbed > 0) {
            if (!showedFortifyNotice) {
                showNotice("Fortify поглотил урон");
                showedFortifyNotice = true;
            }
            addUiLog(
                "combat",
                `Fortify absorbed ${fortify.absorbed} damage at (${target.x},${target.y}); charges ${fortify.chargesBefore}->${fortify.chargesAfter}.`
            );
        }
        if (target.kind === "core") {
            const dealt = Math.max(0, target.hpBefore - target.hpAfter);
            matchStats.coreDamageByPlayer[pid] += dealt;
            if (!showedCoreHitNotice) {
                showNotice("Попадание по ядру");
                showedCoreHitNotice = true;
            }
            addUiLog("combat", `Core hit at (${target.x},${target.y}): ${target.hpBefore}->${target.hpAfter}.`);
        } else {
            addUiLog("combat", `Block hit at (${target.x},${target.y}): ${target.hpBefore}->${target.hpAfter}.`);
        }
    });
    render();
}

function skipArm(): void {
    if (!canInteract("arm")) return;
    ui.phase = "end";
    ui.lastMessage = "Arm skipped.";
    playtestSession?.armAction(ui.round, ui.match.currentPlayer, true, null);
    addUiLog("combat", ui.lastMessage);
    render();
}

function endTurn(): void {
    if (!canInteract("end")) return;
    const endingPlayer = ui.match.currentPlayer;
    if (ui.slotResolution) {
        ui.match = endTurnUpdateFortify(ui.match, ui.match.currentPlayer, ui.slotResolution.fortifyCharges);
        addUiLog("system", `End turn: stored fortify=${ui.slotResolution.fortifyCharges} for player ${ui.match.currentPlayer}.`);
    }
    if (ui.match.winner !== null) {
        playtestSession?.turnEnded(ui.round, ui.match.currentPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
        playtestSession?.matchEnded(ui.round, ui.match.winner);
        ui.lastMessage = `Winner: Player ${ui.match.winner}`;
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
    topBarModeEl.textContent = `Mode: ${ui.gameMode === "vsBot" ? "Play vs Bot" : "Hot-seat (2 players)"}`;
    topBarRoundEl.textContent = `Round: ${ui.round}`;
    topBarPlayerEl.textContent = `Active: Player ${ui.match.currentPlayer}`;
}

function renderLogPanel(): void {
    const filtered = filterUiLogEntries(uiLogEntries, uiLogFilters);
    const entries = filtered.slice(Math.max(0, filtered.length - DISPLAY_LOG_EVENTS));
    logListEl.innerHTML = "";
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = uiLogEntries.length === 0 ? "Ходов пока нет." : "Нет записей для выбранных фильтров.";
        logListEl.appendChild(empty);
    } else {
        entries.forEach((entry) => {
            const row = document.createElement("div");
            row.className = `log-entry log-${entry.category}`;
            row.textContent = `T${entry.turn} P${entry.playerId} [${entry.category}] ${entry.message}`;
            logListEl.appendChild(row);
        });
    }
    logListEl.scrollTop = logListEl.scrollHeight;
}

function renderStatus(): void {
    statusEl.innerHTML = "";
    const p = document.createElement("div");
    p.innerHTML = `
        <div>Round: <strong>${ui.round}</strong></div>
        <div>Active Player: <strong>${ui.match.currentPlayer}</strong></div>
        <div>Core HP P0/P1: <strong>${coreHp(ui.match, 0)} / ${coreHp(ui.match, 1)}</strong></div>
        <div>Fortify charges P0/P1: <strong>${ui.match.players[0]!.savedFortifyCharges} / ${ui.match.players[1]!.savedFortifyCharges}</strong></div>
        <div>Phase: <strong>${ui.phase}</strong></div>
        <div>Mode: <strong>${ui.gameMode === "vsBot" ? "Vs Bot" : "Hot-seat"}</strong></div>
        <div>Current step: <strong>${currentPhaseHint()}</strong></div>
        <div class="muted">Rerolls left: ${ui.match.rerollsLeftThisTurn}</div>
        ${ui.isBotActing ? '<div class="muted">Bot is thinking...</div>' : ""}
    `;
    statusEl.appendChild(p);
    nextActionEl.innerHTML = `<strong>Next action:</strong> ${nextActionHint()}`;
}

function renderRollPanel(): void {
    rollPanelEl.innerHTML = "";
    const hand = document.createElement("div");
    hand.textContent = `Hand: [${ui.hand.join(", ")}]`;
    rollPanelEl.appendChild(hand);

    const rerollBtn = button("Reroll", applyReroll, !canInteract("roll") || ui.match.rerollsLeftThisTurn <= 0, "Reroll dice hand");
    const keepBtn = button("Keep Hand", keepHandAndGoSlots, !canInteract("roll"), "Keep current hand and continue");
    rollPanelEl.append(rerollBtn, keepBtn);
}

function renderSlotsPanel(): void {
    slotsPanelEl.innerHTML = "";
    if (ui.hand.length === 0) return;
    const slotTips = document.createElement("div");
    slotTips.className = "panel-note muted";
    slotTips.textContent = "Fortify: Поглощает урон при входящей атаке.";
    slotsPanelEl.appendChild(slotTips);

    ui.hand.forEach((die, idx) => {
        const row = document.createElement("div");
        row.textContent = `Die #${idx + 1} (${die}) `;
        const select = document.createElement("select");
        for (const slot of ["build", "fortify", "arm"] as const) {
            const option = document.createElement("option");
            option.value = slot;
            option.textContent = slot;
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

    slotsPanelEl.appendChild(button("Commit Slots", commitSlots, !canInteract("slots"), "Commit selected slots"));
}

function renderBuildPanel(): void {
    buildPanelEl.innerHTML = "";
    const budget = document.createElement("div");
    budget.textContent = `Build budget left: ${ui.buildBudgetLeft}`;
    buildPanelEl.appendChild(budget);
    const buildTip = document.createElement("div");
    buildTip.className = "panel-note muted";
    buildTip.textContent = "Строй рядом со своими блоками/ядром.";
    buildPanelEl.appendChild(buildTip);
    const playerId = ui.match.currentPlayer;
    const hasBuildTargets =
        getValidNewCells(ui.match, playerId).length > 0 || getValidRepairCells(ui.match, playerId, ui.repairUsed).length > 0;
    if (ui.phase === "build" && !hasBuildTargets) {
        const emptyState = document.createElement("div");
        emptyState.className = "muted panel-note";
        emptyState.textContent = "Нельзя строить, попробуй repair или done.";
        buildPanelEl.appendChild(emptyState);
    }

    const typeInput = document.createElement("select");
    ["new", "repair"].forEach((value) => {
        const option = document.createElement("option");
        option.value = value;
        option.textContent = value;
        typeInput.appendChild(option);
    });
    const xInput = numericInput("x");
    const yInput = numericInput("y");
    const spendInput = numericInput("spend");

    const applyBtn = button(
        "Apply Build",
        () => {
            const x = Number(xInput.value);
            const y = Number(yInput.value);
            const spend = Number(spendInput.value);
            if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(spend)) {
                ui.lastMessage = "Build requires integer x, y, spend.";
                render();
                return;
            }
            applyBuild({ type: typeInput.value as "new" | "repair", x, y, spend });
        },
        !canInteract("build")
    );

    const doneBtn = button("Done Build", doneBuild, !canInteract("build"), "Finish build phase");

    buildPanelEl.append(typeInput, xInput, yInput, spendInput, applyBtn, doneBtn);
}

function renderArmPanel(): void {
    armPanelEl.innerHTML = "";
    const armInfo = document.createElement("div");
    const arm = ui.slotResolution?.arm;
    const armColumns = arm?.canFire ? getValidArmColumns(ui.match, ui.match.currentPlayer) : [];
    armInfo.textContent = arm
        ? `Arm max=${arm.max} canFire=${arm.canFire} damage=${arm.damage} pierce=${arm.pierceDepth}`
        : "Arm unavailable before slots commit.";
    armPanelEl.appendChild(armInfo);
    const armTip = document.createElement("div");
    armTip.className = "panel-note muted";
    armTip.textContent = "Выбери колонку для атаки.";
    armPanelEl.appendChild(armTip);
    if (ui.phase === "arm" && (!arm?.canFire || armColumns.length === 0)) {
        const armReason = document.createElement("div");
        armReason.className = "muted panel-note";
        armReason.textContent = `Arm не может стрелять: ${armFailureReason(arm)} Попробуй Skip.`;
        armPanelEl.appendChild(armReason);
    }

    const xInput = numericInput("column x");
    const fireBtn = button(
        "Fire",
        () => {
            const col = parseColumn(xInput.value, ui.match.width);
            if (col === null) {
                ui.lastMessage = `Выбери целую колонку от 0 до ${ui.match.width - 1}.`;
                playtestSession?.playerError(ui.round, ui.match.currentPlayer, "invalid_arm_column");
                render();
                return;
            }
            fireArm(col);
        },
        !canInteract("arm") || !arm?.canFire,
        "Fire selected column"
    );
    const skipBtn = button("Skip", skipArm, !canInteract("arm"), "Skip arm attack");
    const endBtn = button("End Turn", endTurn, !canInteract("end"), "End current turn");
    armPanelEl.append(xInput, fireBtn, skipBtn, endBtn);
}

function renderBoard(): void {
    boardEl.innerHTML = "";
    const playerId = ui.match.currentPlayer;
    const newHints = new Set(getValidNewCells(ui.match, playerId).map((cell) => `${cell.x},${cell.y}`));
    const repairHints = new Set(
        getValidRepairCells(ui.match, playerId, ui.repairUsed).map((cell) => `${cell.x},${cell.y}`)
    );
    const armHints =
        ui.phase === "arm" && ui.slotResolution?.arm.canFire
            ? new Set(getValidArmColumns(ui.match, playerId))
            : new Set<number>();

    for (let x = 0; x < ui.match.width; x++) {
        const header = document.createElement("div");
        header.className = "col-header";
        if (armHints.has(x)) {
            header.classList.add("hint-arm-col");
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
            if (changedCells.has(key)) {
                cell.classList.add("cell-flash");
            }
            cell.title = `(${x},${y})`;
            boardEl.appendChild(cell);
        }
    }
    boardLegendEl.innerHTML = `
        <span class="legend-chip legend-empty">· Empty cell</span>
        <span class="legend-chip legend-block-p0">B0 Player 0 block</span>
        <span class="legend-chip legend-block-p1">B1 Player 1 block</span>
        <span class="legend-chip legend-core-p0">C0 Player 0 core</span>
        <span class="legend-chip legend-core-p1">C1 Player 1 core</span>
        <span class="legend-chip legend-new">Build: new cell</span>
        <span class="legend-chip legend-repair">Build: repair target</span>
        <span class="legend-chip legend-arm">Arm: fireable column</span>
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
        return "Bot resolves this turn automatically.";
    }
    switch (ui.phase) {
        case "roll":
            return "Decide whether to reroll, then keep the hand.";
        case "slots":
            return "Assign each die into Build, Fortify, or Arm.";
        case "build":
            return "Spend Build points or finish build step.";
        case "arm":
            return "Choose a column to fire or skip the attack.";
        case "end":
            return "Confirm end turn to store Fortify charges.";
        default:
            return "Follow the active phase actions.";
    }
}

function nextActionHint(): string {
    if (ui.match.winner !== null) {
        return "Match ended. Choose Play Again or Back to Menu.";
    }
    if (ui.isBotActing) {
        return "Please wait until bot turn ends.";
    }
    if (ui.phase === "build") {
        const playerId = ui.match.currentPlayer;
        const hasTargets =
            getValidNewCells(ui.match, playerId).length > 0 || getValidRepairCells(ui.match, playerId, ui.repairUsed).length > 0;
        if (!hasTargets) {
            return "No valid build targets. Try repair or press Done Build.";
        }
    }
    if (ui.phase === "arm") {
        const arm = ui.slotResolution?.arm;
        const armColumns = arm?.canFire ? getValidArmColumns(ui.match, ui.match.currentPlayer) : [];
        if (!arm?.canFire || armColumns.length === 0) {
            return `Arm is blocked: ${armFailureReason(arm)} Use Skip.`;
        }
    }
    switch (ui.phase) {
        case "roll":
            return ui.match.rerollsLeftThisTurn > 0 ? "Click Reroll or Keep Hand." : "No rerolls left: click Keep Hand.";
        case "slots":
            return "Set each die slot and click Commit Slots.";
        case "build":
            return "Apply build command, then Done Build.";
        case "arm":
            return "Enter a column and fire, or Skip.";
        case "end":
            return "Click End Turn.";
        default:
            return "Continue current phase.";
    }
}

function armFailureReason(arm: DiceFortsSlotResolution["arm"] | null | undefined): string {
    if (!arm || arm.max === null) {
        return "no dice assigned to Arm";
    }
    if (!arm.canFire) {
        return `max die ${arm.max} is below fire threshold`;
    }
    return "no valid enemy targets in any column";
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
        endgameTitleEl.textContent = ui.match.winner === 0 ? "Victory" : "Defeat";
    } else {
        endgameTitleEl.textContent = `Winner: Player ${ui.match.winner ?? "-"}`;
    }
    endgameStatsEl.textContent = `Rounds: ${ui.round} | Core damage P0/P1: ${matchStats.coreDamageByPlayer[0]}/${matchStats.coreDamageByPlayer[1]} | Rerolls P0/P1: ${matchStats.rerollsUsedByPlayer[0]}/${matchStats.rerollsUsedByPlayer[1]}`;
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
        "spend must be >= 1": "Build: укажи spend не меньше 1.",
        "not enough build points": "Build: не хватает build points для этого действия.",
        "out of bounds": "Build: эта клетка вне поля.",
        "cell is not empty": "Build: для new нужна пустая клетка.",
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
        "Playtest mode enabled.\n1) Play naturally and think aloud.\n2) Try one full match.\n3) After the winner, leave 3 ratings and optional comment."
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
    addUiLog("system", "Playtest report exported (JSON + CSV).");
}

function promptPlaytestFeedback(): PlaytestFeedback | null {
    const askRating = (question: string): number | null => {
        const raw = window.prompt(`${question} (1..5)`);
        if (raw === null) return null;
        try {
            return validateFeedbackRating(Number(raw.trim()));
        } catch {
            window.alert("Please enter an integer from 1 to 5.");
            return askRating(question);
        }
    };
    const rulesClarity = askRating("How clear are the rules?");
    if (rulesClarity === null) return null;
    const diceChoiceInterest = askRating("How interesting is dice choice?");
    if (diceChoiceInterest === null) return null;
    const playAgainDesire = askRating("How much do you want to play again?");
    if (playAgainDesire === null) return null;
    const comment = window.prompt("Optional comment:") ?? "";
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
