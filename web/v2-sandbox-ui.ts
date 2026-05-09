/**
 * Расширенный UI для v2 sandbox (узлы, балки, фазы)
 */
import { DiceFortsRng } from "../src/random.js";
import { createInitialV2Match, tryPlaceNode, tryPlaceBeam, tryPlaceBuilding, type V2MatchState } from "../src/v2/matchState.js";
import { V2_GRID_WIDTH, V2_GRID_HEIGHT } from "../src/v2/constants.js";
import { BEAM_MATERIALS, type BeamMaterialId } from "../src/v2/mapTypes.js";
import { rollInitialDice, applyDiceResults } from "../src/v2/diceSystems.js";
import type { RolledDieResult } from "../src/v2/customDie.js";
import { performCollapse } from "../src/v2/physics.js";
import { fireWeapon, isWithinFiringCone } from "../src/v2/combat.js";
import { BUILDING_CATALOG } from "../src/v2/catalog.js";

const CELL_SIZE = 20;

export function mountV2Sandbox(root: HTMLElement, opts: { readonly seed: number; readonly onBack: () => void }): () => void {
    const ac = new AbortController();
    const { signal } = ac;

    let state: V2MatchState = createInitialV2Match();
    const rng = new DiceFortsRng(opts.seed);
    let selectedNodeId: string | null = null;
    let selectedMaterial: BeamMaterialId = "wood";
    let selectedBuildingId: string | null = null;
    let rolledDice: RolledDieResult[] = [];
    let heldIndices = new Set<number>();
    let currentTab = "dice";
    let activeWeaponId: string | null = null;
    const weaponGroups: Map<string, string[]> = new Map(); // "1" -> [weaponId, ...]

    const shell = document.createElement("div");
    shell.className = "v2-sandbox-shell";

    const canvas = document.createElement("canvas");
    canvas.width = V2_GRID_WIDTH * CELL_SIZE;
    canvas.height = V2_GRID_HEIGHT * CELL_SIZE;
    canvas.className = "v2-canvas";
    const ctx = canvas.getContext("2d")!;

    const info = document.createElement("div");
    info.className = "v2-info panel";

    const dicePanel = document.createElement("div");
    dicePanel.className = "v2-dice-panel panel";

    const btnBack = document.createElement("button");
    btnBack.textContent = "В меню";
    btnBack.onclick = opts.onBack;

    const bottomPanel = document.createElement("div");
    bottomPanel.className = "v2-bottom-panel panel";
    bottomPanel.innerHTML = `
        <div class="v2-tabs">
            <button class="v2-tab active" data-tab="dice">Кубики</button>
            <button class="v2-tab" data-tab="build">Стройка</button>
            <button class="v2-tab" data-tab="weapons">Оружие</button>
            <button class="v2-tab" data-tab="tech">Технологии</button>
            <button class="v2-tab" data-tab="storage">Склады</button>
            <button class="v2-tab" data-tab="combat">Бой</button>
        </div>
        <div id="tab-content-dice" class="v2-toolbar">
            <button id="btn-roll">Бросить</button>
            <button id="btn-apply-dice">Принять</button>
            <span id="rerolls-count"></span>
        </div>
        <div id="tab-content-build" class="v2-toolbar hidden">
            <button id="btn-wood" title="Wood">🪵</button>
            <button id="btn-metal" title="Metal">⛓️</button>
            <button id="btn-armor" title="Armor">🛡️</button>
            <button id="btn-finish-build">Завершить</button>
        </div>
        <div id="tab-content-weapons" class="v2-toolbar hidden">
            <button data-b="machine_gun">Пулемет</button>
            <button data-b="cannon">Пушка</button>
        </div>
        <div id="tab-content-tech" class="v2-toolbar hidden">
            <button data-b="repair_station">Ремонт</button>
            <button data-b="tech_station">Тех-станция</button>
        </div>
        <div id="tab-content-storage" class="v2-toolbar hidden">
            <button data-b="storage_depot">Склад</button>
        </div>
        <div id="tab-content-combat" class="v2-toolbar hidden">
            <div id="weapon-list"></div>
            <span class="muted">Нажми Shift+Клик для группы. Клавиши 1-9 для выбора.</span>
            <button id="btn-next-turn">Конец хода</button>
        </div>
    `;

    shell.append(info, dicePanel, canvas, bottomPanel, btnBack);
    root.replaceChildren(shell);

    function updateTabs(activeTab: string) {
        currentTab = activeTab;
        shell.querySelectorAll(".v2-tab").forEach(t => t.classList.toggle("active", (t as HTMLElement).dataset.tab === activeTab));
        shell.querySelectorAll(".v2-toolbar").forEach(t => t.classList.add("hidden"));
        shell.querySelector(`#tab-content-${activeTab}`)?.classList.remove("hidden");

        if (activeTab === "dice" && rolledDice.length === 0) {
            const { results, nextState } = rollInitialDice(state, rng);
            rolledDice = results;
            state = nextState;
            renderDice();
        }
        if (activeTab === "combat") renderWeaponList();
        draw();
    }

    shell.querySelectorAll(".v2-tab").forEach(t => t.addEventListener("click", () => updateTabs((t as HTMLElement).dataset.tab!), { signal }));

    shell.querySelector("#btn-roll")?.addEventListener("click", () => {
        if (state.rerollsLeft > 0) {
            const { results } = rollInitialDice(state, rng);
            rolledDice = rolledDice.map((old, idx) => heldIndices.has(idx) ? old : results[idx]!);
            state = { ...state, rerollsLeft: state.rerollsLeft - 1 };
            renderDice();
        }
    }, { signal });

    shell.querySelector("#btn-apply-dice")?.addEventListener("click", () => {
        state = applyDiceResults(state, rolledDice);
        rolledDice = []; heldIndices.clear();
        state = { ...state, turnPhase: "build" };
        updateTabs("build");
    }, { signal });

    shell.querySelector("#btn-finish-build")?.addEventListener("click", () => {
        const physState = { nodes: new Map(state.nodes), beams: new Map(state.beams) };
        performCollapse(physState);
        state = { ...state, nodes: physState.nodes, beams: physState.beams, turnPhase: "combat" };
        updateTabs("combat");
    }, { signal });

    shell.querySelector("#btn-next-turn")?.addEventListener("click", () => {
        state = { ...state, currentPlayer: state.currentPlayer === 0 ? 1 : 0, turnPhase: "dice", rerollsLeft: 2 };
        activeWeaponId = null;
        updateTabs("dice");
    }, { signal });

    shell.querySelectorAll(".v2-toolbar button[data-b]").forEach(btn => btn.addEventListener("click", () => {
        selectedBuildingId = (btn as HTMLElement).dataset.b!;
        shell.querySelectorAll(".v2-toolbar button[data-b]").forEach(b => b.classList.remove("active"));
        btn.classList.add("active");
    }, { signal }));

    function renderWeaponList() {
        const list = shell.querySelector("#weapon-list")!;
        list.innerHTML = "";
        for (const b of state.buildings.values()) {
            if (b.owner === state.currentPlayer && BUILDING_CATALOG[b.defId].kind === "weapon") {
                const btn = document.createElement("button");
                btn.textContent = BUILDING_CATALOG[b.defId].name;
                btn.onclick = (e) => {
                    if (e.shiftKey) {
                        // Группировка: для простоты просто выделяем для огня несколько
                    }
                    activeWeaponId = b.id;
                    renderWeaponList();
                };
                if (activeWeaponId === b.id) btn.classList.add("active");
                list.appendChild(btn);
            }
        }
    }

    function renderDice() {
        dicePanel.innerHTML = "";
        rolledDice.forEach((d, idx) => {
            const dieEl = document.createElement("button");
            dieEl.className = `v2-die ${heldIndices.has(idx) ? "held" : ""}`;
            dieEl.textContent = `${d.yield.resourceId || d.yield.effectId}: ${d.yield.amount || ""}`;
            dieEl.onclick = () => {
                if (heldIndices.has(idx)) heldIndices.delete(idx);
                else heldIndices.add(idx);
                renderDice();
            };
            dicePanel.appendChild(dieEl);
        });
        const rerollsEl = shell.querySelector("#rerolls-count");
        if (rerollsEl) rerollsEl.textContent = `Перебросов: ${state.rerollsLeft}`;
    }

    function getMousePos(evt: MouseEvent) {
        const rect = canvas.getBoundingClientRect();
        return {
            x: Math.round((evt.clientX - rect.left) / CELL_SIZE),
            y: Math.round((evt.clientY - rect.top) / CELL_SIZE),
            rawX: evt.clientX - rect.left,
            rawY: evt.clientY - rect.top
        };
    }

    canvas.addEventListener("click", (evt) => {
        const pos = getMousePos(evt);
        if (currentTab === "build") {
            const clickedNode = Array.from(state.nodes.values()).find(n => n.x === pos.x && n.y === pos.y);
            if (clickedNode) {
                if (selectedNodeId && selectedNodeId !== clickedNode.id) {
                    state = tryPlaceBeam(state, selectedNodeId, clickedNode.id, selectedMaterial, state.currentPlayer);
                    selectedNodeId = null;
                } else {
                    selectedNodeId = clickedNode.id;
                }
            } else {
                state = tryPlaceNode(state, pos.x, pos.y, state.currentPlayer);
                const newNodeId = `node-${state.currentPlayer}-${pos.x}-${pos.y}`;
                if (selectedNodeId) {
                    state = tryPlaceBeam(state, selectedNodeId, newNodeId, selectedMaterial, state.currentPlayer);
                    selectedNodeId = null;
                }
            }
        } else if (["weapons", "tech", "storage"].includes(currentTab) && selectedBuildingId) {
            const clickedNode = Array.from(state.nodes.values()).find(n => n.x === pos.x && n.y === pos.y);
            if (clickedNode) {
                state = tryPlaceBuilding(state, selectedBuildingId, [clickedNode.id], state.currentPlayer);
            }
        } else if (currentTab === "combat" && activeWeaponId) {
            const { nextState, result } = fireWeapon(state, activeWeaponId, pos.x, pos.y);
            state = nextState;
            if (result && result.hitBuildingId) {
                const physState = { nodes: new Map(state.nodes), beams: new Map(state.beams) };
                performCollapse(physState);
                state = { ...state, nodes: physState.nodes, beams: physState.beams };
            }
        }
        draw();
    }, { signal });

    window.addEventListener("keydown", (e) => {
        if (currentTab === "combat" && e.key >= "1" && e.key <= "9") {
            const weapons = Array.from(state.buildings.values()).filter(b => b.owner === state.currentPlayer && BUILDING_CATALOG[b.defId].kind === "weapon");
            const idx = parseInt(e.key) - 1;
            if (weapons[idx]) {
                activeWeaponId = weapons[idx]!.id;
                renderWeaponList();
                draw();
            }
        }
    }, { signal });

    canvas.addEventListener("mousemove", (evt) => {
        if (currentTab === "combat" && activeWeaponId) {
            draw();
            const pos = getMousePos(evt);
            const weapon = state.buildings.get(activeWeaponId)!;
            const node = state.nodes.get(weapon.nodeIds[0]!)!;

            ctx.setLineDash([5, 5]);
            ctx.strokeStyle = isWithinFiringCone(node.x, node.y, pos.x, pos.y, state.currentPlayer) ? "#0f0" : "#f00";
            ctx.beginPath();
            ctx.moveTo(node.x * CELL_SIZE, node.y * CELL_SIZE);
            ctx.lineTo(pos.rawX, pos.rawY);
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, { signal });

    shell.querySelector("#btn-wood")?.addEventListener("click", () => selectedMaterial = "wood", { signal });
    shell.querySelector("#btn-metal")?.addEventListener("click", () => selectedMaterial = "metal", { signal });
    shell.querySelector("#btn-armor")?.addEventListener("click", () => selectedMaterial = "armor_plating", { signal });

    function draw() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.strokeStyle = "#333"; ctx.lineWidth = 0.5;
        for (let x = 0; x <= V2_GRID_WIDTH; x++) { ctx.beginPath(); ctx.moveTo(x * CELL_SIZE, 0); ctx.lineTo(x * CELL_SIZE, canvas.height); ctx.stroke(); }
        for (let y = 0; y <= V2_GRID_HEIGHT; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL_SIZE); ctx.lineTo(canvas.width, y * CELL_SIZE); ctx.stroke(); }

        for (const beam of state.beams.values()) {
            const nodeA = state.nodes.get(beam.nodeAId)!;
            const nodeB = state.nodes.get(beam.nodeBId)!;
            ctx.strokeStyle = beam.owner === 0 ? "#4a9" : "#a49";
            ctx.lineWidth = beam.materialId === "wood" ? 2 : 4;
            ctx.beginPath(); ctx.moveTo(nodeA.x * CELL_SIZE, nodeA.y * CELL_SIZE); ctx.lineTo(nodeB.x * CELL_SIZE, nodeB.y * CELL_SIZE); ctx.stroke();
        }

        for (const node of state.nodes.values()) {
            ctx.fillStyle = node.id === selectedNodeId ? "#fff" : (node.isGround ? "#888" : (node.owner === 0 ? "#4a9" : "#a49"));
            ctx.beginPath(); ctx.arc(node.x * CELL_SIZE, node.y * CELL_SIZE, 4, 0, Math.PI * 2); ctx.fill();
        }

        for (const b of state.buildings.values()) {
            const node = state.nodes.get(b.nodeIds[0]!)!;
            ctx.fillStyle = b.owner === 0 ? "#2f2" : "#f22";
            if (activeWeaponId === b.id) ctx.strokeStyle = "#fff", ctx.lineWidth = 2, ctx.strokeRect(node.x * CELL_SIZE - 12, node.y * CELL_SIZE - 12, 24, 24);
            ctx.fillRect(node.x * CELL_SIZE - 10, node.y * CELL_SIZE - 10, 20, 20);
            if (!b.isOperational) {
                ctx.strokeStyle = "#f00"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(node.x*CELL_SIZE-10, node.y*CELL_SIZE-10); ctx.lineTo(node.x*CELL_SIZE+10, node.y*CELL_SIZE+10); ctx.stroke();
            }
        }

        const eco = state.economy[state.currentPlayer].resources;
        const caps = state.economy[state.currentPlayer].caps;
        info.innerHTML = `Ход: Игрок ${state.currentPlayer} | Фаза: ${state.turnPhase} | Steel: ${eco.steel ?? 0}/${caps.steel} | Ammo: ${eco.ammo ?? 0}/${caps.ammo}`;
    }

    updateTabs("dice");
    draw();

    return () => {
        ac.abort();
        root.replaceChildren();
    };
}
