import { existsSync } from "node:fs";
import { join } from "node:path";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { computeResearchStateHash, computeScriptStateHash } from "../../../src/orchestrator/production-gate.js";
import { assessResearchCompleteness } from "../../../src/research/gap-detection.js";
import { readProjectArtifacts, readQaReports } from "./artifact-reader.js";

export interface ReadinessStage {
  key: string;
  label: string;
  status: string;
}

export interface ProductionSummary {
  phase: string;
  approvals: ReturnType<PipelineStateManager["getApprovals"]>;
  revisionCounters: ReturnType<PipelineStateManager["getRevisionCounters"]>;
  researchApprovalValid: boolean;
  scriptApprovalValid: boolean;
  stages: ReadinessStage[];
}

/** The spec §27 8-stage dashboard: always tells the operator what's blocking production. */
export function getProductionSummary(projectDir: string): ProductionSummary {
  const state = new PipelineStateManager(join(projectDir, "pipeline-state.json"));
  const approvals = state.getApprovals();
  const revisionCounters = state.getRevisionCounters();
  const phase = state.getProductionPhase();
  const artifacts = readProjectArtifacts(projectDir);
  const qa = readQaReports(projectDir);

  const researchApprovalValid = !!approvals.research && approvals.research.approvedArtifactHash === computeResearchStateHash(projectDir);
  const scriptApprovalValid = !!approvals.script && approvals.script.approvedArtifactHash === computeScriptStateHash(projectDir);

  let researchStatus = "RESEARCHING";
  if (artifacts.evidenceGraph) {
    if (artifacts.researchGaps && artifacts.researchPlan && assessResearchCompleteness(artifacts.researchGaps, artifacts.researchPlan).blocking) {
      researchStatus = "NEEDS_MORE_RESEARCH";
    } else if (researchApprovalValid) {
      researchStatus = "APPROVED";
    } else if (approvals.research) {
      researchStatus = "STALE";
    } else {
      researchStatus = "READY_FOR_REVIEW";
    }
  }

  let scriptStatus = "PENDING";
  if (artifacts.script) {
    if (qa.script?.status === "FAIL") {
      scriptStatus = "CLAIM_GATE_FAILED";
    } else if (scriptApprovalValid) {
      scriptStatus = "APPROVED";
    } else if (approvals.script) {
      scriptStatus = "STALE";
    } else {
      scriptStatus = "READY_FOR_REVIEW";
    }
  }

  const productionStatusByPhase: Record<string, string> = {
    RESEARCHING: "LOCKED",
    RESEARCH_REVIEW: "LOCKED",
    RESEARCH_APPROVED: "LOCKED",
    ARGUMENT_GENERATING: "LOCKED",
    SCRIPT_REVIEW: "LOCKED",
    SCRIPT_APPROVED: "LOCKED",
    PRODUCTION_READY: "READY",
    TTS_GENERATING: "GENERATING",
    VISUAL_GENERATING: "GENERATING",
    RENDERING: "RENDERING",
    QA: "QA",
    EXPORTED: "COMPLETE"
  };

  const stages: ReadinessStage[] = [
    { key: "research", label: "Research", status: researchStatus },
    { key: "argument", label: "Argument", status: artifacts.argument ? "GENERATED" : "PENDING" },
    { key: "script", label: "Script", status: scriptStatus },
    { key: "production", label: "Production", status: productionStatusByPhase[phase] ?? "LOCKED" },
    { key: "audio", label: "Audio", status: artifacts.audio ? "GENERATED" : "PENDING" },
    { key: "visuals", label: "Visuals", status: artifacts.visualPlan ? "GENERATED" : "PENDING" },
    { key: "qa", label: "QA", status: qa.media ? ((qa.media as any).status ?? "GENERATED") : "PENDING" },
    { key: "export", label: "Export", status: existsSync(join(projectDir, "final.mp4")) ? "READY" : "PENDING" }
  ];

  return { phase, approvals, revisionCounters, researchApprovalValid, scriptApprovalValid, stages };
}
