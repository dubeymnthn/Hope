import { join } from "node:path";
import { ScriptResultSchema, ScriptResult } from "../../../src/schemas/script.js";
import { ScriptQAAgent } from "../../../src/agents/script-qa.js";
import { computeScriptStateHash } from "../../../src/orchestrator/production-gate.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { AgentTaskGate, isAgentTaskPending } from "../../../src/agents/agent-task.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { editArtifactWithRevision } from "./revisions.js";
import { SceneEditValidationError } from "./beat-editor.js";

function stateManager(projectDir: string): PipelineStateManager {
  return new PipelineStateManager(join(projectDir, "pipeline-state.json"));
}

function bumpScriptRevision(projectDir: string): void {
  stateManager(projectDir).bumpRevision("script");
}

export function deleteScene(projectId: string, projectDir: string, sceneId: string): ScriptResult {
  const updated = editArtifactWithRevision<ScriptResult>(projectId, projectDir, "script/script.json", `Delete scene ${sceneId}`, (current) => {
    if (!current) throw new SceneEditValidationError("No script exists yet for this project.");
    const parsed = ScriptResultSchema.parse(current);
    const idx = parsed.scenes.findIndex((s) => s.id === sceneId);
    if (idx === -1) throw new SceneEditValidationError(`Unknown scene "${sceneId}".`);
    if (parsed.scenes.length === 1) throw new SceneEditValidationError("Cannot delete the only scene in the script.");
    parsed.scenes.splice(idx, 1);
    for (const chapter of parsed.chapters ?? []) {
      if (chapter.sceneIds) chapter.sceneIds = chapter.sceneIds.filter((id) => id !== sceneId);
    }
    parsed.totalWordCount = parsed.scenes.reduce((sum, s) => sum + (s.wordCount ?? 0), 0);
    return ScriptResultSchema.parse(parsed);
  });
  bumpScriptRevision(projectDir);
  return updated;
}

export function moveScene(projectId: string, projectDir: string, sceneId: string, toIndex: number): ScriptResult {
  const updated = editArtifactWithRevision<ScriptResult>(projectId, projectDir, "script/script.json", `Move scene ${sceneId}`, (current) => {
    if (!current) throw new SceneEditValidationError("No script exists yet for this project.");
    const parsed = ScriptResultSchema.parse(current);
    const fromIndex = parsed.scenes.findIndex((s) => s.id === sceneId);
    if (fromIndex === -1) throw new SceneEditValidationError(`Unknown scene "${sceneId}".`);
    const clampedTo = Math.max(0, Math.min(toIndex, parsed.scenes.length - 1));
    const [scene] = parsed.scenes.splice(fromIndex, 1);
    parsed.scenes.splice(clampedTo, 0, scene);
    return ScriptResultSchema.parse(parsed);
  });
  bumpScriptRevision(projectDir);
  return updated;
}

/** An explicit, justified override — never a silent re-verification (spec §18). */
export function overrideClaimProvenance(
  projectId: string,
  projectDir: string,
  sceneId: string,
  scriptClaimId: string,
  justification: string
): ScriptResult {
  if (!justification || !justification.trim()) throw new SceneEditValidationError("An override justification is required.");
  const updated = editArtifactWithRevision<ScriptResult>(
    projectId,
    projectDir,
    "script/script.json",
    `Override provenance for ${sceneId}/${scriptClaimId}`,
    (current) => {
      if (!current) throw new SceneEditValidationError("No script exists yet for this project.");
      const parsed = ScriptResultSchema.parse(current);
      const scene = parsed.scenes.find((s) => s.id === sceneId);
      if (!scene) throw new SceneEditValidationError(`Unknown scene "${sceneId}".`);
      const claim = (scene.scriptClaims ?? []).find((c) => c.scriptClaimId === scriptClaimId);
      if (!claim) throw new SceneEditValidationError(`Unknown claim "${scriptClaimId}" in scene "${sceneId}".`);
      claim.provenanceStatus = "HUMAN_OVERRIDDEN";
      claim.overrideReason = justification;
      claim.overriddenAt = new Date().toISOString();
      return ScriptResultSchema.parse(parsed);
    }
  );
  bumpScriptRevision(projectDir);
  return updated;
}

export interface ScriptApproveResult {
  approved: true;
  warnings: string[];
}

export class ScriptApprovalBlockedError extends SceneEditValidationError {}

