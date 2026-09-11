import { z } from "zod";

export const StageStatusEnum = z.enum(["pending", "in_progress", "completed", "failed"]);
export type StageStatus = z.infer<typeof StageStatusEnum>;

export const PipelineStagesSchema = z.object({
  research: StageStatusEnum.default("pending"),
  script: StageStatusEnum.default("pending"),
  voice: StageStatusEnum.default("pending"),
  storyboard: StageStatusEnum.default("pending"),
  visuals: StageStatusEnum.default("pending"),
  render: StageStatusEnum.default("pending"),
  qa: StageStatusEnum.default("pending")
});
export type PipelineStages = z.infer<typeof PipelineStagesSchema>;

export const PipelineStateSchema = z.object({
  topic: z.string(),
  slug: z.string(),
  outputDir: z.string(),
  stages: PipelineStagesSchema,
  completedScenes: z.array(z.string()).default([]),
  sceneHashes: z.record(z.string(), z.string()).default({}),
  lastUpdated: z.string().describe("ISO timestamp"),
  error: z.string().optional()
});
export type PipelineState = z.infer<typeof PipelineStateSchema>;

export const SceneMetadataSchema = z.object({
  sceneId: z.string(),
  hash: z.string().describe("Deterministic hash of scene content and design version"),
  visualType: z.string(),
  duration: z.number(),
  renderedAt: z.string().optional()
});
export type SceneMetadata = z.infer<typeof SceneMetadataSchema>;

export const WordTimestampSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number()
});
export type WordTimestamp = z.infer<typeof WordTimestampSchema>;

export const SentenceTimestampSchema = z.object({
  sceneId: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  duration: z.number()
});
export type SentenceTimestamp = z.infer<typeof SentenceTimestampSchema>;

export const AudioResultSchema = z.object({
  audioPath: z.string(),
  totalDuration: z.number(),
  words: z.array(WordTimestampSchema).optional(),
  sentences: z.array(SentenceTimestampSchema).default([])
});
export type AudioResult = z.infer<typeof AudioResultSchema>;

export const QAChecksSchema = z.object({
  videoExists: z.boolean(),
  audioExists: z.boolean(),
  resolutionMatches: z.boolean(),
  actualResolution: z.string(),
  targetResolution: z.string(),
  fpsMatches: z.boolean(),
  actualFps: z.string(),
  targetFps: z.number(),
  durationMatches: z.boolean(),
  videoDuration: z.number(),
  audioDuration: z.number(),
  noEmptyScenes: z.boolean(),
  captionsExist: z.boolean(),
  hyperframesCheckPassed: z.boolean()
});
export type QAChecks = z.infer<typeof QAChecksSchema>;

export const QAResultSchema = z.object({
  status: z.enum(["PASS", "FAIL"]),
  errors: z.array(z.string()).default([]),
  warnings: z.array(z.string()).default([]),
  checks: QAChecksSchema,
  contentFeedback: z.string().optional(),
  timestamp: z.string()
});
export type QAResult = z.infer<typeof QAResultSchema>;
