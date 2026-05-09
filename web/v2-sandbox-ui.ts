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
import { io, Socket } from "socket.io-client";

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

    let socket: Socket | null = null;
    let roomCode: string | null = null;
    let localPlayerIndex: 0 | 1 | null = null;

    const shell = document.createElement("div");
    shell.className = "v2-sandbox-shell";

    const onlinePanel = document.createElement("div");
    onlinePanel.className = "panel";
    onlinePanel.innerHTML = `
        <input id="room-code-input" placeholder="Код комнаты" />
        <button id="btn-create-room">Создать</button>
        <button id="btn-join-room">Присоединиться</button>
        <div id="room-status" class="muted"></div>
    `;

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
            <button class="v2-tab" data-tab="dice">Кубики</button>
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
            <button id="btn-wood">🪵 Дерево</button>
            <button id="btn-metal">⛓️ Металл</button>
            <button id="btn-armor">🛡️ Броня</button>
            <button id="btn-finish-build">Завершить</button>
        </div>
        <div id="tab-content-weapons" class="v2-toolbar hidden">
            <button data-b="machine_gun">🔫 Пулемет</button>
            <button data-b="cannon">💣 Пушка</button>
        </div>
        <div id="tab-content-tech" class="v2-toolbar hidden">
            <button data-b="repair_station">🔧 Ремонт</button>
            <button data-b="tech_station">🔬 Тех-станция</button>
        </div>
        <div id="tab-content-storage" class="v2-toolbar hidden">
            <button data-b="storage_depot">📦 Склад</button>
        </div>
        <div id="tab-content-combat" class="v2-toolbar hidden">
            <div id="weapon-list"></div>
            <button id="btn-next-turn">Конец хода</button>
        </div>
    `;

    shell.append(onlinePanel, info, dicePanel, canvas, bottomPanel, btnBack);
    root.replaceChildren(shell);

    // Online Logic
    function initSocket() {
        if (socket) return;
        socket = io("http://localhost:3000");
        socket.on("room-created", (code) => {
            roomCode = code;
            localPlayerIndex = 0;
            document.getElementById("room-status")!.textContent = `Комната ${code} создана. Ждем игрока 2...`;
        });
        socket.on("room-joined", ({ code, playerIndex }) => {
            roomCode = code;
            localPlayerIndex = playerIndex;
            document.getElementById("room-status")!.textContent = `Присоединились к ${code}. Вы — игрок ${playerIndex}.`;
        });
        socket.on("state-updated", (newState) => {
            // Превращаем Map из Plain Objects обратно в Map
            state = {
                ...newState,
                nodes: new Map(Object.entries(newState.nodes)),
                beams: new Map(Object.entries(newState.beams)),
                buildings: new Map(Object.entries(newState.buildings))
            };
            draw();
        });
    }

    function syncState() {
        if (socket && roomCode) {
            const syncData = {
                ...state,
                nodes: Object.fromEntries(state.nodes),
                beams: Object.fromEntries(state.beams),
                buildings: Object.fromEntries(state.buildings)
            };
            socket.emit("sync-state", { code: roomCode, state: syncData });
        }
    }

    shell.querySelector("#btn-create-room")?.addEventListener("click", () => {
        initSocket();
        const code = (document.getElementById("room-code-input") as HTMLInputElement).value;
        socket?.emit("create-room", code || "1234");
    }, { signal });

    shell.querySelector("#btn-join-room")?.addEventListener("click", () => {
        initSocket();
        const code = (document.getElementById("room-code-input") as HTMLInputElement).value;
        socket?.emit("join-room", code || "1234");
    }, { signal });

    function isLocalTurn() {
        if (localPlayerIndex === null) return true; // Local play
        return state.currentPlayer === localPlayerIndex;
    }

    // Phase & UI updates
    function updateTabs(activeTab: string) {
        currentTab = activeTab;
        shell.querySelectorAll(".v2-tab").forEach(t => t.classList.toggle("active", (t as HTMLElement).dataset.tab === activeTab));
        shell.querySelectorAll(".v2-toolbar").forEach(t => t.classList.add("hidden"));
        shell.querySelector(`#tab-content-${activeTab}`)?.classList.remove("hidden");

        if (activeTab === "dice" && rolledDice.length === 0 && isLocalTurn()) {
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
        if (!isLocalTurn()) return;
        if (state.rerollsLeft > 0) {
            const { results } = rollInitialDice(state, rng);
            rolledDice = rolledDice.map((old, idx) => heldIndices.has(idx) ? old : results[idx]!);
            state = { ...state, rerollsLeft: state.rerollsLeft - 1 };
            renderDice();
        }
    }, { signal });

    shell.querySelector("#btn-apply-dice")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        state = applyDiceResults(state, rolledDice);
        rolledDice = []; heldIndices.clear();
        state = { ...state, turnPhase: "build" };
        updateTabs("build");
        syncState();
    }, { signal });

    shell.querySelector("#btn-finish-build")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        const physState = { nodes: new Map(state.nodes), beams: new Map(state.beams) };
        performCollapse(physState);
        state = { ...state, nodes: physState.nodes, beams: physState.beams, turnPhase: "combat" };
        updateTabs("combat");
        syncState();
    }, { signal });

    shell.querySelector("#btn-next-turn")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        state = { ...state, currentPlayer: state.currentPlayer === 0 ? 1 : 0, turnPhase: "dice", rerollsLeft: 2 };
        activeWeaponId = null;
        updateTabs("dice");
        syncState();
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
                btn.onclick = () => {
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
                if (!isLocalTurn()) return;
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
        if (!isLocalTurn()) return;
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
        ctx.strokeStyle = "#1a2030"; ctx.lineWidth = 1;
        for (let x = 0; x <= V2_GRID_WIDTH; x++) { ctx.beginPath(); ctx.moveTo(x * CELL_SIZE, 0); ctx.lineTo(x * CELL_SIZE, canvas.height); ctx.stroke(); }
        for (let y = 0; y <= V2_GRID_HEIGHT; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL_SIZE); ctx.lineTo(canvas.width, y * CELL_SIZE); ctx.stroke(); }

        for (const beam of state.beams.values()) {
            const nodeA = state.nodes.get(beam.nodeAId)!;
            const nodeB = state.nodes.get(beam.nodeBId)!;
            if (beam.materialId === "wood") ctx.strokeStyle = "#8b4513";
            else if (beam.materialId === "metal") ctx.strokeStyle = "#4682b4";
            else ctx.strokeStyle = "#2f4f4f";
            ctx.lineWidth = beam.materialId === "wood" ? 3 : 5;
            ctx.beginPath(); ctx.moveTo(nodeA.x * CELL_SIZE, nodeA.y * CELL_SIZE); ctx.lineTo(nodeB.x * CELL_SIZE, nodeB.y * CELL_SIZE); ctx.stroke();
            ctx.strokeStyle = beam.owner === 0 ? "rgba(0, 255, 0, 0.3)" : "rgba(255, 0, 0, 0.3)";
            ctx.lineWidth = 1; ctx.stroke();
        }

        for (const node of state.nodes.values()) {
            ctx.fillStyle = node.id === selectedNodeId ? "#fff" : (node.isGround ? "#555" : (node.owner === 0 ? "#0f0" : "#f00"));
            ctx.beginPath(); ctx.arc(node.x * CELL_SIZE, node.y * CELL_SIZE, 4, 0, Math.PI * 2); ctx.fill();
        }

        for (const b of state.buildings.values()) {
            const node = state.nodes.get(b.nodeIds[0]!)!;
            const def = BUILDING_CATALOG[b.defId];
            ctx.fillStyle = b.owner === 0 ? "rgba(0, 255, 0, 0.7)" : "rgba(255, 0, 0, 0.7)";
            if (activeWeaponId === b.id) {
                ctx.strokeStyle = "#fff"; ctx.lineWidth = 2;
                ctx.strokeRect(node.x * CELL_SIZE - 12, node.y * CELL_SIZE - 12, 24, 24);
            }
            ctx.fillRect(node.x * CELL_SIZE - 10, node.y * CELL_SIZE - 10, 20, 20);
            ctx.fillStyle = "#fff"; ctx.font = "10px monospace";
            ctx.fillText(def.name[0], node.x * CELL_SIZE - 3, node.y * CELL_SIZE + 4);
            if (!b.isOperational) {
                ctx.strokeStyle = "#f00"; ctx.lineWidth = 2;
                ctx.beginPath(); ctx.moveTo(node.x*CELL_SIZE-10, node.y*CELL_SIZE-10); ctx.lineTo(node.x*CELL_SIZE+10, node.y*CELL_SIZE+10); ctx.stroke();
            }
        }

        const eco = state.economy[state.currentPlayer].resources;
        const caps = state.economy[state.currentPlayer].caps;
        info.innerHTML = `[SYS] PLAYER_${state.currentPlayer} | PHASE: ${state.turnPhase.toUpperCase()} | STEEL: ${eco.steel ?? 0}/${caps.steel} | AMMO: ${eco.ammo ?? 0}/${caps.ammo}`;
    }

    updateTabs("dice");
    draw();

    return () => {
        socket?.disconnect();
        ac.abort();
        root.replaceChildren();
    };
}
