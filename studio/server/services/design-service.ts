import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectDesignStrategy } from "../../../src/schemas/design-strategy.js";
import { DesignStrategistAgent } from "../../../src/agents/design-strategist.js";
import { hashArtifact, AgentTaskPendingError } from "../../../src/agents/agent-task.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { readOptionalDesignStrategy } from "./artifact-reader.js";

export interface DesignInfo {
  designMd: string | null;
  strategy: ProjectDesignStrategy | null;
  /** True when design.md exists but the strategy hasn't been (re)generated against it yet. */
  stale: boolean;
}

function designMdPath(projectDir: string): string {
  return join(projectDir, "design.md");
}

export function getDesignInfo(projectDir: string): DesignInfo {
  const mdPath = designMdPath(projectDir);
  const designMd = existsSync(mdPath) ? readFileSync(mdPath, "utf-8") : null;
  const strategy = readOptionalDesignStrategy(projectDir);
  const stale = designMd !== null && (!strategy || strategy.sourceDesignMdHash !== hashArtifact(mdPath));
  return { designMd, strategy, stale };
}

/**
 * design.md is plain text, not a JSON artifact, so it deliberately does NOT go through
 * `editArtifactWithRevision` (that helper JSON-parses `mutate`'s input). Changing it marks
 * only the design revision counter — never research/argument/script (spec §36's hard
 * rule) — so the visual strategy/plan can be flagged stale without touching content gates.
 */
export function saveDesignMd(projectDir: string, text: string): void {
  writeFileSync(designMdPath(projectDir), text, "utf-8");
  new PipelineStateManager(join(projectDir, "pipeline-state.json")).bumpRevision("design");
}

export type GenerateDesignStrategyResult = { status: "generated"; strategy: ProjectDesignStrategy } | { status: "no-design-md" } | { status: "pending"; briefPath: string };

export async function generateDesignStrategy(topic: string, projectDir: string, repoRoot: string): Promise<GenerateDesignStrategyResult> {
  try {
    const result = await new DesignStrategistAgent().ensure(topic, projectDir, { repoRoot });
    if (!result) return { status: "no-design-md" };
    return { status: "generated", strategy: result.strategy };
  } catch (err) {
    if (err instanceof AgentTaskPendingError) return { status: "pending", briefPath: err.briefPath };
    throw err;
  }
}
