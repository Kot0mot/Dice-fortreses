import { cp, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(fileURLToPath(new URL("..", import.meta.url)));
const releaseRoot = join(projectRoot, "release");

async function pathExists(path) {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

async function collectFiles(root) {
    const out = [];
    async function walk(current) {
        const entries = await readdir(current, { withFileTypes: true });
        for (const entry of entries) {
            const full = join(current, entry.name);
            if (entry.isDirectory()) {
                await walk(full);
            } else if (entry.isFile()) {
                out.push(relative(root, full).replaceAll("\\", "/"));
            }
        }
    }
    if (await pathExists(root)) {
        await walk(root);
    }
    return out.sort();
}

function readPackageVersion() {
    const pkgRaw = spawnSync(process.execPath, ["-e", "process.stdout.write(require('./package.json').version)"], {
        cwd: projectRoot,
        encoding: "utf8",
    });
    if (pkgRaw.status !== 0) throw new Error("Unable to read package version");
    return pkgRaw.stdout.trim();
}

async function tryGetGitCommitFromBinary() {
    const proc = spawnSync("git", ["rev-parse", "--short", "HEAD"], {
        cwd: projectRoot,
        encoding: "utf8",
    });
    if (proc.status !== 0) return null;
    const hash = proc.stdout.trim();
    return hash || null;
}

async function resolveGitDir() {
    const dotGitPath = join(projectRoot, ".git");
    const dotGitStats = await stat(dotGitPath).catch(() => null);
    if (!dotGitStats) return null;
    if (dotGitStats.isDirectory()) return dotGitPath;
    if (!dotGitStats.isFile()) return null;
    const dotGitRaw = await readFile(dotGitPath, "utf8");
    const firstLine = dotGitRaw.split(/\r?\n/)[0]?.trim() ?? "";
    if (!firstLine.startsWith("gitdir:")) return null;
    const gitDirRaw = firstLine.slice("gitdir:".length).trim();
    if (!gitDirRaw) return null;
    return resolve(projectRoot, gitDirRaw);
}

async function getGitCommitFromRefs() {
    const gitDir = await resolveGitDir();
    if (!gitDir) return null;
    const headPath = join(gitDir, "HEAD");
    const headRaw = await readFile(headPath, "utf8").catch(() => null);
    if (!headRaw) return null;
    const head = headRaw.trim();
    if (/^[0-9a-fA-F]{40}$/.test(head)) return head.slice(0, 7);
    if (!head.startsWith("ref:")) return null;
    const refName = head.slice("ref:".length).trim();
    if (!refName) return null;

    const looseRefPath = join(gitDir, ...refName.split("/"));
    const looseRef = await readFile(looseRefPath, "utf8").catch(() => null);
    if (looseRef) {
        const hash = looseRef.trim();
        if (/^[0-9a-fA-F]{40}$/.test(hash)) return hash.slice(0, 7);
    }

    const packedRefsPath = join(gitDir, "packed-refs");
    const packedRaw = await readFile(packedRefsPath, "utf8").catch(() => null);
    if (!packedRaw) return null;
    for (const line of packedRaw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("^")) continue;
        const [hash, ref] = trimmed.split(" ");
        if (ref === refName && /^[0-9a-fA-F]{40}$/.test(hash ?? "")) {
            return hash.slice(0, 7);
        }
    }
    return null;
}

async function getGitCommit() {
    const envHash = (process.env.GITHUB_SHA ?? process.env.CI_COMMIT_SHA ?? "").trim();
    if (/^[0-9a-fA-F]{7,40}$/.test(envHash)) {
        return envHash.slice(0, 7);
    }
    const fromBinary = await tryGetGitCommitFromBinary();
    if (fromBinary) return fromBinary;
    const fromRefs = await getGitCommitFromRefs();
    return fromRefs ?? "unavailable";
}

async function copySimLatestSummary(bundleDir) {
    const simRoot = join(projectRoot, "sim-results");
    if (!(await pathExists(simRoot))) return [];
    const all = await collectFiles(simRoot);
    const summaryCandidates = all
        .filter((file) => file.endsWith("summary.json"))
        .map((file) => ({ file, full: join(simRoot, file), mtime: 0 }));
    if (summaryCandidates.length === 0) return [];
    for (const candidate of summaryCandidates) {
        const meta = await stat(candidate.full);
        candidate.mtime = meta.mtimeMs;
    }
    summaryCandidates.sort((a, b) => b.mtime - a.mtime);
    const latest = summaryCandidates[0];
    if (!latest) return [];
    const destDir = join(bundleDir, "sim-results");
    await mkdir(destDir, { recursive: true });
    const dest = join(destDir, basename(latest.file));
    await cp(latest.full, dest);
    return [relative(bundleDir, dest).replaceAll("\\", "/")];
}

function tryCreateZip(bundleDir, zipPath) {
    const psScript = [
        `$bundle='${bundleDir.replaceAll("'", "''")}'`,
        `$zip='${zipPath.replaceAll("'", "''")}'`,
        "if (Test-Path $zip) { Remove-Item -LiteralPath $zip -Force }",
        "Compress-Archive -Path (Join-Path $bundle '*') -DestinationPath $zip -Force",
    ].join("; ");
    const proc = spawnSync("powershell", ["-NoProfile", "-Command", psScript], {
        cwd: projectRoot,
        encoding: "utf8",
    });
    return proc.status === 0;
}

async function main() {
    const version = readPackageVersion();
    const bundleName = `dice-fortresses-mvp-${version}`;
    const bundleDir = join(releaseRoot, bundleName);
    const zipPath = join(releaseRoot, `${bundleName}.zip`);
    await mkdir(releaseRoot, { recursive: true });
    await rm(bundleDir, { recursive: true, force: true });
    await mkdir(bundleDir, { recursive: true });

    const included = [];
    const copyTargets = ["dist", "dist-web", "demo"];
    for (const name of copyTargets) {
        const from = join(projectRoot, name);
        if (!(await pathExists(from))) {
            throw new Error(`Missing required build artifact: ${name}. Run checks/build first.`);
        }
        const to = join(bundleDir, name);
        await cp(from, to, { recursive: true });
        included.push(...(await collectFiles(to)).map((file) => `${name}/${file}`));
    }

    const readmeFrom = join(projectRoot, "README.md");
    const readmeTo = join(bundleDir, "README.md");
    await cp(readmeFrom, readmeTo);
    included.push("README.md");

    const simIncluded = await copySimLatestSummary(bundleDir);
    included.push(...simIncluded);

    const manifest = {
        version,
        buildTimestamp: new Date().toISOString(),
        gitCommitHash: await getGitCommit(),
        includedFiles: included.sort(),
    };
    await writeFile(join(releaseRoot, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
    await writeFile(join(bundleDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

    const zipped = tryCreateZip(bundleDir, zipPath);
    console.log(`Release bundle directory: ${relative(projectRoot, bundleDir)}`);
    if (zipped) {
        console.log(`Release zip: ${relative(projectRoot, zipPath)}`);
    } else {
        console.log("Zip creation was skipped; use bundle directory artifact.");
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
