import { z } from "zod";
import { VisualTypeEnum } from "./storyboard.js";

/**
 * V2.6 `design.md` system (spec §3-§6, §23-§25, §36-§37).
 *
 * This is a DIFFERENT, higher-altitude concept from `src/schemas/design.ts`'s
 * `ChannelDesignSchema` (`design/channel-design.json`): that schema is literal,
 * channel-wide, deterministic rendering tokens (exact hex colors, exact font families,
 * exact easing curves) consumed directly by `scene-generator.ts`/`primitives.ts`.
 * `ProjectDesignStrategy` is per-PROJECT editorial/interpretive PREFERENCE only — it never
 * carries a hex color or font name, and never overrides `ChannelDesignSchema`. It feeds
 * into `VisualDirectorAgent` as additional guidance for the agent's own scene/visualMode
 * reasoning, the same way `visualEvidenceMap`/`evidenceGraph` are already additive inputs
 * there. Design is never factual data (spec §6): nothing here may introduce a claim,
 * number or fact into research/argument/script.
 */
export const DesignPreferenceCoreSchema = z.object({
  colorMood: z.string().optional().describe("Editorial color character in words, e.g. 'restrained, warm, editorial' — NOT a hex value; those remain design/channel-design.json's job"),
  typographyIntent: z.string().optional().describe("Editorial typography character in words, e.g. 'authoritative serif display, minimal body text'"),
  layoutPreferences: z.array(z.string()).optional().default([]),
  motionRules: z.array(z.string()).optional().default([]),
  visualRhythm: z.string().optional().describe("Overall pacing intent, e.g. 'slow, deliberate reveals' vs 'energetic, fast cuts'"),
  transitionLanguage: z.string().optional(),
  preferredVisualModes: z.array(VisualTypeEnum).optional().default([]),
  mediaPreferences: z.array(z.string()).optional().default([]),
  chartRules: z.array(z.string()).optional().default([]),
  technicalDiagramRules: z.array(z.string()).optional().default([]),
  cameraLanguage: z.array(z.string()).optional().default([]),
  captionRules: z.array(z.string()).optional().default([])
});
export type DesignPreferenceCore = z.infer<typeof DesignPreferenceCoreSchema>;

export const ProjectDesignStrategySchema = z.object({
  topic: z.string(),
  global: DesignPreferenceCoreSchema,
  /** Keyed by chapter id (storyboard/script Chapter.id). */
  chapterOverrides: z.record(DesignPreferenceCoreSchema.partial()).optional().default({}),
  /** Keyed by scene id (script/storyboard scene id). */
  sceneOverrides: z.record(DesignPreferenceCoreSchema.partial()).optional().default({}),
  sourceDesignMdHash: z.string().describe("Hash of design.md this strategy was interpreted from; a mismatch means design.md changed and this strategy is stale"),
  version: z.string().optional().default("1.0.0")
});
export type ProjectDesignStrategy = z.infer<typeof ProjectDesignStrategySchema>;
