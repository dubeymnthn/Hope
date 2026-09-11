import { z } from "zod";

export const ScriptSceneSchema = z.object({
  id: z.string().describe("Unique scene identifier, e.g. scene-001"),
  narration: z.string().describe("Spoken voiceover text for this scene beat"),
  purpose: z.string().describe("Editorial intention (e.g. 'Hook viewer with sudden price surge')"),
  visual_hint: z.string().describe("Visual cue for the storyboard agent"),
  chapter: z.string().optional().describe("Parent chapter identifier"),
  wordCount: z.number().optional().describe("Word count of the spoken voiceover"),
  estimatedDurationSeconds: z.number().optional().describe("Estimated spoken duration in seconds at ~150 wpm"),
  claims: z.array(z.string()).optional().default([]).describe("Key claims or fact citations supported in this scene"),
  visualMode: z.string().optional().describe("Intended visual mode (e.g. data_visualization, technical_diagram, comparison)")
});
export type ScriptScene = z.infer<typeof ScriptSceneSchema>;

export const ChapterSchema = z.object({
  id: z.string().describe("Chapter identifier, e.g. chapter-01"),
  title: z.string().describe("Editorial chapter title"),
  act: z.enum(["I", "II", "III"]).optional().describe("Three-act structural classification"),
  narrativePurpose: z.string().describe("Dramatic and intellectual purpose of this chapter"),
  transitionQuestion: z.string().optional().describe("Hook question leading to the subsequent chapter"),
  sceneIds: z.array(z.string()).optional().describe("IDs of scenes in this chapter")
});
export type Chapter = z.infer<typeof ChapterSchema>;

export const ScriptResultSchema = z.object({
  title: z.string().describe("Compelling title for the YouTube video"),
  hook: z.string().describe("High-retention opening thesis / hook (first 10s)"),
  scenes: z.array(ScriptSceneSchema).min(1).describe("Ordered list of narrative scenes"),
  ending: z.string().describe("Closing takeaway or call to action"),
  chapters: z.array(ChapterSchema).optional().describe("Editorial chapters segmenting the script"),
  totalWordCount: z.number().optional().describe("Total spoken words in the script"),
  estimatedDurationMinutes: z.number().optional().describe("Total estimated runtime in minutes"),
  editorialVoice: z.string().optional().describe("Tone and editorial style profile"),
  version: z.string().optional().default("2.0.0").describe("Script format version")
});
export type ScriptResult = z.infer<typeof ScriptResultSchema>;
