import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

import { createChallengeRunState, runChallengeWithCallbacks } from "./challenge/run.js";
import type { ChallengeRunState, StageResult } from "./challenge/types.js";

interface ChallengeSmokeConfig {
    seed: number;
    stages: number;
    expectedStatus: "victory" | "defeat";
}

function chooseWinnerForStage(stage: number): "player" | "ai" {
    return stage === 1 ? "player" : "ai";
}

async function playDeterministicStage(state: ChallengeRunState): Promise<StageResult> {
    const winner = chooseWinnerForStage(state.currentStage);
    return {
        stage: state.currentStage,
        winner,
        rounds: 3,
        playerCoreHp: winner === "player" ? 10 : 0,
        aiCoreHp: winner === "player" ? 0 : 8,
        durationMs: 1,
        appliedUpgradeId: null,
    };
}

async function main(): Promise<void> {
    const raw = await readFile(new URL("../smoke/challenge-demo.json", import.meta.url), "utf8");
    const cfg = JSON.parse(raw) as ChallengeSmokeConfig;
    const initial = createChallengeRunState({ seed: cfg.seed, stages: cfg.stages });
    const final = await runChallengeWithCallbacks(
        initial,
        playDeterministicStage,
        async (_state, offerIds) => offerIds[0] ?? null
    );
    if (final.status !== cfg.expectedStatus) {
        throw new Error(`Challenge smoke failed: expected ${cfg.expectedStatus}, got ${final.status}.`);
    }
    console.log(`Challenge smoke passed: status=${final.status}, stagesPlayed=${final.history.length}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
