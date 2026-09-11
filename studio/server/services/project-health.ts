import { readProjectArtifacts, readQaReports, listAgentTasks } from "./artifact-reader.js";
import { hasActiveJob, lastFailedJob } from "./render-jobs.js";

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

  const pendingTasks = listAgentTasks(projectDir).filter((t) => t?.status === "awaiting_agent");
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
