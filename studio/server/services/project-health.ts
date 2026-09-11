import { existsSync } from "node:fs";
import { join } from "node:path";
import { readProjectArtifacts, readQaReports, listAgentTasks } from "./artifact-reader.js";
import { hasActiveJob, lastFailedJob, listJobsForProject } from "./render-jobs.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";

export type HealthState = "HEALTHY" | "NEEDS_REVIEW" | "BLOCKED" | "RUNNING" | "FAILED";

export interface ProjectHealth {
  state: HealthState;
  reasons: string[];
}

/**
 * Every reason comes from a real artifact/process signal (spec V2.4 §9) — no invented
 * state. Priority when multiple conditions hold: RUNNING > BLOCKED > FAILED >
 * NEEDS_REVIEW > HEALTHY (an active job is the most current fact; a gate awaiting the
 * reasoning agent or a hard failure both outrank a soft "needs review").
 */
export function computeProjectHealth(projectId: string, projectDir: string): ProjectHealth {
  if (hasActiveJob(projectId)) {
    return { state: "RUNNING", reasons: ["A render/production job is currently running for this project."] };
  }

  // `agent-tasks/<stage>.task.json` is a write-once snapshot (src/agents/agent-task.ts):
  // its `status: "awaiting_agent"` is frozen at the moment the brief was written and is
  // NEVER updated once the artifact is actually produced — nothing in the CLI pipeline
  // reads it back, so stale briefs from an earlier run just accumulate harmlessly there.
  // This health check DOES read them, so it must independently verify the task's own
  // `artifactPath` doesn't already exist before treating it as a real, current block —
  // a real bug hit and fixed during this session (a fully-completed project was
  // reporting BLOCKED on every stage because of leftover briefs from its first, gated run).
  // A task record with no `artifactPath` at all (malformed, or an older/synthetic record)
  // can't be verified against disk — treat it conservatively as still blocking rather than
  // silently downgrading it, unlike a real brief whose named artifact already exists.
  const pendingTasks = listAgentTasks(projectDir).filter(
    (t) => t?.status === "awaiting_agent" && (!t?.artifactPath || !existsSync(join(projectDir, t.artifactPath)))
  );
  if (pendingTasks.length > 0) {
    return {
      state: "BLOCKED",
      reasons: pendingTasks.map((t) => `Stage "${t.stage}" is awaiting the reasoning agent: ${t.reason ?? "artifact missing or invalid"}`)
    };
  }

  const qa = readQaReports(projectDir);
  const reasons: string[] = [];

  if (qa.media?.status === "FAIL") {
    reasons.push(`Media QA FAILED: ${(qa.media.errors ?? []).slice(0, 3).join("; ") || qa.media.summary || "see qa/report.json"}`);
  }
  const failedJob = lastFailedJob(projectId);
  if (failedJob) {
    reasons.push(`Last job failed: ${failedJob.error ?? "unknown error"}`);
  }
  if (reasons.length > 0) {
    return { state: "FAILED", reasons };
  }

  const artifacts = readProjectArtifacts(projectDir);
  const needsReview: string[] = [];

  // V2.6: a human-review pause is exactly what NEEDS_REVIEW already means — surface it
  // the same way an agent-task halt surfaces as BLOCKED above.
  const phase = new PipelineStateManager(join(projectDir, "pipeline-state.json")).getProductionPhase();
  if (phase === "RESEARCH_REVIEW") needsReview.push("Research is ready for your review and approval.");
  if (phase === "SCRIPT_REVIEW") needsReview.push("Script is ready for your review and approval.");
  if (phase === "PRODUCTION_READY") needsReview.push('Everything is approved — click "Start Production" to begin TTS/visuals/render.');
  const lastJob = listJobsForProject(projectId)[0];
  if (lastJob?.status === "blocked" && lastJob.error) needsReview.push(lastJob.error);

  if (artifacts.researchGaps && artifacts.researchGaps.gaps.length > 0) {
    needsReview.push(`Research completeness ${artifacts.researchGaps.overallCompletenessPercent}% — ${artifacts.researchGaps.gaps.length} gap(s) recorded (non-blocking).`);
  }
  if (qa.script?.status === "WARN") {
    needsReview.push(`Script QA has warnings: ${(qa.script.warnings ?? []).slice(0, 2).join("; ")}`);
  }
  if (qa.visualStyle?.status === "WARN" || qa.visualStyle?.status === "FAIL") {
    needsReview.push(`Visual QA ${qa.visualStyle.status}: ${(qa.visualStyle.errors ?? qa.visualStyle.warnings ?? []).slice(0, 2).join("; ")}`);
  }
  if (needsReview.length > 0) {
    return { state: "NEEDS_REVIEW", reasons: needsReview };
  }

  return { state: "HEALTHY", reasons: ["All produced artifacts are valid; no open gates, gaps, or QA warnings."] };
}
