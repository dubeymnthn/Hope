import { join } from "node:path";
import { EvidenceGraphSchema, EvidenceGraph, Evidence, DataPoint } from "../../../src/schemas/evidence-graph.js";
import { ResearchQuestionSetSchema, ResearchQuestionSet, ResearchQuestion } from "../../../src/schemas/research-questions.js";
import { checkEvidenceGraphIntegrity } from "../../../src/research/evidence-graph-integrity.js";
import { computeStaleness } from "../../../src/research/staleness.js";
import { StalenessReport } from "../../../src/schemas/staleness.js";
import { assessResearchCompleteness } from "../../../src/research/gap-detection.js";
import { computeResearchStateHash } from "../../../src/orchestrator/production-gate.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { AgentTaskGate, isAgentTaskPending } from "../../../src/agents/agent-task.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { editArtifactWithRevision } from "./revisions.js";

export class ResearchEditValidationError extends Error {}

function stateManager(projectDir: string): PipelineStateManager {
  return new PipelineStateManager(join(projectDir, "pipeline-state.json"));
}

/** Any research edit invalidates a prior approval (checked by content hash, not this
 * counter — see production-gate.ts); the counter itself is display-only (spec §13). */
function bumpResearchRevision(projectDir: string): void {
  stateManager(projectDir).bumpRevision("research");
}

// --- Research questions ---

const QUESTION_PATCH_KEYS = ["questionText", "priority", "status", "relevant", "requiredEvidenceLevel", "freshnessRequirement"] as const;

export function patchQuestion(projectId: string, projectDir: string, questionId: string, patchInput: unknown): ResearchQuestionSet {
  if (!patchInput || typeof patchInput !== "object") throw new ResearchEditValidationError("Request body must be an object.");
  const patch: Record<string, unknown> = {};
  for (const key of QUESTION_PATCH_KEYS) {
    if (key in (patchInput as Record<string, unknown>)) patch[key] = (patchInput as Record<string, unknown>)[key];
  }

  const updated = editArtifactWithRevision<ResearchQuestionSet>(
    projectId,
    projectDir,
    "research/research-questions.json",
    `Edit question ${questionId}`,
    (current) => {
      if (!current) throw new ResearchEditValidationError("No research questions exist yet for this project.");
      const parsed = ResearchQuestionSetSchema.parse(current);
      const q = parsed.questions.find((q) => q.questionId === questionId);
      if (!q) throw new ResearchEditValidationError(`Unknown question "${questionId}".`);
      Object.assign(q, patch, { editedBy: "HUMAN" as const });
      return ResearchQuestionSetSchema.parse(parsed);
    }
  );
  bumpResearchRevision(projectDir);
  return updated;
}

export function addQuestion(
  projectId: string,
  projectDir: string,
  input: Pick<ResearchQuestion, "questionId" | "category" | "questionText" | "priority" | "requiredEvidenceLevel" | "freshnessRequirement">
): ResearchQuestionSet {
  const updated = editArtifactWithRevision<ResearchQuestionSet>(
    projectId,
    projectDir,
    "research/research-questions.json",
    `Add question ${input.questionId}`,
    (current) => {
      if (!current) throw new ResearchEditValidationError("No research questions exist yet for this project.");
      const parsed = ResearchQuestionSetSchema.parse(current);
      if (parsed.questions.some((q) => q.questionId === input.questionId)) {
        throw new ResearchEditValidationError(`Question id "${input.questionId}" already exists.`);
      }
      parsed.questions.push({
        ...input,
        status: "open",
        dependentQuestions: [],
        answeredBy: [],
        editedBy: "HUMAN",
        relevant: true
      });
      return ResearchQuestionSetSchema.parse(parsed);
    }
  );
  bumpResearchRevision(projectDir);
  return updated;
}

// --- Evidence graph: evidence / data points ---

function loadGraphOrThrow(current: EvidenceGraph | null): EvidenceGraph {
  if (!current) throw new ResearchEditValidationError("No evidence graph exists yet for this project.");
  return EvidenceGraphSchema.parse(current);
}

