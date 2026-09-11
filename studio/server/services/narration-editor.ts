import { join } from "node:path";
import { ScriptResultSchema, ScriptResult } from "../../../src/schemas/script.js";
import { ScriptQAAgent, ScriptQAReport, detectFactualDrift, sceneNarrationMatchesEvidence } from "../../../src/agents/script-qa.js";
import { PipelineStateManager } from "../../../src/orchestrator/pipeline-state.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { editArtifactWithRevision } from "./revisions.js";
import { SceneEditValidationError } from "./beat-editor.js";

/**
 * Narration text edits are self-invalidating for TTS: `VoiceAgent.generate()` keys its
 * per-scene cache on `sha256(narration.trim())` (src/agents/voice.ts), so changing the
 * text here means the NEXT real TTS run resynthesizes exactly this scene and reuses
 * every other scene's cached audio — no manual cache invalidation needed here.
 *
 * What this function DOES do for real, inline, before returning: re-run the actual
 * claim gate (`ScriptQAAgent.evaluate()`, the same class the orchestrator uses) so an
 * edit that breaks evidence traceability is caught immediately, not silently accepted
 * (spec V2.4 §20/§31).
 *
 * V2.6 provenance: when an evidence graph is available, `sceneNarrationMatchesEvidence`
 * is used to both SET and CLEAR `PROVENANCE_REQUIRES_REVIEW` on this scene's claims — the
 * identical check both directions, so a flag can never be cleared by a lens that didn't
 * actually re-examine what set it. Without an evidence graph, `detectFactualDrift` is a
 * coarser fallback that can only set the flag (it has nothing to revalidate against, so it
 * never clears one either — that requires an explicit override instead).
 */
export async function patchNarration(
  projectId: string,
  projectDir: string,
  sceneId: string,
  narration: string
): Promise<{ script: ScriptResult; qa: ScriptQAReport }> {
  if (typeof narration !== "string" || narration.trim().length === 0) {
    throw new SceneEditValidationError("Narration text cannot be empty.");
  }

  const evidenceGraph = readProjectArtifacts(projectDir).evidenceGraph;

  const script = editArtifactWithRevision<ScriptResult>(
    projectId,
    projectDir,
    "script/script.json",
    `Edit narration for ${sceneId}`,
    (current) => {
      if (!current) throw new SceneEditValidationError("No script exists yet for this project.");
      const parsed = ScriptResultSchema.parse(current);
      const scene = parsed.scenes.find((s) => s.id === sceneId);
      if (!scene) throw new SceneEditValidationError(`Unknown scene "${sceneId}".`);

      // Preserve the agent's original wording (first human edit only) and tag who wrote it.
      if (scene.editedBy !== "HUMAN") scene.originalNarration = scene.narration;
      const previousNarration = scene.narration;
      scene.editedBy = "HUMAN";
      scene.narration = narration;
      scene.wordCount = narration.trim().split(/\s+/).filter(Boolean).length;

      if (evidenceGraph) {
        const matches = sceneNarrationMatchesEvidence(scene, evidenceGraph);
        for (const claim of scene.scriptClaims ?? []) {
          claim.provenanceStatus = matches ? undefined : "PROVENANCE_REQUIRES_REVIEW";
        }
      } else if (detectFactualDrift(previousNarration, narration)) {
        for (const claim of scene.scriptClaims ?? []) claim.provenanceStatus = "PROVENANCE_REQUIRES_REVIEW";
      }
      return ScriptResultSchema.parse(parsed);
    }
  );

  // Any script edit invalidates a prior approval (hash-based, see production-gate.ts) —
  // the revision counter is display-only (spec §13's "Script v3"), not the approval check.
  new PipelineStateManager(join(projectDir, "pipeline-state.json")).bumpRevision("script");

  const artifacts = readProjectArtifacts(projectDir);
  const qa = await new ScriptQAAgent().evaluate({
    script,
    research: artifacts.research ?? undefined,
    argument: artifacts.argument ?? undefined,
    evidenceGraph: artifacts.evidenceGraph ?? undefined,
    outputDir: projectDir
  });

  return { script, qa };
}
