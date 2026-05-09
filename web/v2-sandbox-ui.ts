/**
 * Расширенный UI для v2 sandbox (узлы, балки, фазы)
 */
import { DiceFortsRng } from "../src/random.js";
import { createInitialV2Match, tryPlaceNode, tryPlaceBeam, tryPlaceBuilding, tryUpgradeBuilding, tryRepairBuilding, tryRepairAll, tryDeleteBuilding, tryDeleteBeam, type V2MatchState } from "../src/v2/matchState.js";
import { V2_GRID_WIDTH, V2_GRID_HEIGHT } from "../src/v2/constants.js";
import { BEAM_MATERIALS, type BeamMaterialId } from "../src/v2/mapTypes.js";
import { rollInitialDice, applyDiceResults } from "../src/v2/diceSystems.js";
import type { RolledDieResult } from "../src/v2/customDie.js";
import { performCollapse, calculateLoads } from "../src/v2/physics.js";
import { fireWeapon, isWithinFiringCone, type FiringResult } from "../src/v2/combat.js";
import { runAiTurn, type AiDifficulty } from "../src/v2/ai.js";
import { V2_CAMPAIGN_STAGES, createInitialCampaign, applyCampaignPerks, getRandomPerkOptions, type CampaignState, CAMPAIGN_PERKS } from "../src/v2/campaign.js";
import { BUILDING_CATALOG } from "../src/v2/catalog.js";
import { io, Socket } from "socket.io-client";
import { playUiClick, playPlaceSound, playFireSound, playExplosionSound } from "./audio.js";

const CELL_SIZE = 20;

interface AnimatedProjectile {
    result: FiringResult;
    progress: number;
}

interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    life: number;
    color: string;
}

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
    let activeWeaponIds: string[] = [];
    let projectiles: AnimatedProjectile[] = [];
    let particles: Particle[] = [];
    let screenShake = 0;
    let mousePos = { x: 0, y: 0, rawX: 0, rawY: 0 };

    let socket: Socket | null = null;
    let roomCode: string | null = null;
    let localPlayerIndex: 0 | 1 | null = null;
    let vsAiDifficulty: AiDifficulty | null = null;
    let campaign: CampaignState | null = null;
    let animId: number | null = null;

    const shell = document.createElement("div");
    shell.className = "v2-sandbox-shell";

    const onlinePanel = document.createElement("div");
    onlinePanel.className = "panel";
    onlinePanel.innerHTML = `
        <div style="display:flex; gap: 10px; align-items:center;">
            <input id="room-code-input" placeholder="Код комнаты" style="width:100px" />
            <button id="btn-create-room">Создать</button>
            <button id="btn-join-room">Присоединиться</button>
            <div class="divider"></div>
            <span>VS AI:</span>
            <select id="select-ai-difficulty">
                <option value="none">None</option>
                <option value="easy">Easy</option>
                <option value="medium">Medium</option>
                <option value="hard">Hard</option>
            </select>
            <button id="btn-start-ai">Start AI Match</button>
            <div class="divider"></div>
            <button id="btn-start-campaign">Campaign Mode</button>
        </div>
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
            <button id="btn-shield">💠 Щит</button>
            <button id="btn-repair-all">🔧 Чинить всё</button>
            <button id="btn-finish-build">Завершить</button>
        </div>
        <div id="tab-content-weapons" class="v2-toolbar hidden">
            <button data-b="machine_gun">🔫 Пулемет</button>
            <button data-b="cannon">💣 Пушка</button>
            <button data-b="laser_turret">🔦 Лазер</button>
        </div>
        <div id="tab-content-tech" class="v2-toolbar hidden">
            <button data-b="repair_station">🔧 Ремонт</button>
            <button data-b="tech_station">🔬 Тех-станция</button>
            <button data-b="steel_foundry">🏗️ Завод стали</button>
            <button data-b="power_plant">⚡ Электростанция</button>
            <button data-b="ammo_factory">🏭 Завод БК</button>
        </div>
        <div id="tab-content-storage" class="v2-toolbar hidden">
            <button data-b="storage_steel">📦 Склад стали</button>
            <button data-b="storage_ammo">🧨 Склад БК</button>
            <button data-b="storage_power">🔋 Батарея</button>
        </div>
        <div id="tab-content-combat" class="v2-toolbar hidden">
            <div id="weapon-list"></div>
            <button id="btn-next-turn">Конец хода</button>
        </div>
    `;

    const tooltip = document.createElement("div");
    tooltip.className = "v2-tooltip hidden";
    shell.append(onlinePanel, info, dicePanel, canvas, bottomPanel, btnBack, tooltip);
    root.replaceChildren(shell);

    function createExplosion(x: number, y: number, type: "impact" | "collapse" | "upgrade" = "impact") {
        if (type !== "upgrade") playExplosionSound();
        const count = type === "impact" ? 30 : 15;
        const color = type === "upgrade" ? "#0f0" : (type === "impact" ? "#ff0" : "#8b4513");
        for (let i = 0; i < count; i++) {
            particles.push({
                x, y,
                vx: (Math.random() - 0.5) * (type === "upgrade" ? 5 : 12),
                vy: (Math.random() - 0.5) * (type === "upgrade" ? 5 : 12),
                life: 1,
                color
            });
        }
        if (type !== "upgrade") screenShake = Math.max(screenShake, type === "impact" ? 12 : 5);
    }

    // Context Menu Logic
    canvas.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        if (!isLocalTurn() || currentTab !== "build") return;
        const pos = getMousePos(e);

        // Check building click
        const clickedBuilding = Array.from(state.buildings.values()).find(b => {
            const node = state.nodes.get(b.nodeIds[0]!)!;
            return Math.abs(node.x - pos.x) < 1.5 && Math.abs(node.y - pos.y) < 1.5;
        });

        if (clickedBuilding && clickedBuilding.owner === state.currentPlayer) {
            const menuItems = [
                { label: `Upgrade (Lv${clickedBuilding.level} -> ${clickedBuilding.level + 1})`, action: () => {
                    const next = tryUpgradeBuilding(state, clickedBuilding.id);
                    if (next !== state) {
                        state = next;
                        const node = state.nodes.get(clickedBuilding.nodeIds[0]!)!;
                        createExplosion(node.x * CELL_SIZE, node.y * CELL_SIZE, "upgrade");
                        syncState();
                    }
                }},
                { label: "Repair (Steel: 2)", action: () => {
                    state = tryRepairBuilding(state, clickedBuilding.id);
                    syncState();
                }},
                { label: "Delete", action: () => {
                    state = tryDeleteBuilding(state, clickedBuilding.id);
                    syncState();
                }}
            ];
            showContextMenu(e.clientX, e.clientY, menuItems);
            return;
        }

        // Check beam click (approximate)
        const clickedBeam = Array.from(state.beams.values()).find(b => {
            const nA = state.nodes.get(b.nodeAId)!;
            const nB = state.nodes.get(b.nodeBId)!;
            const dist = distToSegment({ x: pos.x, y: pos.y }, nA, nB);
            return dist < 0.5;
        });

        if (clickedBeam && clickedBeam.owner === state.currentPlayer) {
            showContextMenu(e.clientX, e.clientY, [
                { label: "Delete Beam", action: () => {
                    state = tryDeleteBeam(state, clickedBeam.id);
                    syncState();
                }}
            ]);
        }
    });

    function distToSegment(p: { x: number, y: number }, a: { x: number, y: number }, b: { x: number, y: number }) {
        const l2 = (a.x - b.x)**2 + (a.y - b.y)**2;
        if (l2 === 0) return Math.sqrt((p.x - a.x)**2 + (p.y - a.y)**2);
        let t = ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / l2;
        t = Math.max(0, Math.min(1, t));
        return Math.sqrt((p.x - (a.x + t * (b.x - a.x)))**2 + (p.y - (a.y + t * (b.y - a.y)))**2);
    }

    function showContextMenu(x: number, y: number, items: {label: string, action: () => void}[]) {
        const existing = document.querySelector(".context-menu");
        if (existing) existing.remove();

        const menu = document.createElement("div");
        menu.className = "context-menu";
        menu.style.left = `${x}px`;
        menu.style.top = `${y}px`;

        items.forEach(item => {
            const btn = document.createElement("button");
            btn.textContent = item.label;
            btn.onclick = () => { item.action(); menu.remove(); };
            menu.appendChild(btn);
        });

        document.body.appendChild(menu);
        const close = () => { menu.remove(); document.removeEventListener("click", close); };
        setTimeout(() => document.addEventListener("click", close), 10);
    }

    // Online Logic (Simplified for reuse)
    function initSocket() {
        if (socket) return;
        socket = io("http://localhost:3000");
        socket.on("room-created", (code) => { roomCode = code; localPlayerIndex = 0; document.getElementById("room-status")!.textContent = `Комната ${code} создана. Ждем игрока 2...`; });
        socket.on("room-joined", ({ code, playerIndex }) => { roomCode = code; localPlayerIndex = playerIndex; document.getElementById("room-status")!.textContent = `Присоединились к ${code}. Вы — игрок ${playerIndex}.`; });
        socket.on("state-updated", (newState) => {
            state = {
                ...newState,
                nodes: new Map(Object.entries(newState.nodes)),
                beams: new Map(Object.entries(newState.beams)),
                buildings: new Map(Object.entries(newState.buildings))
            };
            draw();
        });
    }
    function syncState() { if (socket && roomCode) { const syncData = { ...state, nodes: Object.fromEntries(state.nodes), beams: Object.fromEntries(state.beams), buildings: Object.fromEntries(state.buildings) }; socket.emit("sync-state", { code: roomCode, state: syncData }); } }
    function isLocalTurn() { return localPlayerIndex === null || state.currentPlayer === localPlayerIndex; }

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

    shell.querySelectorAll(".v2-tab").forEach(t => t.addEventListener("click", () => {
        playUiClick();
        updateTabs((t as HTMLElement).dataset.tab!);
    }, { signal }));

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
        playUiClick();
        state = applyDiceResults(state, rolledDice);
        rolledDice = []; heldIndices.clear();
        state = { ...state, turnPhase: "build" };
        updateTabs("build");
        syncState();
    }, { signal });

    shell.querySelector("#btn-repair-all")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        playUiClick();
        state = tryRepairAll(state, state.currentPlayer);
        syncState();
    }, { signal });

    shell.querySelector("#btn-finish-build")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        const physState = { nodes: new Map(state.nodes), beams: new Map(state.beams), buildings: new Map(state.buildings) };
        const { collapsedBeams } = performCollapse(physState);
        collapsedBeams.forEach(bid => {
            const b = state.beams.get(bid);
            if (b) {
                const nA = state.nodes.get(b.nodeAId)!;
                const nB = state.nodes.get(b.nodeBId)!;
                createExplosion((nA.x + nB.x) / 2 * CELL_SIZE, (nA.y + nB.y) / 2 * CELL_SIZE, "collapse");
            }
        });
        state = { ...state, nodes: physState.nodes, beams: physState.beams, buildings: physState.buildings!, turnPhase: "combat" };
        updateTabs("combat");
        syncState();
    }, { signal });

    shell.querySelector("#btn-next-turn")?.addEventListener("click", () => {
        if (!isLocalTurn()) return;
        state = { ...state, currentPlayer: state.currentPlayer === 0 ? 1 : 0, turnPhase: "dice", rerollsLeft: 2 };
        activeWeaponIds = [];
        updateTabs("dice");
        syncState();

        if (vsAiDifficulty && state.currentPlayer === 1) {
            setTimeout(() => {
                const aiResult = runAiTurn(state, vsAiDifficulty!, rng);
                state = aiResult.nextState;
                console.log("AI Actions:", aiResult.actions);
                updateTabs("dice");
                syncState();
            }, 1000);
        }
    }, { signal });

    shell.querySelectorAll(".v2-toolbar button[data-b]").forEach(btn => {
        const bId = (btn as HTMLElement).dataset.b!;
        btn.addEventListener("click", () => {
            selectedBuildingId = bId;
            shell.querySelectorAll(".v2-toolbar button[data-b]").forEach(b => b.classList.remove("active"));
            btn.classList.add("active");
        }, { signal });

        btn.addEventListener("mouseenter", (e) => {
            const def = BUILDING_CATALOG[bId];
            if (!def) return;
            tooltip.innerHTML = `
                <strong>${def.name}</strong><br>
                Cost: ${def.cost.steel} Steel<br>
                HP: ${def.maxHp}<br>
                ${def.techRequired ? `<small>Requires: ${def.techRequired}</small>` : ""}
            `;
            tooltip.classList.remove("hidden");
            const rect = btn.getBoundingClientRect();
            tooltip.style.left = `${rect.left}px`;
            tooltip.style.top = `${rect.top - 80}px`;
        });
        btn.addEventListener("mouseleave", () => tooltip.classList.add("hidden"));
    });

    function renderWeaponList() {
        const list = shell.querySelector("#weapon-list")!;
        list.innerHTML = "";
        const weapons = Array.from(state.buildings.values()).filter(b => b.owner === state.currentPlayer && BUILDING_CATALOG[b.defId].kind === "weapon");

        weapons.forEach((b, idx) => {
            const btn = document.createElement("button");
            btn.textContent = `[${idx+1}] ${BUILDING_CATALOG[b.defId].name} (Lv${b.level})`;
            btn.onclick = (e) => {
                if (e.shiftKey) {
                    if (activeWeaponIds.includes(b.id)) {
                        activeWeaponIds = activeWeaponIds.filter(id => id !== b.id);
                    } else if (activeWeaponIds.length < 3) {
                        activeWeaponIds.push(b.id);
                    }
                } else {
                    activeWeaponIds = [b.id];
                }
                renderWeaponList();
            };
            if (activeWeaponIds.includes(b.id)) btn.classList.add("active");
            list.appendChild(btn);
        });
    }

    window.addEventListener("keydown", (e) => {
        if (appState.screen !== "v2sandbox" || currentTab !== "combat") return;
        const num = parseInt(e.key);
        if (num >= 1 && num <= 9) {
            const weapons = Array.from(state.buildings.values()).filter(b => b.owner === state.currentPlayer && BUILDING_CATALOG[b.defId].kind === "weapon");
            const target = weapons[num - 1];
            if (target) {
                if (e.shiftKey) {
                    if (activeWeaponIds.includes(target.id)) {
                        activeWeaponIds = activeWeaponIds.filter(id => id !== target.id);
                    } else if (activeWeaponIds.length < 3) {
                        activeWeaponIds.push(target.id);
                    }
                } else {
                    activeWeaponIds = [target.id];
                }
                renderWeaponList();
                draw();
            }
        }
    }, { signal });

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
            const oldBeams = state.beams.size;
            const oldNodes = state.nodes.size;
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
            if (state.beams.size > oldBeams || state.nodes.size > oldNodes) playPlaceSound();
        } else if (["weapons", "tech", "storage"].includes(currentTab) && selectedBuildingId) {
            const clickedNode = Array.from(state.nodes.values()).find(n => n.x === pos.x && n.y === pos.y);
            if (clickedNode) {
                const oldSize = state.buildings.size;
                state = tryPlaceBuilding(state, selectedBuildingId, [clickedNode.id], state.currentPlayer, campaign?.unlockedPerks || []);
                if (state.buildings.size > oldSize) playPlaceSound();
            }
        } else if (currentTab === "combat" && activeWeaponIds.length > 0) {
            for (const wid of activeWeaponIds) {
                const weapon = state.buildings.get(wid);
                const { nextState, result } = fireWeapon(state, wid, pos.x, pos.y);
                state = nextState;
                if (result) {
                    playFireSound(weapon?.defId === 'laser_turret' ? 'energy' : 'kinetic');
                    projectiles.push({ result, progress: 0 });
                }
            }
        }
        draw();
    }, { signal });

    canvas.addEventListener("mousemove", (evt) => {
        mousePos = getMousePos(evt);
        draw();
    }, { signal });

    function animate() {
        let changed = false;
        if (projectiles.length > 0) {
            for (let i = projectiles.length - 1; i >= 0; i--) {
                projectiles[i]!.progress += 0.05;
                if (projectiles[i]!.progress >= 1) {
                    const p = projectiles[i]!;
                    createExplosion(p.result.targetX * CELL_SIZE, p.result.targetY * CELL_SIZE, p.result.hitBuildingId ? "#f00" : "#ff0");
                    if (p.result.hitBuildingId) {
                        const physState = { nodes: new Map(state.nodes), beams: new Map(state.beams), buildings: new Map(state.buildings) };
                        performCollapse(physState);
                        state = { ...state, nodes: physState.nodes, beams: physState.beams, buildings: physState.buildings! };
                        checkVictory();
                    }
                    projectiles.splice(i, 1);
                }
            }
            changed = true;
        }
        if (particles.length > 0) {
            for (let i = particles.length - 1; i >= 0; i--) {
                const p = particles[i]!;
                p.x += p.vx; p.y += p.vy;
                p.life -= 0.02;
                if (p.life <= 0) particles.splice(i, 1);
            }
            changed = true;
        }
        if (screenShake > 0) {
            screenShake *= 0.9;
            if (screenShake < 0.1) screenShake = 0;
            changed = true;
        }
        if (changed) draw();
        animId = requestAnimationFrame(animate);
    }
    animId = requestAnimationFrame(animate);

    function checkVictory() {
        const p1Core = Array.from(state.buildings.values()).find(b => b.owner === 1 && b.defId === "core_generator");
        if (!p1Core && campaign) {
            showPerkSelection();
        }
    }

    function showPerkSelection() {
        const perks = getRandomPerkOptions();
        const overlay = document.createElement("div");
        overlay.className = "overlay";
        overlay.innerHTML = `
            <div class="overlay-card panel">
                <h2>Победа! Выберите улучшение:</h2>
                <div id="perk-list" style="display:flex; gap:10px; margin-bottom: 20px;"></div>
            </div>
        `;
        const list = overlay.querySelector("#perk-list")!;
        perks.forEach(p => {
            const btn = document.createElement("button");
            btn.innerHTML = `<strong>${p.name}</strong><br><small>${p.description}</small>`;
            btn.style.textAlign = "center";
            btn.onclick = () => {
                campaign!.unlockedPerks.push(p.id);
                campaign!.currentStageIndex++;
                localStorage.setItem("v2_campaign_state", JSON.stringify(campaign));
                overlay.remove();
                startCampaignStage();
            };
            list.appendChild(btn);
        });
        shell.appendChild(overlay);
    }

    function draw() {
        ctx.save();
        if (screenShake > 0) ctx.translate((Math.random() - 0.5) * screenShake, (Math.random() - 0.5) * screenShake);
        ctx.clearRect(-100, -100, canvas.width + 200, canvas.height + 200);

        ctx.strokeStyle = "#1a2030"; ctx.lineWidth = 1;
        for (let x = 0; x <= V2_GRID_WIDTH; x++) { ctx.beginPath(); ctx.moveTo(x * CELL_SIZE, 0); ctx.lineTo(x * CELL_SIZE, canvas.height); ctx.stroke(); }
        for (let y = 0; y <= V2_GRID_HEIGHT; y++) { ctx.beginPath(); ctx.moveTo(0, y * CELL_SIZE); ctx.lineTo(canvas.width, y * CELL_SIZE); ctx.stroke(); }

        const currentLoads = calculateLoads({ nodes: new Map(state.nodes), beams: new Map(state.beams), buildings: new Map(state.buildings) });

        for (const beam of state.beams.values()) {
            const nodeA = state.nodes.get(beam.nodeAId)!;
            const nodeB = state.nodes.get(beam.nodeBId)!;
            const x1 = nodeA.x * CELL_SIZE, y1 = nodeA.y * CELL_SIZE, x2 = nodeB.x * CELL_SIZE, y2 = nodeB.y * CELL_SIZE;

            const grad = ctx.createLinearGradient(x1, y1, x2, y2);
            if (beam.materialId === "wood") { grad.addColorStop(0, "#8b4513"); grad.addColorStop(0.5, "#a0522d"); grad.addColorStop(1, "#8b4513"); }
            else if (beam.materialId === "metal") { grad.addColorStop(0, "#4682b4"); grad.addColorStop(0.5, "#b0c4de"); grad.addColorStop(1, "#4682b4"); }
            else if (beam.materialId === "energy_shield") { grad.addColorStop(0, "#00ffff"); grad.addColorStop(0.5, "#ffffff"); grad.addColorStop(1, "#00ffff"); }
            else { grad.addColorStop(0, "#2f4f4f"); grad.addColorStop(0.5, "#708090"); grad.addColorStop(1, "#2f4f4f"); }

            // Stress color overlay
            const mat = BEAM_MATERIALS[beam.materialId];
            const load = currentLoads.get(beam.id) ?? 0;
            const stress = Math.min(1, load / mat.capacity);

            ctx.strokeStyle = grad;
            ctx.lineWidth = beam.materialId === "wood" ? 4 : 6;
            ctx.lineCap = "round";
            ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();

            if (stress > 0.5) {
                ctx.strokeStyle = `rgba(255, 0, 0, ${(stress - 0.5) * 2})`;
                ctx.lineWidth = 2; ctx.stroke();
            }

            ctx.strokeStyle = beam.owner === 0 ? "rgba(0, 255, 0, 0.2)" : "rgba(255, 0, 0, 0.2)";
            ctx.lineWidth = 8; ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
        }

        for (const node of state.nodes.values()) {
            ctx.fillStyle = node.id === selectedNodeId ? "#fff" : (node.isGround ? "#555" : (node.owner === 0 ? "#0f0" : "#f00"));
            ctx.beginPath(); ctx.arc(node.x * CELL_SIZE, node.y * CELL_SIZE, 4, 0, Math.PI * 2); ctx.fill();
        }

        for (const b of state.buildings.values()) {
            const node = state.nodes.get(b.nodeIds[0]!)!;
            const def = BUILDING_CATALOG[b.defId];
            ctx.fillStyle = b.owner === 0 ? "rgba(0, 255, 0, 0.7)" : "rgba(255, 0, 0, 0.7)";
            if (activeWeaponIds.includes(b.id)) { ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.strokeRect(node.x * CELL_SIZE - 12, node.y * CELL_SIZE - 12, 24, 24); }
            ctx.fillRect(node.x * CELL_SIZE - 10, node.y * CELL_SIZE - 10, 20, 20);
            ctx.fillStyle = "#fff"; ctx.font = "10px monospace";
            ctx.fillText(`${def.name[0]}${b.level}`, node.x * CELL_SIZE - 5, node.y * CELL_SIZE + 4);
            if (!b.isOperational) { ctx.strokeStyle = "#f00"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(node.x*CELL_SIZE-10, node.y*CELL_SIZE-10); ctx.lineTo(node.x*CELL_SIZE+10, node.y*CELL_SIZE+10); ctx.stroke(); }
        }

        for (const p of projectiles) {
            const path = p.result.path;
            const index = Math.floor(p.progress * (path.length - 1));
            const point = path[index]!;
            ctx.fillStyle = "#ff0";
            ctx.beginPath(); ctx.arc(point.x * CELL_SIZE, point.y * CELL_SIZE, 4, 0, Math.PI * 2); ctx.fill();
        }

        for (const p of particles) {
            ctx.globalAlpha = p.life; ctx.fillStyle = p.color;
            const size = p.color === "#555" ? 6 : 3; ctx.fillRect(p.x - size/2, p.y - size/2, size, size);
        }

        // --- GHOST PREVIEWS ---
        if (isLocalTurn()) {
            ctx.globalAlpha = 0.4;
            if (currentTab === "build") {
                if (selectedNodeId) {
                    const nodeA = state.nodes.get(selectedNodeId)!;
                    ctx.strokeStyle = "#fff"; ctx.setLineDash([5, 5]);
                    ctx.beginPath(); ctx.moveTo(nodeA.x * CELL_SIZE, nodeA.y * CELL_SIZE); ctx.lineTo(mousePos.x * CELL_SIZE, mousePos.y * CELL_SIZE); ctx.stroke();
                    ctx.setLineDash([]);
                }
                ctx.fillStyle = "#fff";
                ctx.beginPath(); ctx.arc(mousePos.x * CELL_SIZE, mousePos.y * CELL_SIZE, 4, 0, Math.PI * 2); ctx.fill();
            } else if (["weapons", "tech", "storage"].includes(currentTab) && selectedBuildingId) {
                const snappedNode = Array.from(state.nodes.values()).find(n => n.x === mousePos.x && n.y === mousePos.y);
                if (snappedNode) {
                    ctx.fillStyle = "#0f0";
                    ctx.fillRect(snappedNode.x * CELL_SIZE - 10, snappedNode.y * CELL_SIZE - 10, 20, 20);
                } else {
                    ctx.strokeStyle = "#fff";
                    ctx.strokeRect(mousePos.x * CELL_SIZE - 10, mousePos.y * CELL_SIZE - 10, 20, 20);
                }
            } else if (currentTab === "combat" && activeWeaponIds.length > 0) {
                ctx.setLineDash([5, 5]);
                for (const wid of activeWeaponIds) {
                    const weapon = state.buildings.get(wid);
                    if (!weapon) continue;
                    const node = state.nodes.get(weapon.nodeIds[0]!)!;
                    ctx.strokeStyle = isWithinFiringCone(node.x, node.y, mousePos.x, mousePos.y, state.currentPlayer) ? "#0f0" : "#f00";
                    ctx.beginPath();
                    ctx.moveTo(node.x * CELL_SIZE, node.y * CELL_SIZE);
                    ctx.lineTo(mousePos.rawX, mousePos.rawY);
                    ctx.stroke();
                }
                ctx.setLineDash([]);
            }
        }

        ctx.globalAlpha = 1; ctx.restore();

        const eco = state.economy[state.currentPlayer].resources;
        const caps = state.economy[state.currentPlayer].caps;
        const steelPct = Math.min(100, ((eco.steel ?? 0) / (caps.steel ?? 1)) * 100);
        const ammoPct = Math.min(100, ((eco.ammo ?? 0) / (caps.ammo ?? 1)) * 100);

        info.innerHTML = `
            <div>[SYS] PLAYER_${state.currentPlayer} | PHASE: ${state.turnPhase.toUpperCase()}</div>
            <div class="res-gauge">
                <div class="res-item"><span>STEEL: ${eco.steel ?? 0}/${caps.steel}</span><div class="res-bar"><div class="res-fill" style="width: ${steelPct}%"></div></div></div>
                <div class="res-item"><span>AMMO: ${eco.ammo ?? 0}/${caps.ammo}</span><div class="res-bar"><div class="res-fill" style="width: ${ammoPct}%"></div></div></div>
            </div>
        `;
    }

    shell.querySelector("#btn-create-room")?.addEventListener("click", () => { initSocket(); const code = (document.getElementById("room-code-input") as HTMLInputElement).value; socket?.emit("create-room", code || "1234"); }, { signal });
    shell.querySelector("#btn-join-room")?.addEventListener("click", () => { initSocket(); const code = (document.getElementById("room-code-input") as HTMLInputElement).value; socket?.emit("join-room", code || "1234"); }, { signal });
    shell.querySelector("#btn-start-ai")?.addEventListener("click", () => {
        const diff = (document.getElementById("select-ai-difficulty") as HTMLSelectElement).value;
        if (diff === "none") return;
        vsAiDifficulty = diff as AiDifficulty;
        localPlayerIndex = 0;
        campaign = null;
        document.getElementById("room-status")!.textContent = `Playing vs AI (${diff})`;
    }, { signal });

    shell.querySelector("#btn-start-campaign")?.addEventListener("click", () => {
        const saved = localStorage.getItem("v2_campaign_state");
        if (saved) {
            campaign = JSON.parse(saved);
        } else {
            campaign = createInitialCampaign();
        }
        startCampaignStage();
    }, { signal });

    function startCampaignStage() {
        if (!campaign) return;
        const stage = V2_CAMPAIGN_STAGES[campaign.currentStageIndex];
        if (!stage) {
            alert("Кампания завершена! Вы — великий инженер.");
            campaign = null;
            return;
        }

        state = createInitialV2Match();
        state = applyCampaignPerks(state, campaign.unlockedPerks);
        vsAiDifficulty = stage.aiDifficulty;
        localPlayerIndex = 0;
        document.getElementById("room-status")!.textContent = `STAGE ${campaign.currentStageIndex + 1}: ${stage.title}`;
        updateTabs("dice");
    }
    shell.querySelector("#btn-wood")?.addEventListener("click", () => selectedMaterial = "wood", { signal });
    shell.querySelector("#btn-metal")?.addEventListener("click", () => selectedMaterial = "metal", { signal });
    shell.querySelector("#btn-armor")?.addEventListener("click", () => selectedMaterial = "armor_plating", { signal });
    shell.querySelector("#btn-shield")?.addEventListener("click", () => selectedMaterial = "energy_shield", { signal });

    updateTabs("dice");
    draw();

    return () => { if (animId) cancelAnimationFrame(animId); socket?.disconnect(); ac.abort(); root.replaceChildren(); };
}
