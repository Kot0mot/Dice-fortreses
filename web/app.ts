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

type UiPhase = "roll" | "slots" | "build" | "arm" | "end";

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
}

const statusEl = requireElement("status");
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
const MAX_LOG_EVENTS = 200;
const DISPLAY_LOG_EVENTS = 30;
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

const initialSeed = Math.floor(Date.now());
let runSeed = initialSeed;
let rng = new DiceFortsRng(initialSeed);
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
};

startTurn();
setupRunControls();
setupLogControls();
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
    runControlsEl.append(
        playtestToggleBtn,
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
        };
        ui.lastMessage = `Run loaded (format ${saved.formatVersion}). Continue from phase "${ui.phase}".`;
        addUiLog("system", ui.lastMessage);
    } catch (error) {
        ui.lastMessage = error instanceof Error ? `Load failed: ${error.message}` : "Load failed: unknown error.";
        addUiLog("system", ui.lastMessage);
    }
    render();
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
    ui.lastMessage = `Player ${ui.match.currentPlayer} rolled [${ui.hand.join(", ")}]`;
    addUiLog("dice", ui.lastMessage);
    playtestSession?.turnStarted(ui.round, ui.match.currentPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
    render();
}

function canInteract(phase: UiPhase): boolean {
    return ui.phase === phase && ui.match.winner === null;
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
        ui.lastMessage = "Slot assignment mismatch.";
        playtestSession?.playerError(ui.round, ui.match.currentPlayer, "slot_assignment_mismatch");
        render();
        return;
    }
    if (!isValidSlotPartition(ui.hand, slots)) {
        ui.lastMessage = "Slot partition is invalid for the current hand.";
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
        ui.lastMessage = `Build rejected: ${err}`;
        playtestSession?.playerError(ui.round, ui.match.currentPlayer, `invalid_build:${err}`);
        render();
        return;
    }

    const out = applyBuildCommand(ui.match, pid, cmd, ui.buildBudgetLeft, ui.repairUsed);
    if (!out) {
        ui.lastMessage = "Build command failed unexpectedly.";
        render();
        return;
    }

    ui.match = out.state;
    ui.buildBudgetLeft = out.budget;
    ui.lastMessage = `Build applied: ${cmd.type} at (${cmd.x},${cmd.y}) spend ${cmd.spend}.`;
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
        ui.lastMessage = "Arm cannot fire for this slot setup. Use Skip.";
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
    ui.match = out.state;
    ui.match = patchPlayerSecrets(ui.match, defId, { savedFortifyCharges: out.chargesRemaining });
    ui.phase = "end";
    playtestSession?.armAction(ui.round, ui.match.currentPlayer, false, column);
    ui.lastMessage = `Arm fired at x=${column}. Hits=${out.targetsHit.length}.`;
    addUiLog("combat", ui.lastMessage);
    out.targetsHit.forEach((target, idx) => {
        const fortify = out.fortifyApplications[idx];
        if (fortify && fortify.absorbed > 0) {
            addUiLog(
                "combat",
                `Fortify absorbed ${fortify.absorbed} damage at (${target.x},${target.y}); charges ${fortify.chargesBefore}->${fortify.chargesAfter}.`
            );
        }
        if (target.kind === "core") {
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
        render();
        return;
    }
    ui.match = advanceCurrentPlayer(ui.match);
    playtestSession?.turnEnded(ui.round, endingPlayer, coreHp(ui.match, 0), coreHp(ui.match, 1));
    ui.round += 1;
    startTurn();
}

function render(): void {
    renderStatus();
    renderRollPanel();
    renderSlotsPanel();
    renderBuildPanel();
    renderArmPanel();
    renderBoard();
    renderLogPanel();
}

function renderLogPanel(): void {
    const filtered = filterUiLogEntries(uiLogEntries, uiLogFilters);
    const entries = filtered.slice(Math.max(0, filtered.length - DISPLAY_LOG_EVENTS));
    logListEl.innerHTML = "";
    if (entries.length === 0) {
        const empty = document.createElement("div");
        empty.className = "muted";
        empty.textContent = "No events for selected filters";
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
        <div class="muted">Rerolls left: ${ui.match.rerollsLeftThisTurn}</div>
    `;
    statusEl.appendChild(p);
}

function renderRollPanel(): void {
    rollPanelEl.innerHTML = "";
    const hand = document.createElement("div");
    hand.textContent = `Hand: [${ui.hand.join(", ")}]`;
    rollPanelEl.appendChild(hand);

    const rerollBtn = button("Reroll", applyReroll, !canInteract("roll") || ui.match.rerollsLeftThisTurn <= 0);
    const keepBtn = button("Keep Hand", keepHandAndGoSlots, !canInteract("roll"));
    rollPanelEl.append(rerollBtn, keepBtn);
}

function renderSlotsPanel(): void {
    slotsPanelEl.innerHTML = "";
    if (ui.hand.length === 0) return;

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

    slotsPanelEl.appendChild(button("Commit Slots", commitSlots, !canInteract("slots")));
}

function renderBuildPanel(): void {
    buildPanelEl.innerHTML = "";
    const budget = document.createElement("div");
    budget.textContent = `Build budget left: ${ui.buildBudgetLeft}`;
    buildPanelEl.appendChild(budget);

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

    const doneBtn = button("Done Build", doneBuild, !canInteract("build"));

    buildPanelEl.append(typeInput, xInput, yInput, spendInput, applyBtn, doneBtn);
}

function renderArmPanel(): void {
    armPanelEl.innerHTML = "";
    const armInfo = document.createElement("div");
    const arm = ui.slotResolution?.arm;
    armInfo.textContent = arm
        ? `Arm max=${arm.max} canFire=${arm.canFire} damage=${arm.damage} pierce=${arm.pierceDepth}`
        : "Arm unavailable before slots commit.";
    armPanelEl.appendChild(armInfo);

    const xInput = numericInput("column x");
    const fireBtn = button(
        "Fire",
        () => {
            const col = parseColumn(xInput.value, ui.match.width);
            if (col === null) {
                ui.lastMessage = `Column must be integer in [0..${ui.match.width - 1}]`;
                playtestSession?.playerError(ui.round, ui.match.currentPlayer, "invalid_arm_column");
                render();
                return;
            }
            fireArm(col);
        },
        !canInteract("arm") || !arm?.canFire
    );
    const skipBtn = button("Skip", skipArm, !canInteract("arm"));
    const endBtn = button("End Turn", endTurn, !canInteract("end"));
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
            cell.title = `(${x},${y})`;
            boardEl.appendChild(cell);
        }
    }
    boardLegendEl.innerHTML = `
        <span class="legend-chip legend-new">Build: new cell</span>
        <span class="legend-chip legend-repair">Build: repair target</span>
        <span class="legend-chip legend-arm">Arm: fireable column</span>
    `;
}

function button(label: string, onClick: () => void, disabled: boolean): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = label;
    btn.disabled = disabled;
    btn.addEventListener("click", onClick);
    return btn;
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