export function patchEvidence(projectId: string, projectDir: string, evidenceId: string, patchInput: unknown): EvidenceGraph {
  if (!patchInput || typeof patchInput !== "object") throw new ResearchEditValidationError("Request body must be an object.");
  const allowed = ["evidenceExcerpt", "claim", "dataValue", "unit", "confidence", "relevance", "notes"] as const;
  const patch: Record<string, unknown> = {};
  for (const key of allowed) if (key in (patchInput as Record<string, unknown>)) patch[key] = (patchInput as Record<string, unknown>)[key];

  const updated = editArtifactWithRevision<EvidenceGraph>(projectId, projectDir, "research/evidence-graph.json", `Edit evidence ${evidenceId}`, (current) => {
    const graph = loadGraphOrThrow(current);
    const ev = graph.evidence.find((e) => e.evidenceId === evidenceId);
    if (!ev) throw new ResearchEditValidationError(`Unknown evidence "${evidenceId}".`);
    Object.assign(ev, patch, { provenance: "HUMAN_EDIT" as const });
    return EvidenceGraphSchema.parse(graph);
  });
  bumpResearchRevision(projectDir);
  return updated;
}

/** A human-provided number with no supplied source is UNVERIFIED, never silently treated as verified research (spec §9). */
export function addEvidence(
  projectId: string,
  projectDir: string,
  input: Partial<Evidence> & Pick<Evidence, "evidenceId" | "evidenceExcerpt">
): EvidenceGraph {
  const updated = editArtifactWithRevision<EvidenceGraph>(projectId, projectDir, "research/evidence-graph.json", `Add evidence ${input.evidenceId}`, (current) => {
    const graph = loadGraphOrThrow(current);
    if (graph.evidence.some((e) => e.evidenceId === input.evidenceId)) {
      throw new ResearchEditValidationError(`Evidence id "${input.evidenceId}" already exists.`);
    }
    const hasSource = !!input.sourceId && graph.sources.some((s) => s.sourceId === input.sourceId);
    // Build explicitly rather than spreading `input` over defaults — spreading last would
    // let an `undefined` field in `input` silently clobber a default value below it.
    graph.evidence.push({
      evidenceId: input.evidenceId,
      sourceId: input.sourceId ?? "",
      evidenceExcerpt: input.evidenceExcerpt,
      claim: input.claim,
      dataValue: input.dataValue,
      unit: input.unit,
      date: input.date,
      geography: input.geography,
      entity: input.entity,
      methodology: input.methodology,
      notes: input.notes,
      confidence: input.confidence ?? 0.5,
      relevance: input.relevance ?? 0.5,
      temporalStatus: input.temporalStatus ?? "CURRENT",
      provenance: hasSource ? "HUMAN_EDIT" : "UNVERIFIED"
    });
    return EvidenceGraphSchema.parse(graph);
  });
  bumpResearchRevision(projectDir);
  return updated;
}

export function deleteEvidence(projectId: string, projectDir: string, evidenceId: string): EvidenceGraph {
  const updated = editArtifactWithRevision<EvidenceGraph>(projectId, projectDir, "research/evidence-graph.json", `Delete evidence ${evidenceId}`, (current) => {
    const graph = loadGraphOrThrow(current);
    const idx = graph.evidence.findIndex((e) => e.evidenceId === evidenceId);
    if (idx === -1) throw new ResearchEditValidationError(`Unknown evidence "${evidenceId}".`);
    graph.evidence.splice(idx, 1);
    return EvidenceGraphSchema.parse(graph);
  });
  bumpResearchRevision(projectDir);
  return updated;
}

/** Preview-only: what would become stale if `evidenceId` were removed, without writing anything. */
export function previewEvidenceRemovalImpact(projectDir: string, evidenceId: string): StalenessReport {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.evidenceGraph) throw new ResearchEditValidationError("No evidence graph exists yet for this project.");
  const hypothetical: EvidenceGraph = {
    ...artifacts.evidenceGraph,
    evidence: artifacts.evidenceGraph.evidence.filter((e) => e.evidenceId !== evidenceId)
  };
  return computeStaleness({
    evidenceGraph: hypothetical,
    script: artifacts.script,
    argument: artifacts.argument,
    visualEvidenceMap: artifacts.visualEvidenceMap
  });
}

