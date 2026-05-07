import { pathToFileURL } from "node:url";

import { aggregatePlaytestReports, loadPlaytestReports } from "./playtestAggregate.js";

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    const reports = await loadPlaytestReports(args);
    if (reports.length === 0) {
        console.log("No playtest reports found.");
        return;
    }
    const agg = aggregatePlaytestReports(reports);
    console.log(`Reports: ${agg.reportsCount}`);
    console.log(`Average ratings:`);
    console.log(`  Rules clarity: ${agg.avgRulesClarity.toFixed(2)}`);
    console.log(`  Dice choice interest: ${agg.avgDiceChoiceInterest.toFixed(2)}`);
    console.log(`  Play again desire: ${agg.avgPlayAgainDesire.toFixed(2)}`);
    console.log(`Average match duration: ${Math.round(agg.avgMatchDurationMs)} ms`);
    console.log(`Winrate by player:`);
    for (const [playerId, winrate] of Object.entries(agg.winrateByPlayer)) {
        console.log(`  Player ${playerId}: ${(winrate * 100).toFixed(1)}%`);
    }
    console.log(`Top input errors:`);
    if (agg.topInputErrors.length === 0) {
        console.log("  none");
    } else {
        agg.topInputErrors.forEach((entry, index) => {
            console.log(`  ${index + 1}. ${entry.message} (${entry.count})`);
        });
    }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((error) => {
        console.error(error instanceof Error ? error.message : String(error));
        process.exitCode = 1;
    });
}
