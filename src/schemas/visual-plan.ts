import { z } from "zod";
import { VisualModeEnum, BeatChangeTypeEnum, BeatFocusSchema } from "./storyboard.js";

/**
 * Visual Plan — the Antigravity Visual Director's output.
 *
 * The Visual Director decides WHAT should be visualised for each scene. It does not
 * decide scene timing: scene start/duration are derived deterministically from the
 * authoritative audio alignment. Beat offsets are expressed in seconds relative to
 * scene start and are validated (and clamped) against the real audio duration.
 */

export const PlannedDataPointSchema = z.object({
  metric: z.string().describe("What is measured, e.g. 'average unit price'"),
  value: z.string().describe("The value exactly as supported by research"),
  unit: z.string().optional().describe("Unit, e.g. '%', 'USD/GB', 'weeks'"),
  period: z.string().optional().describe("Timeframe the value applies to"),
  claimId: z
    .string()
    .optional()
    .describe("Research claim/fact this datum comes from (statement text or id)"),
  sourceId: z
    .string()
    .optional()
    .describe("Source title or URL from research.sources backing this datum")
});
export type PlannedDataPoint = z.infer<typeof PlannedDataPointSchema>;

export const PlannedBeatSchema = z.object({
  beatId: z.string().describe("Beat identifier within the scene"),
  startOffset: z.number().nonnegative().describe("Seconds from scene start"),
  endOffset: z.number().positive().describe("Seconds from scene start"),
  purpose: z.string().describe("What this beat accomplishes narratively"),
  visualChange: z.string().describe("The visual state change during this beat"),
  animationDirective: z.string().optional().describe("Animation intent for this beat"),
  emphasisWords: z
    .array(z.string())
    .optional()
    .describe("Narration words this beat should land on, for editorial sync"),

  // --- V2.2 beat model (spec §10-§12). Optional so V2 plans still validate. ---
  visualState: z
    .string()
    .optional()
    .describe("Named state of the composition during this beat, e.g. 'cathode band emphasised'"),
  changeType: BeatChangeTypeEnum.optional().describe(
    "Editorial function: establish, reveal, transform, compare, zoom, pan, highlight, build, remove, reframe, resolve, transition, or hold"
  ),
  focus: BeatFocusSchema.optional().describe("What the eye lands on first, second, and what merely supports"),
  narrationReference: z
    .string()
    .optional()
    .describe("The narration idea this beat answers: abstract->concrete, comparison, cause->effect, contradiction, scale, consequence, payoff"),
  holdJustification: z
    .string()
    .optional()
    .describe("If this beat is a hold or runs past ~15s, say why the viewer needs the time")
});
export type PlannedBeat = z.infer<typeof PlannedBeatSchema>;

export const VisualPlanSceneSchema = z.object({
  sceneId: z.string().describe("Must match a script scene id, e.g. scene-003"),
  visualMode: VisualModeEnum.describe("The rendering mode that carries this scene's meaning"),
  visualDescription: z
    .string()
    .describe("What the frame shows: composition, hierarchy, and what the graphic communicates"),
  onScreenText: z.string().describe("Typographic callout, 3-6 punchy words (may be empty)"),
  animationIntent: z.string().describe("Motion intent, expressed editorially not as code"),
  camera: z.string().describe("Camera treatment, e.g. 'static', 'slow push-in'"),
  transitionIn: z.string().optional().describe("How this scene enters from the previous one"),
  narrativePurpose: z.string().describe("Why this scene exists in the argument"),
  claimsShown: z.array(z.string()).optional().default([]).describe("Claims visually represented"),
  sourceReferences: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Only sources relevant to THIS scene; leave empty when none apply"),
  dataPoints: z
    .array(PlannedDataPointSchema)
    .optional()
    .default([])
    .describe("Empirical values the renderer may display; must trace to research"),
  diagramNodes: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Labelled nodes for diagram/flow modes, in reading order"),
  diagramEdges: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Edges as 'From -> To' or 'From -> To : label'"),
  timelineEvents: z
    .array(z.object({ label: z.string(), when: z.string(), detail: z.string().optional() }))
    .optional()
    .default([])
    .describe("Ordered events for timeline / historical_sequence modes"),
  comparisonSides: z
    .array(z.object({ label: z.string(), value: z.string().optional(), detail: z.string().optional() }))
    .optional()
    .default([])
    .describe("Sides for comparison mode"),
  visualOpportunityIds: z
    .array(z.string())
    .optional()
    .default([])
    .describe("V2.3: visual-evidence-map.json visualOpportunityIds this scene fulfils, for provenance (spec §30)"),
  beats: z.array(PlannedBeatSchema).min(1).describe("Visual beats across the scene")
});
export type VisualPlanScene = z.infer<typeof VisualPlanSceneSchema>;

export const VisualPlanSchema = z.object({
  topic: z.string().describe("Topic this visual plan serves"),
  videoTitle: z.string().describe("Video title"),
  visualThesis: z
    .string()
    .describe("How the visual language as a whole carries this specific argument"),
  scenes: z.array(VisualPlanSceneSchema).min(1).describe("One entry per script scene, in order"),
  version: z.string().optional().default("2.0.0")
});
export type VisualPlan = z.infer<typeof VisualPlanSchema>;
