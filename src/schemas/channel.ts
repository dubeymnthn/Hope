import { z } from "zod";

/**
 * Measured narration-rate calibration (spec V2.2 §3).
 *
 * The planning rate is derived from real synthesis runs, never assumed. Every field
 * records where the number came from so it can be audited and recalibrated. A missing
 * block means "uncalibrated": the planner falls back to the legacy estimate and says so.
 */
export const TtsCalibrationSchema = z.object({
  ttsWordsPerMinute: z.number().positive().describe("Measured spoken words per minute from real synthesis"),
  measuredAt: z.string().describe("ISO timestamp of the benchmark run that produced this rate"),
  measuredFrom: z.string().describe("Workspace or run identifier the measurement came from"),
  sampleWords: z.number().int().positive().describe("Words in the measured narration"),
  sampleSeconds: z.number().positive().describe("Measured narration duration in seconds"),
  device: z.string().describe("TTS device the sample was synthesised on"),
  chatterboxVersion: z.string().optional().describe("chatterbox-tts version at measurement time"),
  voice: z.string().optional().describe("Voice identifier used for the sample")
});
export type TtsCalibration = z.infer<typeof TtsCalibrationSchema>;

export const VideoConfigSchema = z.object({
  targetDurationMinutes: z.number().default(10),
  minimumDurationMinutes: z.number().default(7),
  maximumDurationMinutes: z.number().default(13),
  /** Narrower band the planner aims for around the target (spec V2.2 §3: 9-11 for a 10 min target). */
  targetToleranceMinutes: z.number().default(1),
  preferredChapters: z.number().default(8),
  allowDynamicChapterCount: z.boolean().default(true),
  /**
   * Legacy planning estimate, used only when no calibration block exists. Kept for
   * backward compatibility; production planning reads `calibration.ttsWordsPerMinute`.
   */
  wordsPerMinuteEstimate: z.number().default(150),
  calibration: TtsCalibrationSchema.optional()
});
export type VideoConfig = z.infer<typeof VideoConfigSchema>;

/** The narration rate the planner should use, and where it came from. */
export function resolvePlanningRate(video?: VideoConfig): {
  wordsPerMinute: number;
  source: "calibration" | "legacy-estimate";
  calibration?: TtsCalibration;
} {
  if (video?.calibration) {
    return { wordsPerMinute: video.calibration.ttsWordsPerMinute, source: "calibration", calibration: video.calibration };
  }
  return { wordsPerMinute: video?.wordsPerMinuteEstimate ?? 150, source: "legacy-estimate" };
}

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
