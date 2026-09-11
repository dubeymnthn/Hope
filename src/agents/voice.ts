import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ScriptScene } from "../schemas/script.js";
import { AudioTimestamps, SentenceTimestamp } from "../schemas/timestamps.js";
import { ChatterboxTTS } from "../tts/chatterbox.js";
import { FFmpegService } from "../media/ffmpeg.js";
import { SubtitleGenerator } from "../media/subtitles.js";

interface SceneAudioCacheEntry {
  /** Scene-level checkpoint record (spec section 31). */
  sceneId: string;
  status: "complete";
  narrationHash: string;
  audioPath: string;
  duration: number;
  generationTimeMs: number;
  completedAt: string;
  /** Absent on pre-existing entries; those were all generated at Chatterbox's own 0.5 default. */
  cfgWeight?: number;
}

function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "unknown";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

export class VoiceAgent {
  private chatterbox: ChatterboxTTS;

  constructor(options?: { pythonPath?: string }) {
    this.chatterbox = new ChatterboxTTS(options);
  }

  async generate(
    scenes: ScriptScene[],
    outputDir: string,
    planning?: { wordsPerMinute: number; source: "calibration" | "legacy-estimate" }
  ): Promise<AudioTimestamps> {
    const cfgWeight = this.chatterbox.getCfgWeight();
    console.log(`[VOICE] Synthesizing speech narration with Chatterbox for ${scenes.length} scenes (resumable mode)...`);
    if (cfgWeight !== 0.5) {
      console.log(
        `[VOICE] cfg_weight=${cfgWeight} (via TTS_CFG_WEIGHT, default is 0.5) — ` +
          `classifier-free guidance ${cfgWeight === 0 ? "disabled" : "reduced"}; expect faster synthesis with a different expressive character.`
      );
    }
    // Measurement counters for this run (spec V2.2 §3, §21). Reused scenes are excluded
    // from throughput so the real-time factor reflects work actually done.
    let scenesReused = 0;
    let scenesSynthesized = 0;
    let synthesisMs = 0;
    let audioSecondsGenerated = 0;
    const audioDir = join(outputDir, "audio");
    mkdirSync(audioDir, { recursive: true });

    const cacheFilePath = join(audioDir, "tts-cache.json");
    let cache: Record<string, SceneAudioCacheEntry> = {};
    if (existsSync(cacheFilePath)) {
      try {
        cache = JSON.parse(readFileSync(cacheFilePath, "utf-8"));
      } catch {
        cache = {};
      }
    }

    const sceneAudioPaths: string[] = [];
    const sentenceTimestamps: SentenceTimestamp[] = [];
    const generationDurations: number[] = [];
    let currentTime = 0;

    // The resident worker session is opened lazily: a fully cached run never pays the
    // model load cost at all.
    let session: Awaited<ReturnType<ChatterboxTTS["openSession"]>> | null = null;
    const getSession = async () => {
      if (!session) {
        console.log(
          `[VOICE] Loading Chatterbox model into a resident session on ` +
            `${this.chatterbox.getDevice()} (one load for this run)...`
        );
        const t0 = Date.now();
        session = await this.chatterbox.openSession();
        console.log(`[VOICE] Model ready in ${((Date.now() - t0) / 1000).toFixed(1)}s.`);
      }
      return session;
    };

    try {
    for (let i = 0; i < scenes.length; i++) {
      const scene = scenes[i];
      const audioPath = join(audioDir, `${scene.id}.wav`);
      const narrationHash = createHash("sha256").update(scene.narration.trim()).digest("hex");

      let isCached = false;
      let sceneDuration = 0;

      if (existsSync(audioPath)) {
        try {
          const probe = await FFmpegService.probe(audioPath);
          if (probe.hasAudio && probe.duration > 0.3) {
            // If cache entry exists, verify hash AND generation params (cfg_weight); if no
            // cache entry yet, adopt existing valid audio. Entries predating cfg_weight
            // tracking are treated as the model's own 0.5 default, which is what they were
            // actually generated with.
            const entry = cache[scene.id];
            const entryCfgWeight = entry?.cfgWeight ?? 0.5;
            if (!entry || (entry.narrationHash === narrationHash && entryCfgWeight === cfgWeight)) {
              isCached = true;
              sceneDuration = probe.duration;
              if (!entry) {
                cache[scene.id] = {
                  sceneId: scene.id,
                  status: "complete",
                  narrationHash,
                  audioPath,
                  duration: sceneDuration,
                  generationTimeMs: 0,
                  completedAt: new Date().toISOString(),
                  cfgWeight
                };
                writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");
              }
            }
          }
        } catch {
          isCached = false;
        }
      }

      if (isCached) {
        scenesReused++;
        console.log(`[TTS ${i + 1}/${scenes.length}] Scene: ${scene.id} — Reusing cached valid audio (${sceneDuration.toFixed(2)}s).`);
      } else {
        const startTime = Date.now();
        console.log(`[TTS ${i + 1}/${scenes.length}] Synthesizing Scene: ${scene.id} ("${scene.narration.slice(0, 50)}...")...`);

        const live = await getSession();
        await live.synthesize(scene.narration, audioPath);

        const elapsedMs = Date.now() - startTime;
        generationDurations.push(elapsedMs);
        scenesSynthesized++;
        synthesisMs += elapsedMs;

        const probe = await FFmpegService.probe(audioPath);
        sceneDuration = probe.duration > 0 ? probe.duration : 4.0;
        audioSecondsGenerated += sceneDuration;

        // Validate the WAV before checkpointing it, so a truncated file is never
        // treated as a completed scene on resume.
        if (!probe.hasAudio || sceneDuration < 0.2) {
          throw new Error(
            `[VOICE] Synthesis for ${scene.id} produced no usable audio ` +
              `(duration ${sceneDuration}s). Not checkpointing; re-run to retry this scene.`
          );
        }

        cache[scene.id] = {
          sceneId: scene.id,
          status: "complete",
          narrationHash,
          audioPath,
          duration: sceneDuration,
          generationTimeMs: elapsedMs,
          completedAt: new Date().toISOString(),
          cfgWeight
        };
        writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");

        // Running progress and ETA, measured from this run's own throughput.
        const remainingScenes = scenes.length - (i + 1);
        const avgTimePerScene =
          generationDurations.reduce((a, b) => a + b, 0) / generationDurations.length;
        const etaSeconds = Math.round((remainingScenes * avgTimePerScene) / 1000);
        const progressPct = Math.round(((i + 1) / scenes.length) * 100);
        const realtimeFactor = elapsedMs / 1000 / Math.max(0.01, sceneDuration);

        console.log(
          `[TTS ${i + 1}/${scenes.length}] Scene: ${scene.id}\n` +
            `  Audio duration:      ${sceneDuration.toFixed(2)}s\n` +
            `  Generation time:     ${(elapsedMs / 1000).toFixed(1)}s (${realtimeFactor.toFixed(1)}x real-time)\n` +
            `  Overall progress:    ${progressPct}% (${i + 1}/${scenes.length} scenes)\n` +
            `  Estimated remaining: ${formatDuration(etaSeconds)}`
        );
      }

      // Word-level timestamps across the scene duration
      const words = scene.narration.trim().split(/\s+/);
      const wordDur = sceneDuration / Math.max(1, words.length);
      const wordTimestamps = words.map((w, wIdx) => ({
        word: w,
        start: Math.round((currentTime + wIdx * wordDur) * 100) / 100,
        end: Math.round((currentTime + (wIdx + 1) * wordDur) * 100) / 100
      }));

      sentenceTimestamps.push({
        sceneId: scene.id,
        text: scene.narration,
        start: Math.round(currentTime * 100) / 100,
        end: Math.round((currentTime + sceneDuration) * 100) / 100,
        duration: Math.round(sceneDuration * 100) / 100,
        words: wordTimestamps
      });

      currentTime += sceneDuration;
      sceneAudioPaths.push(audioPath);
    }
    } finally {
      // Always release the worker, including when a scene throws mid-run. Scenes
      // completed before the failure stay checkpointed and are reused on re-run.
      if (session) await (session as any).close();
    }

    // Concatenate all scene wavs into master audio/narration.wav
    const finalAudioPath = join(audioDir, "narration.wav");
    await this.concatenateWavs(sceneAudioPaths, finalAudioPath);

    const totalProbe = await FFmpegService.probe(finalAudioPath);
    const totalDuration = totalProbe.duration > 0 ? totalProbe.duration : currentTime;

    // What this run actually measured (spec V2.2 §3, §21). The planning rate is recorded
    // alongside the measured rate so drift between them is visible and recalibratable.
    const totalWords = scenes.reduce(
      (acc, s) => acc + s.narration.trim().split(/\s+/).filter(Boolean).length,
      0
    );
    const roundedTotal = Math.round(totalDuration * 100) / 100;
    const measuredWpm = roundedTotal > 0 ? Math.round((totalWords / (roundedTotal / 60)) * 10) / 10 : 0;
    const synthesisSeconds = Math.round(synthesisMs / 100) / 10;
    const plan = planning ?? { wordsPerMinute: 150, source: "legacy-estimate" as const };

    const audioResult: AudioTimestamps = {
      audioPath: finalAudioPath,
      sampleRate: 24000,
      totalDuration: roundedTotal,
      sentences: sentenceTimestamps,
      measurement: {
        totalWords,
        measuredWordsPerMinute: measuredWpm,
        planningWordsPerMinute: plan.wordsPerMinute,
        planningRateSource: plan.source,
        device: this.chatterbox.getDevice(),
        cfgWeight,
        scenesSynthesized,
        scenesReused,
        synthesisSeconds,
        realtimeFactor:
          audioSecondsGenerated > 0 ? Math.round((synthesisSeconds / audioSecondsGenerated) * 100) / 100 : undefined,
        measuredAt: new Date().toISOString()
      }
    };

    console.log(
      `[VOICE] Measured ${totalWords} words over ${roundedTotal}s = ${measuredWpm} wpm ` +
        `(planned at ${plan.wordsPerMinute} wpm, ${plan.source}); ` +
        `${scenesReused} reused, ${scenesSynthesized} synthesised on ${this.chatterbox.getDevice()}`
    );

    // Save audio/timestamps.json
    const timestampsPath = join(audioDir, "timestamps.json");
    writeFileSync(timestampsPath, JSON.stringify(audioResult, null, 2), "utf-8");

    // Generate audio/captions.srt
    const srtContent = SubtitleGenerator.toSRT(sentenceTimestamps);
    const srtPath = join(audioDir, "captions.srt");
    writeFileSync(srtPath, srtContent, "utf-8");

    console.log(`[VOICE] Resumable narration pipeline complete: ${finalAudioPath} (${audioResult.totalDuration}s, ${scenes.length} scenes)`);
    return audioResult;
  }

  private async concatenateWavs(inputs: string[], output: string): Promise<void> {
    const listFile = output + ".concat.txt";
    const content = inputs.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(listFile, content, "utf-8");

    try {
      const { execFile } = await import("node:child_process");
      const { promisify } = await import("node:util");
      const execFileAsync = promisify(execFile);
      const { FFMPEG_PATH } = await import("../media/ffmpeg.js");

      const args = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:a", "pcm_s16le",
        "-ar", "24000",
        output
      ];
      await execFileAsync(FFMPEG_PATH, args);
    } finally {
      if (existsSync(listFile)) {
        try {
          const { unlinkSync } = await import("node:fs");
          unlinkSync(listFile);
        } catch {}
      }
    }
  }
}
