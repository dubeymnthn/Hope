import "dotenv/config";
import { resolve } from "node:path";
import { OrchestratorAgent } from "./orchestrator/orchestrator.js";

function parseArgs(args: string[]): { topic: string; outputDir?: string } {
  let topic = "";
  let outputDir: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--topic" || arg === "-t") {
      topic = args[++i] || "";
    } else if (arg === "--output-dir" || arg === "-o") {
      outputDir = args[++i];
    } else if (!arg.startsWith("-") && !topic) {
      topic = arg;
    }
  }

  return { topic, outputDir };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  const { topic, outputDir } = parseArgs(rawArgs);

  if (!topic) {
    console.log(`
Autonomous Faceless YouTube Video Factory (Local-Only V1)

Usage:
  npm run produce -- "<topic>"
  npm run produce -- --topic "<topic>" [options]

Examples:
  npm run produce -- "Why AI memory prices are exploding"
`);
    process.exit(1);
  }

  console.log(`[FACTORY] Launching Autonomous Production Factory for: "${topic}"`);

  const orchestrator = new OrchestratorAgent();
  try {
    const result = await orchestrator.run({
      topic,
      outputDir: outputDir || process.cwd()
    });

    if (result.qaReport.status === "PASS") {
      console.log(`\n🎉 SUCCESS: Final YouTube Video produced and verified at: ${result.finalVideoPath}`);
      process.exit(0);
    } else {
      console.error(`\n⚠️ Video produced but QA checks reported issues. See qa/report.md for details.`);
      process.exit(1);
    }
  } catch (err: any) {
    console.error(`\n❌ Pipeline execution failed:`, err);
    process.exit(1);
  }
}

main();
