import { describe, expect, it, vi } from "vitest";

import { parseArgs as parseChallengeArgs } from "../src/challengeCli.js";
import { parseArgs as parseProtoArgs } from "../src/proto.js";
import { parseArgs as parseSimArgs } from "../src/simCli.js";

describe("CLI help and validation", () => {
    it("prints help and exits with code 0", () => {
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        const exitSpy = vi.spyOn(process, "exit").mockImplementation(((code?: number) => {
            throw new Error(`exit:${code ?? 0}`);
        }) as never);
        expect(() => parseSimArgs(["--help"])).toThrow("exit:0");
        expect(logSpy).toHaveBeenCalled();
        expect(String(logSpy.mock.calls[0]?.[0])).toContain("Usage:");
        logSpy.mockRestore();
        exitSpy.mockRestore();
    });

    it("rejects unknown arguments with readable error", () => {
        expect(() => parseProtoArgs(["--unknown"])).toThrow("Unknown argument");
        expect(() => parseChallengeArgs(["--oops=1"])).toThrow("Unknown argument");
    });
});