export function computeStalenessForProject(projectDir: string): StalenessReport {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.evidenceGraph) throw new ResearchEditValidationError("No evidence graph exists yet for this project.");
  return computeStaleness({
    evidenceGraph: artifacts.evidenceGraph,
    script: artifacts.script,
    argument: artifacts.argument,
    visualEvidenceMap: artifacts.visualEvidenceMap
  });
}

// --- Approval ---

export interface ResearchApproveResult {
  approved: true;
  warnings: string[];
}

export function approveResearch(projectDir: string): ResearchApproveResult {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.evidenceGraph) throw new ResearchEditValidationError("No evidence graph exists yet; research is not ready for approval.");

  const integrity = checkEvidenceGraphIntegrity(artifacts.evidenceGraph);
  if (integrity.errors.length > 0) {
    throw new ResearchEditValidationError(`Evidence graph has unresolved reference(s): ${integrity.errors.join("; ")}`);
  }

  const warnings = [...integrity.warnings];
  if (artifacts.researchGaps && artifacts.researchPlan) {
    const assessment = assessResearchCompleteness(artifacts.researchGaps, artifacts.researchPlan);
    if (assessment.blocking) throw new ResearchEditValidationError(assessment.message);
    warnings.push(...artifacts.researchGaps.gaps.map((g) => g.description));
  }

  const hash = computeResearchStateHash(projectDir);
  const state = stateManager(projectDir);
  state.approve("research", { approvedArtifactHash: hash });
  state.setProductionPhase("RESEARCH_APPROVED");
  return { approved: true, warnings };
}

// --- Request more research (spec §12): reuses AgentTaskGate as-is, no new mechanism ---

export function requestMoreResearch(
  projectDir: string,
  repoRoot: string,
  input: { instruction: string; targetQuestionId?: string; targetClaimId?: string }
): { stage: string; briefPath: string } {
  if (!input.instruction || !input.instruction.trim()) {
    throw new ResearchEditValidationError("An instruction is required.");
  }
  const stage = `research-addendum-${Date.now()}`;
  const gate = new AgentTaskGate({ projectDir, repoRoot });
  try {
    gate.request({
      stage,
      title: `Additional research: ${input.instruction.slice(0, 60)}`,
      reason: "A human reviewing this project's research requested additional, targeted research.",
      artifactPath: `research/addenda/${stage}.json`,
      schemaName: "ResearchAddendumSchema",
      schemaFiles: ["src/schemas/research-addendum.ts"],
      mission:
        `The human reviewing this documentary's research asked for more, specifically:\n\n"${input.instruction}"\n\n` +
        `Do not redo the entire research pass — find only what answers this specific request, and return it as ` +
        `new sources/evidence/dataPoints the pipeline can merge into the existing evidence graph. Every new item ` +
        `needs the same rigor as the original research (real sources, no invented numbers).`,
      context: {
        instruction: input.instruction,
        targetQuestionId: input.targetQuestionId,
        targetClaimId: input.targetClaimId
      },
      requirements: [
        "Every newSources/newEvidence/newDataPoints entry must use a fresh, unique id not already present in research/evidence-graph.json.",
        "Cite a real, retrievable source for every new evidence/data point — no invented numbers.",
        "Keep the addendum narrowly scoped to the instruction; do not attempt to redo unrelated research."
      ],
      prohibitions: ["Never invent a source, quote, or number.", "Never modify or remove existing evidence-graph.json content from this addendum."],
      inputs: [
        { label: "Current evidence graph", path: "research/evidence-graph.json", inline: true },
        ...(input.targetQuestionId ? [{ label: "Research questions", path: "research/research-questions.json", inline: true }] : [])
      ]
    });
  } catch (err) {
    if (isAgentTaskPending(err)) return { stage, briefPath: err.briefPath };
    throw err;
  }
  throw new Error("unreachable");
}
