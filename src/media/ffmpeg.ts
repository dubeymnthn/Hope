import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import ffmpegStatic from "ffmpeg-static";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const execFileAsync = promisify(execFile);

export const FFMPEG_PATH: string = (ffmpegStatic as unknown as string) || "ffmpeg";
export const FFPROBE_PATH: string = (ffprobeInstaller.path as unknown as string) || "ffprobe";

export interface ProbeResult {
  width: number;
  height: number;
  fps: number;
  duration: number;
  hasAudio: boolean;
  audioCodec?: string;
  videoCodec?: string;
  channels?: number;
  sampleRate?: number;
  bitrate?: number;
}

export interface AudioAnalysisResult {
  meanVolumeDb: number;
  maxVolumeDb: number;
  isSilent: boolean;
}

export class FFmpegService {
  static async probe(mediaPath: string): Promise<ProbeResult> {
    if (!existsSync(mediaPath)) {
      throw new Error(`Probe failed: File not found at ${mediaPath}`);
    }

    const args = [
      "-v", "error",
      "-show_streams",
      "-show_format",
      "-of", "json",
      mediaPath
    ];

    const { stdout } = await execFileAsync(FFPROBE_PATH, args);
    const data = JSON.parse(stdout);

    const videoStream = (data.streams || []).find((s: any) => s.codec_type === "video");
    const audioStream = (data.streams || []).find((s: any) => s.codec_type === "audio");

    let fps = 30;
    if (videoStream?.r_frame_rate) {
      const [num, den] = videoStream.r_frame_rate.split("/").map(Number);
      if (den && den > 0) fps = Math.round((num / den) * 100) / 100;
    }

    const duration = parseFloat(data.format?.duration || videoStream?.duration || audioStream?.duration || "0");
    const bitrate = parseInt(data.format?.bit_rate || audioStream?.bit_rate || videoStream?.bit_rate || "0", 10);

    return {
      width: videoStream ? parseInt(videoStream.width, 10) : 0,
      height: videoStream ? parseInt(videoStream.height, 10) : 0,
      fps,
      duration,
      hasAudio: !!audioStream,
      audioCodec: audioStream?.codec_name,
      videoCodec: videoStream?.codec_name,
      channels: audioStream ? parseInt(audioStream.channels, 10) : undefined,
      sampleRate: audioStream ? parseInt(audioStream.sample_rate, 10) : undefined,
      bitrate: bitrate > 0 ? bitrate : undefined
    };
  }

  static async analyzeAudio(mediaPath: string): Promise<AudioAnalysisResult> {
    if (!existsSync(mediaPath)) {
      throw new Error(`Audio analysis failed: File not found at ${mediaPath}`);
    }

    try {
      const args = ["-i", mediaPath, "-af", "volumedetect", "-f", "null", "/dev/null"];
      // ffmpeg writes filter output to stderr
      let outputText = "";
      try {
        const res = await execFileAsync(FFMPEG_PATH, args);
        outputText = (res.stderr || "") + (res.stdout || "");
      } catch (err: any) {
        outputText = (err.stderr || "") + (err.stdout || "") + (err.message || "");
      }

      const meanMatch = outputText.match(/mean_volume:\s*([-0-9.]+)\s*dB/);
      const maxMatch = outputText.match(/max_volume:\s*([-0-9.]+)\s*dB/);

      const meanVolumeDb = meanMatch ? parseFloat(meanMatch[1]) : -99.0;
      const maxVolumeDb = maxMatch ? parseFloat(maxMatch[1]) : -99.0;

      // Silence detection threshold: if mean volume is below -50dB or max volume below -40dB, audio is inaudible
      const isSilent = meanVolumeDb < -50 || maxVolumeDb < -40;

      return {
        meanVolumeDb,
        maxVolumeDb,
        isSilent
      };
    } catch {
      return {
        meanVolumeDb: -99.0,
        maxVolumeDb: -99.0,
        isSilent: true
      };
    }
  }

  static async extractSnapshot(videoPath: string, timestampSec: number, outputPath: string): Promise<string> {
    const args = [
      "-y",
      "-ss", String(timestampSec),
      "-i", videoPath,
      "-frames:v", "1",
      "-update", "1",
      "-q:v", "2",
      outputPath
    ];
    await execFileAsync(FFMPEG_PATH, args);
    return outputPath;
  }

  static async concatVideos(videoPaths: string[], outputPath: string): Promise<void> {
    if (videoPaths.length === 0) {
      throw new Error("Cannot concatenate 0 video files");
    }

    // Write concat file list
    const listFile = join(outputPath + ".concat.txt");
    const listContent = videoPaths.map((p) => `file '${p.replace(/'/g, "'\\''")}'`).join("\n");
    writeFileSync(listFile, listContent, "utf-8");

    try {
      const args = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c", "copy",
        outputPath
      ];
      await execFileAsync(FFMPEG_PATH, args);
    } catch {
      // If copy fails due to codec difference, re-encode standard H.264
      const args = [
        "-y",
        "-f", "concat",
        "-safe", "0",
        "-i", listFile,
        "-c:v", "libx264",
        "-pix_fmt", "yuv420p",
        "-r", "30",
        outputPath
      ];
      await execFileAsync(FFMPEG_PATH, args);
    } finally {
      if (existsSync(listFile)) {
        unlinkSync(listFile);
      }
    }
  }

  static async muxAudioAndVideo(
    videoPath: string,
    audioPath: string,
    outputPath: string,
    options?: { srtPath?: string }
  ): Promise<void> {
    const args = [
      "-y",
      "-i", videoPath,
      "-i", audioPath,
      "-c:v", "copy",
      "-c:a", "aac",
      "-b:a", "192k",
      "-ar", "48000",
      "-ac", "2",
      "-shortest",
      outputPath
    ];

    await execFileAsync(FFMPEG_PATH, args);
  }
}
