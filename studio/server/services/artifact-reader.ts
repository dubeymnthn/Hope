import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { ResearchResultSchema, ResearchResult } from "../../../src/schemas/research.js";
import { ResearchPlanSchema, ResearchPlan } from "../../../src/schemas/research-plan.js";
import { ResearchQuestionSetSchema, ResearchQuestionSet } from "../../../src/schemas/research-questions.js";
import { EvidenceGraphSchema, EvidenceGraph } from "../../../src/schemas/evidence-graph.js";
import { ResearchCompletenessSchema, ResearchCompleteness } from "../../../src/schemas/research-gaps.js";
import { ArgumentResultSchema, ArgumentResult } from "../../../src/schemas/argument.js";
import { ScriptResultSchema, ScriptResult } from "../../../src/schemas/script.js";
import { VisualPlanSchema, VisualPlan } from "../../../src/schemas/visual-plan.js";
import { VisualEvidenceMapSchema, VisualEvidenceMap } from "../../../src/schemas/visual-evidence-map.js";
import { StoryboardResultSchema, StoryboardResult } from "../../../src/schemas/storyboard.js";
import { AudioTimestampsSchema, AudioTimestamps } from "../../../src/schemas/timestamps.js";
import { ChannelConfigSchema, ChannelConfig } from "../../../src/schemas/channel.js";
import { ProjectDesignStrategySchema, ProjectDesignStrategy } from "../../../src/schemas/design-strategy.js";

/**
 * Safe, optional artifact reads: every function here returns the parsed artifact, or
 * `null` when the file is absent, or `null` (with a console warning) when it fails
 * schema validation. NOTHING is fabricated to fill a gap (spec V2.4 §2/§8) — a missing
 * artifact must render in the UI as "not yet produced," never as invented data.
 */
function readOptional<S extends z.ZodTypeAny>(path: string, schema: S): z.infer<S> | null {
  if (!existsSync(path)) return null;
  try {
    return schema.parse(JSON.parse(readFileSync(path, "utf-8")));
  } catch (err: any) {
    console.warn(`[studio] Ignoring invalid artifact at ${path}: ${err.message}`);
    return null;
  }
}

export interface ProjectArtifacts {
  research: ResearchResult | null;
  researchPlan: ResearchPlan | null;
  researchQuestions: ResearchQuestionSet | null;
  evidenceGraph: EvidenceGraph | null;
  researchGaps: ResearchCompleteness | null;
  argument: ArgumentResult | null;
  script: ScriptResult | null;
  visualPlan: VisualPlan | null;
  visualEvidenceMap: VisualEvidenceMap | null;
  storyboard: StoryboardResult | null;
  audio: AudioTimestamps | null;
  config: ChannelConfig | null;
}

export function readProjectArtifacts(projectDir: string): ProjectArtifacts {
  return {
    research: readOptional(join(projectDir, "research/research.json"), ResearchResultSchema),
    researchPlan: readOptional(join(projectDir, "research/research-plan.json"), ResearchPlanSchema),
    researchQuestions: readOptional(join(projectDir, "research/research-questions.json"), ResearchQuestionSetSchema),
    evidenceGraph: readOptional(join(projectDir, "research/evidence-graph.json"), EvidenceGraphSchema),
    researchGaps: readOptional(join(projectDir, "research/research-gaps.json"), ResearchCompletenessSchema),
    argument: readOptional(join(projectDir, "argument/argument.json"), ArgumentResultSchema),
    script: readOptional(join(projectDir, "script/script.json"), ScriptResultSchema),
    visualPlan: readOptional(join(projectDir, "storyboard/visual-plan.json"), VisualPlanSchema),
    visualEvidenceMap: readOptional(join(projectDir, "visual-evidence/visual-evidence-map.json"), VisualEvidenceMapSchema),
    storyboard: readOptional(join(projectDir, "storyboard/storyboard.json"), StoryboardResultSchema),
    audio: readOptional(join(projectDir, "audio/timestamps.json"), AudioTimestampsSchema),
    config: readOptional(join(projectDir, "config/channel.json"), ChannelConfigSchema)
  };
}

/** V2.6: design.md's structured interpretation, when a project has one (optional). */
export function readOptionalDesignStrategy(projectDir: string): ProjectDesignStrategy | null {
  return readOptional(join(projectDir, "design/design-strategy.json"), ProjectDesignStrategySchema);
}

// --- Non-schema-validated artifacts (QA reports, pipeline state, raw JSON caches) ---
// These are read/reported verbatim (they are TypeScript-authored, not agent-authored,
// so there is no fabrication risk) rather than re-validated against a zod schema here.

export function readJsonIfExists<T = any>(path: string): T | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch (err: any) {
    console.warn(`[studio] Ignoring unreadable JSON at ${path}: ${err.message}`);
    return null;
  }
}

export function readQaReports(projectDir: string) {
  return {
    media: readJsonIfExists(join(projectDir, "qa/report.json")),
    visualStyle: readJsonIfExists(join(projectDir, "qa/visual-style-report.json")),
    script: readJsonIfExists(join(projectDir, "qa/script-qa-report.json"))
  };
}

export function readPipelineState(projectDir: string) {
  return readJsonIfExists(join(projectDir, "pipeline-state.json"));
}

export function readTtsCache(projectDir: string): Record<string, any> {
  return readJsonIfExists(join(projectDir, "audio/tts-cache.json")) ?? {};
}

export function listAgentTasks(projectDir: string): any[] {
  const dir = join(projectDir, "agent-tasks");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".task.json"))
    .map((f) => readJsonIfExists(join(dir, f)))
    .filter(Boolean);
}
