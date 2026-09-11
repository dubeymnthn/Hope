import { AudioTimestamps } from "../schemas/timestamps.js";
import { VideoConfig, resolvePlanningRate } from "../schemas/channel.js";

/**
 * Post-synthesis duration gate (spec V2.2 §3).
 *
 * Duration is judged from MEASURED narration, never from a word-count estimate. When
 * the result is materially outside the target band the pipeline must stop and ask the
 * agent to revise the script; it must never pad, repeat, slow the voice, or stretch
 * pauses to reach a number. This module is pure so the policy is unit-testable.
 */

export type DurationVerdict = "within_band" | "acceptable" | "too_short" | "too_long";

export interface DurationAssessment {
  verdict: DurationVerdict;
  actualSeconds: number;
  actualMinutes: number;
  targetMinutes: number;
  bandMinutes: [number, number];
  acceptableMinutes: [number, number];
  measuredWordsPerMinute: number | null;
  planningWordsPerMinute: number;
  planningRateSource: "calibration" | "legacy-estimate";
  /** Positive means the measured rate is faster than planned (script came out short). */
  rateDriftPercent: number | null;
  /** Word delta needed to land on target at the measured rate; the agent's correction hint. */
  suggestedWordDelta: number | null;
  message: string;
  /** Whether production may continue. `too_short` / `too_long` block. */
  blocking: boolean;
}

export function assessDuration(params: {
  audio: AudioTimestamps;
  video?: VideoConfig;
  /** Runtime the argument stage judged the evidence supports; overrides the channel target. */
  targetMinutesOverride?: number;
  totalWords?: number;
}): DurationAssessment {
  const video = params.video;
  const target = params.targetMinutesOverride ?? video?.targetDurationMinutes ?? 10;
  const tol = video?.targetToleranceMinutes ?? 1;
  const minAcceptable = video?.minimumDurationMinutes ?? 7;
  const maxAcceptable = video?.maximumDurationMinutes ?? 13;

  const actualSeconds = params.audio.totalDuration;
  const actualMinutes = Math.round((actualSeconds / 60) * 100) / 100;
  const band: [number, number] = [Math.max(0, target - tol), target + tol];
  const acceptable: [number, number] = [minAcceptable, maxAcceptable];

  const rate = resolvePlanningRate(video);
  const words = params.totalWords ?? params.audio.measurement?.totalWords ?? null;
  const measuredWpm =
    params.audio.measurement?.measuredWordsPerMinute ??
    (words !== null && actualSeconds > 0 ? Math.round((words / (actualSeconds / 60)) * 10) / 10 : null);
  const drift =
    measuredWpm !== null ? Math.round(((measuredWpm - rate.wordsPerMinute) / rate.wordsPerMinute) * 1000) / 10 : null;
  const suggestedDelta =
    measuredWpm !== null && words !== null ? Math.round(target * measuredWpm - words) : null;

  let verdict: DurationVerdict;
  if (actualMinutes >= band[0] && actualMinutes <= band[1]) verdict = "within_band";
  else if (actualMinutes < acceptable[0]) verdict = "too_short";
  else if (actualMinutes > acceptable[1]) verdict = "too_long";
  else verdict = "acceptable";

  const blocking = verdict === "too_short" || verdict === "too_long";

  const fmt = (n: number) => n.toFixed(1);
  let message: string;
  switch (verdict) {
    case "within_band":
      message = `Measured ${fmt(actualMinutes)} min is inside the ${fmt(band[0])}-${fmt(band[1])} min target band.`;
      break;
    case "acceptable":
      message =
        `Measured ${fmt(actualMinutes)} min is outside the ${fmt(band[0])}-${fmt(band[1])} min target band but within the ` +
        `${fmt(acceptable[0])}-${fmt(acceptable[1])} min acceptable range. Continuing without padding or trimming.` +
        (suggestedDelta !== null && Math.abs(suggestedDelta) > 50
          ? ` To land on ${target} min at the measured ${measuredWpm} wpm the script would need about ${suggestedDelta > 0 ? "+" : ""}${suggestedDelta} words.`
          : "");
      break;
    case "too_short":
      message =
        `Measured ${fmt(actualMinutes)} min is below the ${fmt(acceptable[0])} min minimum. The pipeline will not pad narration; ` +
        `the Script Agent must add substantive material` +
        (suggestedDelta !== null ? ` (about ${suggestedDelta} more words at the measured ${measuredWpm} wpm)` : "") +
        ` grounded in research, or the Argument Agent must lower the target.`;
      break;
    case "too_long":
      message =
        `Measured ${fmt(actualMinutes)} min exceeds the ${fmt(acceptable[1])} min maximum. The pipeline will not truncate or speed up ` +
        `narration; the Script Agent must tighten the script` +
        (suggestedDelta !== null ? ` (about ${Math.abs(suggestedDelta)} fewer words at the measured ${measuredWpm} wpm)` : "") +
        `.`;
      break;
  }

  return {
    verdict,
    actualSeconds,
    actualMinutes,
    targetMinutes: target,
    bandMinutes: band,
    acceptableMinutes: acceptable,
    measuredWordsPerMinute: measuredWpm,
    planningWordsPerMinute: rate.wordsPerMinute,
    planningRateSource: rate.source,
    rateDriftPercent: drift,
    suggestedWordDelta: suggestedDelta,
    message,
    blocking
  };
}

/**
 * Builds a calibration record from a completed production, for writing back into
 * config so the next plan uses a measured rate (spec §3: recalibration from runs).
 */
export function calibrationFromMeasurement(params: {
  audio: AudioTimestamps;
  workspaceLabel: string;
  chatterboxVersion?: string;
  voice?: string;
}): {
  ttsWordsPerMinute: number;
  measuredAt: string;
  measuredFrom: string;
  sampleWords: number;
  sampleSeconds: number;
  device: string;
  chatterboxVersion?: string;
  voice?: string;
} | null {
  const m = params.audio.measurement;
  if (!m || m.totalWords <= 0 || params.audio.totalDuration <= 0) return null;
  return {
    ttsWordsPerMinute: Math.round(m.measuredWordsPerMinute),
    measuredAt: m.measuredAt,
    measuredFrom: params.workspaceLabel,
    sampleWords: m.totalWords,
    sampleSeconds: Math.round(params.audio.totalDuration * 10) / 10,
    device: m.device,
    chatterboxVersion: params.chatterboxVersion,
    voice: params.voice
  };
}
