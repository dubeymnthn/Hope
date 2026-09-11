import { VisualPlanSchema, VisualPlan, PlannedBeatSchema, VisualPlanSceneSchema } from "../../../src/schemas/visual-plan.js";
import { StoryboardAgent } from "../../../src/agents/storyboard.js";
import { DesignDirectorAgent } from "../../../src/agents/design-director.js";
import { readProjectArtifacts } from "./artifact-reader.js";
import { editArtifactWithRevision } from "./revisions.js";

export class SceneEditValidationError extends Error {}

/** Only these beat fields are ever accepted; anything else in the request body is ignored. */
const BeatPatchSchema = PlannedBeatSchema.partial().pick({
  startOffset: true,
  endOffset: true,
  purpose: true,
  visualChange: true,
  animationDirective: true,
  emphasisWords: true,
  visualState: true,
  changeType: true,
  focus: true,
  narrationReference: true,
  holdJustification: true
});

/** Presentational-only scene fields. No dataPoints/claimsShown/sourceReferences/etc — those assert facts (spec V2.4 §41). */
const FORBIDDEN_SCENE_KEYS = new Set([
  "dataPoints",
  "claimsShown",
  "sourceReferences",
  "diagramNodes",
  "diagramEdges",
  "timelineEvents",
  "comparisonSides",
  "beats",
  "visualMode",
  "sceneId",
  "visualOpportunityIds"
]);
const ScenePresentationalPatchSchema = VisualPlanSceneSchema.pick({
  onScreenText: true,
  camera: true,
  animationIntent: true,
  transitionIn: true,
  visualDescription: true,
  narrativePurpose: true
}).partial();

/** After any visual-plan.json edit, keep storyboard.json in sync immediately — this is
 * the real, deterministic merge step the orchestrator already runs (StoryboardAgent.
 * assemble()), just triggered right away instead of waiting for a full pipeline re-run.
 * Skipped when TTS hasn't produced real audio timing yet (nothing to align against). */
function reassembleStoryboardIfPossible(projectDir: string): void {
  const artifacts = readProjectArtifacts(projectDir);
  if (!artifacts.script || !artifacts.audio || !artifacts.visualPlan) return;
  try {
    const design = new DesignDirectorAgent().getDesign();
    new StoryboardAgent().assemble({
      script: artifacts.script,
      audio: artifacts.audio,
      plan: artifacts.visualPlan,
      outputDir: projectDir,
      design,
      research: artifacts.research ?? undefined
    });
  } catch (err: any) {
    console.warn(`[studio] Could not reassemble storyboard after edit: ${err.message}`);
  }
}

function findScene(plan: VisualPlan, sceneId: string) {
  const scene = plan.scenes.find((s) => s.sceneId === sceneId);
  if (!scene) throw new SceneEditValidationError(`Unknown scene "${sceneId}".`);
  return scene;
}

export function patchBeat(projectId: string, projectDir: string, sceneId: string, beatId: string, patchInput: unknown): VisualPlan {
  const parsed = BeatPatchSchema.safeParse(patchInput);
  if (!parsed.success) throw new SceneEditValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const patch = parsed.data;

  // The scene's real duration, when known (post-TTS) — bounds the beat, never invented.
  const artifacts = readProjectArtifacts(projectDir);
  const sceneDuration =
    artifacts.storyboard?.scenes.find((s) => s.id === sceneId)?.duration ??
    artifacts.audio?.sentences.find((s) => s.sceneId === sceneId)?.duration;

  const updated = editArtifactWithRevision<VisualPlan>(
    projectId,
    projectDir,
    "storyboard/visual-plan.json",
    `Edit beat ${beatId} in ${sceneId}`,
    (current) => {
      if (!current) throw new SceneEditValidationError("No visual plan exists yet for this project.");
      const plan = VisualPlanSchema.parse(current);
      const scene = findScene(plan, sceneId);
      const beat = scene.beats.find((b) => b.beatId === beatId);
      if (!beat) throw new SceneEditValidationError(`Unknown beat "${beatId}" in scene "${sceneId}".`);

      const merged = { ...beat, ...patch };
      if (merged.startOffset < 0) throw new SceneEditValidationError("A beat's startOffset cannot be negative.");
      if (merged.endOffset <= merged.startOffset) throw new SceneEditValidationError("A beat's endOffset must be after its startOffset (non-negative duration).");
      if (sceneDuration !== undefined && merged.endOffset > sceneDuration + 0.01) {
        throw new SceneEditValidationError(`Beat endOffset ${merged.endOffset}s exceeds the scene's real duration (${sceneDuration}s).`);
      }
      Object.assign(beat, merged);
      return VisualPlanSchema.parse(plan);
    }
  );

  reassembleStoryboardIfPossible(projectDir);
  return updated;
}

export function patchScenePresentational(projectId: string, projectDir: string, sceneId: string, patchInput: unknown): VisualPlan {
  if (patchInput && typeof patchInput === "object") {
    const forbidden = Object.keys(patchInput).filter((k) => FORBIDDEN_SCENE_KEYS.has(k));
    if (forbidden.length > 0) {
      throw new SceneEditValidationError(
        `Cannot edit ${forbidden.join(", ")} through the presentational scene editor: these fields assert verified ` +
          `facts and can only change through the real research/visual-evidence pipeline (spec V2.4 §41).`
      );
    }
  }
  const parsed = ScenePresentationalPatchSchema.safeParse(patchInput);
  if (!parsed.success) throw new SceneEditValidationError(parsed.error.issues.map((i) => i.message).join("; "));
  const patch = parsed.data;

  const updated = editArtifactWithRevision<VisualPlan>(
    projectId,
    projectDir,
    "storyboard/visual-plan.json",
    `Edit presentation of ${sceneId}`,
    (current) => {
      if (!current) throw new SceneEditValidationError("No visual plan exists yet for this project.");
      const plan = VisualPlanSchema.parse(current);
      const scene = findScene(plan, sceneId);
      Object.assign(scene, patch);
      return VisualPlanSchema.parse(plan);
    }
  );

  reassembleStoryboardIfPossible(projectDir);
  return updated;
}
