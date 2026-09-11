import { ScriptResultSchema, ScriptResult } from "../../../src/schemas/script.js";
import { ScriptQAAgent, ScriptQAReport } from "../../../src/agents/script-qa.js";
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
      scene.narration = narration;
      scene.wordCount = narration.trim().split(/\s+/).filter(Boolean).length;
      return ScriptResultSchema.parse(parsed);
    }
  );

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
