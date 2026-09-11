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

export const AudioTimestampsSchema = z.object({
  audioPath: z.string(),
  sampleRate: z.number().default(24000),
  totalDuration: z.number(),
  sentences: z.array(SentenceTimestampSchema)
});

export type WordTimestamp = z.infer<typeof WordTimestampSchema>;
export type SentenceTimestamp = z.infer<typeof SentenceTimestampSchema>;
export type AudioTimestamps = z.infer<typeof AudioTimestampsSchema>;
