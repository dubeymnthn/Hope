import { z } from "zod";

export const VideoConfigSchema = z.object({
  targetDurationMinutes: z.number().default(10),
  minimumDurationMinutes: z.number().default(7),
  maximumDurationMinutes: z.number().default(13),
  preferredChapters: z.number().default(8),
  allowDynamicChapterCount: z.boolean().default(true),
  wordsPerMinuteEstimate: z.number().default(150)
});
export type VideoConfig = z.infer<typeof VideoConfigSchema>;

export const EditorialConfigSchema = z.object({
  requireThesis: z.boolean().default(true),
  requireSourceTraceability: z.boolean().default(true),
  allowNarrativeSpeculation: z.boolean().default(true),
  maxConsecutiveSameVisualMode: z.number().default(2),
  antiSlopMode: z.boolean().default(true),
  coldOpenMaxSeconds: z.number().default(30),
  retentionRefreshIntervalSeconds: z.number().default(90)
});
export type EditorialConfig = z.infer<typeof EditorialConfigSchema>;

export const VisualStyleConfigSchema = z.object({
  type: z.string().default("modern-documentary"),
  density: z.string().default("high"),
  motion: z.string().default("medium")
});
export type VisualStyleConfig = z.infer<typeof VisualStyleConfigSchema>;

export const VoiceConfigSchema = z.object({
  provider: z.string().default("local"),
  voice: z.string().default("am_adam"),
  speed: z.number().default(1.0)
});
export type VoiceConfig = z.infer<typeof VoiceConfigSchema>;

export const VersionsConfigSchema = z.object({
  scriptGenerator: z.string().default("2.0.0"),
  storyboardGenerator: z.string().default("2.0.0"),
  visualGenerator: z.string().default("3.0.0")
});
export type VersionsConfig = z.infer<typeof VersionsConfigSchema>;

export const ChannelConfigSchema = z.object({
  channelName: z.string().default("Tech Explained"),
  language: z.string().default("en"),
  videoFormat: z.string().default("16:9"),
  resolution: z.string().default("1920x1080"),
  fps: z.number().default(30),
  targetDurationSeconds: z.number().optional().default(600),
  video: VideoConfigSchema.optional().default({}),
  editorial: EditorialConfigSchema.optional().default({}),
  visualStyle: VisualStyleConfigSchema.optional().default({}),
  voice: VoiceConfigSchema.optional().default({}),
  versions: VersionsConfigSchema.optional().default({})
});
export type ChannelConfig = z.infer<typeof ChannelConfigSchema>;
