import { z } from "zod";

export const WordTimestampSchema = z.object({
  word: z.string(),
  start: z.number(),
  end: z.number()
});

export const SentenceTimestampSchema = z.object({
  sceneId: z.string(),
  text: z.string(),
  start: z.number(),
  end: z.number(),
  duration: z.number(),
  words: z.array(WordTimestampSchema).optional()
});

/**
 * What a production actually measured about its own narration (spec V2.2 §3, §21).
 * Recorded per run so the rate used for planning can be audited and recalibrated.
 */
export const NarrationMeasurementSchema = z.object({
  totalWords: z.number().int().nonnegative(),
  measuredWordsPerMinute: z.number().nonnegative(),
  planningWordsPerMinute: z.number().positive().describe("Rate the script was planned against"),
  planningRateSource: z.enum(["calibration", "legacy-estimate"]),
  device: z.string(),
  scenesSynthesized: z.number().int().nonnegative(),
  scenesReused: z.number().int().nonnegative(),
  synthesisSeconds: z.number().nonnegative().describe("Wall-clock spent synthesising this run (reused scenes excluded)"),
  realtimeFactor: z.number().nonnegative().optional().describe("synthesisSeconds / audio seconds generated this run"),
  measuredAt: z.string()
});
export type NarrationMeasurement = z.infer<typeof NarrationMeasurementSchema>;

export const AudioTimestampsSchema = z.object({
  audioPath: z.string(),
  sampleRate: z.number().default(24000),
  totalDuration: z.number(),
  sentences: z.array(SentenceTimestampSchema),
  /** Optional so V1 timestamps.json files still validate. */
  measurement: NarrationMeasurementSchema.optional()
});

export type WordTimestamp = z.infer<typeof WordTimestampSchema>;
export type SentenceTimestamp = z.infer<typeof SentenceTimestampSchema>;
export type AudioTimestamps = z.infer<typeof AudioTimestampsSchema>;
