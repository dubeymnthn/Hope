import "dotenv/config";
import { mkdirSync } from "node:fs";
import { resolve, join } from "node:path";
import { OrchestratorAgent } from "./orchestrator/orchestrator.js";
import { isAgentTaskPending } from "./agents/agent-task.js";
import { isProductionGate } from "./orchestrator/production-gate.js";

interface CliOptions {
  topic: string;
  outputDir?: string;
  workspace: boolean;
  planOnly: boolean;
  /** V2.6: opt into the human-review gate (Documentary Studio's default). CLI stays
   *  autonomous by default so existing muscle memory/scripts keep working unchanged. */
  requireReview: boolean;
}

function slugify(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "documentary"
  );
}

function parseArgs(args: string[]): CliOptions {
  let topic = "";
  let outputDir: string | undefined;
  let workspace = false;
  let planOnly = false;
  let requireReview = false;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--topic" || arg === "-t") {
      topic = args[++i] || "";
    } else if (arg === "--output-dir" || arg === "-o") {
      outputDir = args[++i];
    } else if (arg === "--workspace" || arg === "-w") {
      workspace = true;
    } else if (arg === "--plan-only") {
      planOnly = true;
    } else if (arg === "--require-review") {
      requireReview = true;
    } else if (!arg.startsWith("-") && !topic) {
      topic = arg;
    }
  }

  return { topic, outputDir, workspace, planOnly, requireReview };
}

function usage(): void {
  console.log(`
Autonomous Faceless YouTube Documentary Factory (V2, local-only)

Usage:
  npm run produce -- "<topic>" [options]
  npm run produce -- --topic "<topic>" [options]

Options:
  -t, --topic <topic>       Documentary subject
  -o, --output-dir <dir>    Explicit workspace directory
  -w, --workspace           Use a per-topic workspace at topics/<slug>/
      --plan-only           Stop after the script QA gate, before TTS
      --require-review      Pause for human research/script approval instead of running
                             straight through (V2.6; Documentary Studio always requires
                             this — the CLI stays autonomous unless you pass this flag)

Examples:
  npm run produce -- "<your documentary topic>"
  npm run produce -- -t "<topic>" -w            (per-topic workspace)
  npm run produce -- -t "<topic>" -w --plan-only  (stop before TTS)

The research, argument, script and visual-direction stages are performed by the
Antigravity agent. When one of those artifacts is missing the pipeline writes a task
brief to <workspace>/agent-tasks/ and stops; the agent completes the work and the
pipeline is re-run, resuming from that point.
`);
}

async function main() {
  const { topic, outputDir, workspace, planOnly, requireReview } = parseArgs(process.argv.slice(2));

  if (!topic) {
    usage();
    process.exit(1);
  }

  const repoRoot = process.cwd();
  let projectDir = repoRoot;
  if (outputDir) {
    projectDir = resolve(outputDir);
  } else if (workspace) {
    projectDir = join(repoRoot, "topics", slugify(topic));
  }
  mkdirSync(projectDir, { recursive: true });

  console.log(`[FACTORY] Producing: "${topic}"`);
  console.log(`[FACTORY] Workspace: ${projectDir}`);

  const orchestrator = new OrchestratorAgent({
    stateFilePath: join(projectDir, "pipeline-state.json")
  });

  try {
    const result = await orchestrator.run({
      topic,
      outputDir: projectDir,
      repoRoot,
      planOnly,
      // V2.6: the CLI stays fully autonomous unless --require-review opts into the same
      // human-approval gate Documentary Studio always enforces.
      autoApprove: !requireReview,
      startProduction: !requireReview
    });

    if (result.qaReport.status === "PASS") {
      console.log(`\nSUCCESS: video produced and verified at ${result.finalVideoPath}`);
      process.exit(0);
    }
    console.error(`\nVideo produced, but media QA reported issues. See qa/report.md.`);
    process.exit(1);
  } catch (err: any) {
    if (isAgentTaskPending(err)) {
      // Not a failure: a reasoning stage is waiting on the Antigravity agent.
      console.log(`\n${err.message}`);
      process.exit(2);
    }
    if (isProductionGate(err)) {
      // Not a failure: waiting on a human approval (--require-review was set).
      console.log(`\n${err.message}`);
      process.exit(2);
    }
    if (err?.message === "PLAN_ONLY_COMPLETE") {
      console.log(`\nPlan-only run complete: research, argument, script and script QA all passed.`);
      process.exit(0);
    }
    console.error(`\nPipeline failed:`, err?.message || err);
    process.exit(1);
  }
}

main();