/** Re-runs the real claim gate one more time before recording approval — an edit that
 * silently regressed evidence traceability or claim numeric fidelity must never slip
 * through just because it was approved once before the edit (spec §18-20). */
export async function approveScript(projectDir: string): Promise<ScriptApproveResult> {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.script) throw new SceneEditValidationError("No script exists yet; it is not ready for approval.");

  const flaggedClaims: string[] = [];
  for (const scene of artifacts.script.scenes) {
    for (const claim of scene.scriptClaims ?? []) {
      if (claim.provenanceStatus === "PROVENANCE_REQUIRES_REVIEW") flaggedClaims.push(`${scene.id}/${claim.scriptClaimId}`);
    }
  }
  if (flaggedClaims.length > 0) {
    throw new ScriptApprovalBlockedError(
      `${flaggedClaims.length} claim(s) still require provenance review before approval: ${flaggedClaims.join(", ")}. ` +
        `Re-validate, supply new evidence, or explicitly override each one first.`
    );
  }

  const qa = await new ScriptQAAgent().evaluate({
    script: artifacts.script,
    research: artifacts.research ?? undefined,
    argument: artifacts.argument ?? undefined,
    evidenceGraph: artifacts.evidenceGraph ?? undefined,
    outputDir: projectDir
  });
  // Approval re-validates specifically for what a human edit could have broken — evidence
  // traceability/numeric fidelity — not the full editorial/duration report (those were
  // already assessed once at script-generation time via the orchestrator's own claim-gate
  // stage, which ran before this script ever reached review; re-litigating "too few
  // scenes" on every approval click would block on things no edit here could have caused).
  const evidenceFailed = qa.checks.filter((c) => c.category === "evidence" && !c.passed);
  if (evidenceFailed.length > 0) {
    throw new ScriptApprovalBlockedError(`Claim gate evidence check(s) failed: ${evidenceFailed.map((c) => c.message).join("; ")}`);
  }

  const hash = computeScriptStateHash(projectDir);
  const state = stateManager(projectDir);
  state.approve("script", { approvedArtifactHash: hash });
  state.setProductionPhase("SCRIPT_APPROVED");
  return { approved: true, warnings: qa.warnings };
}

export function requestScriptRevision(
  projectDir: string,
  repoRoot: string,
  input: { instruction: string; sceneId?: string }
): { stage: string; briefPath: string } {
  if (!input.instruction || !input.instruction.trim()) throw new SceneEditValidationError("An instruction is required.");
  const stage = `script-revision-${Date.now()}`;
  const gate = new AgentTaskGate({ projectDir, repoRoot });
  try {
    gate.request({
      stage,
      title: `Script revision request${input.sceneId ? ` (${input.sceneId})` : ""}`,
      reason: "A human reviewing this project's script requested a targeted revision.",
      artifactPath: "script/script.json",
      schemaName: "ScriptResultSchema",
      schemaFiles: ["src/schemas/script.ts"],
      mission:
        `The human reviewing this documentary's script asked for a revision:\n\n"${input.instruction}"\n\n` +
        (input.sceneId
          ? `Focus the revision on scene "${input.sceneId}"; leave every other scene's narration untouched unless the ` +
            `requested change genuinely requires a knock-on edit elsewhere.`
          : `Preserve every scene's evidence traceability (scriptClaims/evidenceIds) unless the instruction explicitly ` +
            `asks to change the underlying claim.`) +
        `\n\nRewrite script/script.json in place, in full, satisfying its schema.`,
      context: { instruction: input.instruction, sceneId: input.sceneId },
      requirements: [
        "Every scriptClaim's evidenceIds must still resolve into research/evidence-graph.json.",
        "Do not change scenes the instruction did not ask you to touch.",
        "Recompute wordCount for any scene whose narration changed."
      ],
      prohibitions: ["Never invent a new factual claim without a supporting evidence id.", "Never silently drop a scene the instruction didn't ask to remove."],
      inputs: [
        { label: "Current script", path: "script/script.json", inline: true },
        { label: "Editorial argument", path: "argument/argument.json", inline: true },
        { label: "Evidence graph", path: "research/evidence-graph.json", inline: true }
      ]
    });
  } catch (err) {
    if (isAgentTaskPending(err)) return { stage, briefPath: err.briefPath };
    throw err;
  }
  throw new Error("unreachable");
}
