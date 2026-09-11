import { z } from "zod";

export const VisualTypeEnum = z.enum([
  "text",
  "image",
  "diagram",
  "chart",
  "timeline",
  "comparison",
  "statistic",
  "code",
  "map",
  "abstract",
  "data_visualization",
  "technical_diagram",
  "supply_chain_flow",
  "process_animation",
  "historical_sequence",
  "large_typography",
  "kinetic_emphasis",
  "abstract_metaphor",
  "architecture_diagram",
  "ambient_establishing",
  "evidence_document",
  // --- V2.3: visual-evidence-map modes (spec §20) ---
  "entity_network",
  "before_after",
  "geographic_flow",
  "quantitative_transformation"
]);
export type VisualType = z.infer<typeof VisualTypeEnum>;

export const VisualModeEnum = z.enum([
  "data_visualization",
  "technical_diagram",
  "timeline",
  "supply_chain_flow",
  "comparison",
  "process_animation",
  "historical_sequence",
  "large_typography",
  "kinetic_emphasis",
  "abstract_metaphor",
  "chart",
  "architecture_diagram",
  "ambient_establishing",
  "evidence_document",
  "map",
  // --- V2.3: visual-evidence-map modes (spec §20), aliased to existing renderers below ---
  "entity_network",
  "before_after",
  "geographic_flow",
  "quantitative_transformation"
]);
export type VisualMode = z.infer<typeof VisualModeEnum>;

/**
 * The editorial function a beat performs (spec V2.2 §9). A beat must change the viewer's
 * reason to look; `hold` is permitted only with an explicit justification.
 */
export const BeatChangeTypeEnum = z.enum([
  "establish",
  "reveal",
  "transform",
  "compare",
  "zoom",
  "pan",
  "highlight",
  "build",
  "remove",
  "reframe",
  "resolve",
  "transition",
  "hold"
]);
export type BeatChangeType = z.infer<typeof BeatChangeTypeEnum>;

/** Measurable visual hierarchy for a beat (spec V2.2 §11). */
export const BeatFocusSchema = z.object({
  primary: z.string().describe("The single element the viewer should look at first"),
  secondary: z.string().optional().describe("Supporting element that reads second"),
  supporting: z.array(z.string()).optional().default([]).describe("Context elements that should not compete")
});
export type BeatFocus = z.infer<typeof BeatFocusSchema>;

export const VisualBeatSchema = z.object({
  beatId: z.string().describe("Identifier for the visual beat within the scene"),
  startOffset: z.number().nonnegative().describe("Offset in seconds from scene start when beat activates"),
  endOffset: z.number().positive().describe("Offset in seconds from scene start when beat concludes"),
  purpose: z.string().describe("Narrative or visual intention of this beat"),
  visualChange: z.string().describe("State or graphical transition occurring during this beat"),
  animationDirective: z.string().optional().describe("GSAP or CSS transition instructions"),

  // --- V2.2 beat model (all optional for backward compatibility with V2 plans) ---
  visualState: z.string().optional().describe("Named visual state the composition is in during this beat"),
  changeType: BeatChangeTypeEnum.optional().describe("Editorial function this beat performs"),
  focus: BeatFocusSchema.optional().describe("Primary/secondary/supporting focus for eye-trace"),
  narrationReference: z
    .string()
    .optional()
    .describe("The narration phrase or idea this beat responds to (semantic sync, not just a timestamp)"),
  holdJustification: z
    .string()
    .optional()
    .describe("Required when changeType is `hold` or the beat exceeds ~15s: why the viewer needs this time")
});
export type VisualBeat = z.infer<typeof VisualBeatSchema>;

export const DataPointSchema = z.object({
  metric: z.string().describe("Entity or metric measured"),
  value: z.string().describe("Numerical value or comparative change"),
  unit: z.string().optional().describe("Measurement unit (e.g. '%', 'weeks', 'GB')"),
  period: z.string().optional().describe("Timeframe or benchmark context"),
  source: z.string().optional().describe("Origin citation for empirical backing")
});
export type DataPoint = z.infer<typeof DataPointSchema>;

export const StoryboardSceneSchema = z.object({
  id: z.string().describe("Scene ID, matching script scene, e.g. scene-001"),
  start: z.number().nonnegative().describe("Timestamp in seconds when this scene begins"),
  duration: z.number().positive().describe("Scene duration in seconds (derived from audio narration)"),
  narration: z.string().describe("Exact narration spoken during this scene"),
  visual_type: VisualTypeEnum.describe("Primary visual paradigm (backward compatible)"),
  visual_mode: VisualModeEnum.optional().describe("V2 documentary visual mode"),
  visual_description: z.string().describe("Detailed description of visual layout, charts, or SVG elements"),
  on_screen_text: z.string().describe("Typographic callout or title hit (3-6 punchy words)"),
  animation: z.string().describe("GSAP animation directions (e.g. 'draw SVG curve, counter eases from 0 to 280')"),
  camera: z.string().describe("Camera motion (e.g. 'slow push-in', 'static', 'pan right')"),
  assets_required: z.array(z.string()).optional().default([]).describe("Required icons, SVGs, or media files"),
  renderer: z.literal("hyperframes").optional().default("hyperframes"),
  chapter: z.string().optional().describe("Parent chapter identifier"),
  narrative_purpose: z.string().optional().describe("Detailed narrative role of this scene"),
  beats: z.array(VisualBeatSchema).optional().describe("Internal visual state transitions across the scene duration"),
  claims_shown: z.array(z.string()).optional().describe("Fact or claim IDs visually represented"),
  source_references: z.array(z.string()).optional().describe("Source citations shown on screen or in footer"),
  data_points: z.array(DataPointSchema).optional().describe("Empirical data items powering charts or graphics"),

  // --- Mode-specific payloads supplied by the Visual Director ---
  // The renderer knows HOW to draw each mode; these carry WHAT to draw (spec section 15).
  diagram_nodes: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Labelled nodes for diagram, architecture and flow modes, in reading order"),
  diagram_edges: z
    .array(z.string())
    .optional()
    .default([])
    .describe("Edges as 'From -> To' or 'From -> To : label'"),
  timeline_events: z
    .array(z.object({ label: z.string(), when: z.string(), detail: z.string().optional() }))
    .optional()
    .default([])
    .describe("Ordered events for timeline and historical_sequence modes"),
  comparison_sides: z
    .array(z.object({ label: z.string(), value: z.string().optional(), detail: z.string().optional() }))
    .optional()
    .default([])
    .describe("Sides for comparison mode"),
  transition_in: z.string().optional().describe("How this scene enters from the previous one")
});
export type StoryboardScene = z.infer<typeof StoryboardSceneSchema>;

export const StoryboardResultSchema = z.object({
  video_title: z.string().optional().default("Autonomous Video"),
  scenes: z.array(StoryboardSceneSchema).min(1).describe("Ordered scenes with synchronized timings"),
  total_duration: z.number().positive().describe("Total composition duration in seconds"),
  target_resolution: z.string().default("1920x1080"),
  target_fps: z.number().default(30),
  version: z.string().optional().describe("Storyboard schema version")
});
export type StoryboardResult = z.infer<typeof StoryboardResultSchema>;
