import { SentenceTimestamp, AudioTimestamps } from "../schemas/timestamps.js";

export interface AlignmentResult {
  audioPath: string;
  totalDuration: number;
  sentences: SentenceTimestamp[];
}

export interface AlignmentProvider {
  align(
    audioPath: string,
    scenes: Array<{ id: string; narration: string }>
  ): Promise<AlignmentResult>;
}
