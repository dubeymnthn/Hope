import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ScriptScene } from "../schemas/script.js";
import { AudioTimestamps, SentenceTimestamp } from "../schemas/timestamps.js";
import { ChatterboxTTS } from "../tts/chatterbox.js";
import { FFmpegService } from "../media/ffmpeg.js";
import { SubtitleGenerator } from "../media/subtitles.js";

interface SceneAudioCacheEntry {
  sceneId: string;
  narrationHash: string;
  audioPath: string;
  duration: number;
  generationTimeMs: number;
  completedAt: string;
}

export class VoiceAgent {
  private chatterbox: ChatterboxTTS;

  constructor(options?: { pythonPath?: string }) {
    this.chatterbox = new ChatterboxTTS(options);
  }

  async generate(scenes: ScriptScene[], outputDir: string): Promise<AudioTimestamps> {
    console.log(`[VOICE] Synthesizing speech narration with Chatterbox for ${scenes.length} scenes (resumable mode)...`);
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
            // If cache entry exists, verify hash; if no cache entry yet, adopt existing valid audio
            if (!cache[scene.id] || cache[scene.id].narrationHash === narrationHash) {
              isCached = true;
              sceneDuration = probe.duration;
              if (!cache[scene.id]) {
                cache[scene.id] = {
                  sceneId: scene.id,
                  narrationHash,
                  audioPath,
                  duration: sceneDuration,
                  generationTimeMs: 0,
                  completedAt: new Date().toISOString()
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
        console.log(`[TTS ${i + 1}/${scenes.length}] Scene: ${scene.id} — Reusing cached valid audio (${sceneDuration.toFixed(2)}s).`);
      } else {
        const startTime = Date.now();
        console.log(`[TTS ${i + 1}/${scenes.length}] Synthesizing Scene: ${scene.id} ("${scene.narration.slice(0, 50)}...")...`);

        await this.chatterbox.synthesize({
          text: scene.narration,
          voiceId: "am_adam",
          language: "en",
          outputFilePath: audioPath
        });

        const elapsedMs = Date.now() - startTime;
        generationDurations.push(elapsedMs);

        const probe = await FFmpegService.probe(audioPath);
        sceneDuration = probe.duration > 0 ? probe.duration : 4.0;

        // Record in cache
        cache[scene.id] = {
          sceneId: scene.id,
          narrationHash,
          audioPath,
          duration: sceneDuration,
          generationTimeMs: elapsedMs,
          completedAt: new Date().toISOString()
        };
        writeFileSync(cacheFilePath, JSON.stringify(cache, null, 2), "utf-8");

        // Calculate running ETA
        const remainingScenes = scenes.length - (i + 1);
        const avgTimePerScene = generationDurations.reduce((a, b) => a + b, 0) / generationDurations.length;
        const etaSeconds = Math.round((remainingScenes * avgTimePerScene) / 1000);
        const progressPct = Math.round(((i + 1) / scenes.length) * 100);

        console.log(`[TTS ${i + 1}/${scenes.length}] Scene: ${scene.id} | Audio duration: ${sceneDuration.toFixed(2)}s | Gen time: ${(elapsedMs / 1000).toFixed(1)}s | Progress: ${progressPct}% | ETA: ~${etaSeconds}s`);
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

    // Concatenate all scene wavs into master audio/narration.wav
    const finalAudioPath = join(audioDir, "narration.wav");
    await this.concatenateWavs(sceneAudioPaths, finalAudioPath);

    const totalProbe = await FFmpegService.probe(finalAudioPath);
    const totalDuration = totalProbe.duration > 0 ? totalProbe.duration : currentTime;

    const audioResult: AudioTimestamps = {
      audioPath: finalAudioPath,
      sampleRate: 24000,
      totalDuration: Math.round(totalDuration * 100) / 100,
      sentences: sentenceTimestamps
    };

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
