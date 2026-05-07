import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import { parseReplayScript } from "../src/proto.js";

describe("demo replay", () => {
    it("reads and parses demo replay file", async () => {
        const raw = await readFile(new URL("../demo/replay.json", import.meta.url), "utf8");
        const replay = parseReplayScript(raw);
        expect(replay.seed).toBeTypeOf("number");
        expect(replay.actions.length).toBeGreaterThan(0);
    });

    it("throws clear error on unknown action type", () => {
        const raw = JSON.stringify({
            seed: 1,
            actions: [{ type: "warp_drive" }],
        });
        expect(() => parseReplayScript(raw)).toThrow("unknown type");
    });

    it("throws clear error on missing required field", () => {
        const raw = JSON.stringify({
            seed: 1,
            actions: [{ type: "arm_column" }],
        });
        expect(() => parseReplayScript(raw)).toThrow("missing required field: x");
    });
});
