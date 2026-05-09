/**
 * Минимальный UI для v2 sandbox в браузере (тот же слой, что и v2Cli).
 */
import { DiceFortsRng } from "../src/random.js";
import { applyResourceGains } from "../src/v2/economy.js";
import { buildDicePoolForPlayer, rollEntireDicePool } from "../src/v2/dicePool.js";
import { createInitialV2Match, withCurrentPlayer, withEconomy, type V2MatchState } from "../src/v2/matchState.js";

const T = {
    title: "Режим v2 (песочница)",
    blurb: "Тот же код, что и в npm run v2:play: поле, два ядра-генератора, пул кубиков, склады с капом.",
    seed: (n: number) => `Seed: ${n}`,
    turn: (p: number) => `Ход игрока ${p}`,
    roll: "Бросить пул (roll)",
    next: "Сменить игрока без броска",
    back: "В меню",
    legend: "· пусто · 0/1 — ядро игрока (низ / верх)",
    lastRoll: "Последний бросок",
    none: "—",
    resources: "Склады",
    emptyBag: "(пусто)",
};

function fmtBag(state: V2MatchState): string {
    const lines = [0, 1].map((pid) => {
        const r = state.economy[pid as 0 | 1]!.resources;
        const entries = Object.entries(r).filter(([, v]) => (v ?? 0) > 0);
        const s = entries.length === 0 ? T.emptyBag : entries.map(([k, v]) => `${k}:${v}`).join(", ");
        return `Игрок ${pid}: ${s}`;
    });
    return lines.join("\n");
}

export function mountV2Sandbox(root: HTMLElement, opts: { readonly seed: number; readonly onBack: () => void }): () => void {
    const ac = new AbortController();
    const { signal } = ac;

    let state: V2MatchState = createInitialV2Match();
    const rng = new DiceFortsRng(opts.seed);
    let lastRollText = T.none;

    const shell = document.createElement("div");
    shell.className = "v2-sandbox-shell";

    const hdr = document.createElement("header");
    hdr.innerHTML = `<h1>${T.title}</h1><p class="muted">${T.blurb}</p>`;

    const meta = document.createElement("div");
    meta.className = "v2-meta panel";

    const boardWrap = document.createElement("div");
    boardWrap.className = "v2-board-wrap panel";

    const boardEl = document.createElement("div");
    boardEl.className = "v2-board";
    boardWrap.appendChild(boardEl);

    const resPre = document.createElement("pre");
    resPre.className = "v2-resources";

    const rollPre = document.createElement("pre");
    rollPre.className = "v2-last-roll muted";

    const actions = document.createElement("div");
    actions.className = "v2-actions";

    const btnRoll = document.createElement("button");
    btnRoll.type = "button";
    btnRoll.textContent = T.roll;

    const btnNext = document.createElement("button");
    btnNext.type = "button";
    btnNext.textContent = T.next;

    const btnBack = document.createElement("button");
    btnBack.type = "button";
    btnBack.textContent = T.back;

    actions.append(btnRoll, btnNext, btnBack);

    shell.append(hdr, meta, boardWrap, resPre, rollPre, actions);
    root.replaceChildren(shell);

    function renderBoard(): void {
        const { width: w, height: h } = state;
        boardEl.style.gridTemplateColumns = `repeat(${w}, minmax(4px, 10px))`;
        boardEl.replaceChildren();

        const cellBuilding = new Map<string, { owner: 0 | 1 }>();
        for (const b of state.buildings.values()) {
            cellBuilding.set(`${b.x},${b.y}`, { owner: b.owner });
        }

        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                const cell = document.createElement("button");
                cell.type = "button";
                cell.className = "v2-cell";
                cell.disabled = true;
                const cb = cellBuilding.get(`${x},${y}`);
                if (cb) {
                    cell.classList.add(`v2-cell-p${cb.owner}`);
                    cell.textContent = String(cb.owner);
                    cell.title = `ядро игрока ${cb.owner}`;
                } else {
                    cell.textContent = "·";
                }
                boardEl.appendChild(cell);
            }
        }
    }

    function rerender(): void {
        meta.textContent = `${T.seed(opts.seed)} · поле ${state.width}×${state.height}\n${T.turn(state.currentPlayer)}\n${T.legend}`;
        resPre.textContent = `${T.resources}:\n${fmtBag(state)}`;
        rollPre.textContent = `${T.lastRoll}: ${lastRollText}`;
        renderBoard();
    }

    btnRoll.addEventListener(
        "click",
        () => {
            const pid = state.currentPlayer;
            const pool = buildDicePoolForPlayer(state, pid);
            const { results, bag } = rollEntireDicePool(pool, rng);
            lastRollText = results.map((r) => `[${r.faceIndex}] ${r.yield.resourceId}+${r.yield.amount}`).join(" · ");
            const e0 =
                pid === 0 ? applyResourceGains(state.economy[0]!, bag) : state.economy[0]!;
            const e1 =
                pid === 1 ? applyResourceGains(state.economy[1]!, bag) : state.economy[1]!;
            const nextPid: 0 | 1 = pid === 0 ? 1 : 0;
            state = withCurrentPlayer(withEconomy(state, [e0, e1]), nextPid);
            rerender();
        },
        { signal }
    );

    btnNext.addEventListener(
        "click",
        () => {
            lastRollText = T.none;
            const pid = state.currentPlayer;
            state = withCurrentPlayer(state, pid === 0 ? 1 : 0);
            rerender();
        },
        { signal }
    );

    btnBack.addEventListener("click", () => opts.onBack(), { signal });

    rerender();

    return () => {
        ac.abort();
        root.replaceChildren();
    };
}
