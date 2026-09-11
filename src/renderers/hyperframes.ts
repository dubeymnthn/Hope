import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VideoRenderer, RenderOptions, RenderResult } from "./renderer.js";
import { FFmpegService } from "../media/ffmpeg.js";

const execFileAsync = promisify(execFile);

export class HyperFramesRenderer implements VideoRenderer {
  private hfBin: string;

  constructor() {
    this.hfBin = join(process.cwd(), "node_modules/.bin/hyperframes");
  }

  async check(projectDir: string, options?: { snapshots?: boolean }): Promise<any> {
    const args = ["check", projectDir, "--json"];
    if (options?.snapshots) {
      args.push("--snapshots");
    }

    try {
      const { stdout } = await execFileAsync(this.hfBin, args, {
        env: { ...process.env, PATH: `./node_modules/.bin:${process.env.PATH}` }
      });
      // Parse JSON from output
      const jsonStart = stdout.indexOf("{");
      if (jsonStart >= 0) {
        return JSON.parse(stdout.slice(jsonStart));
      }
      return { ok: true };
    } catch (err: any) {
      if (err.stdout) {
        const jsonStart = err.stdout.indexOf("{");
        if (jsonStart >= 0) {
          try {
            return JSON.parse(err.stdout.slice(jsonStart));
          } catch {
            // ignore
          }
        }
      }
      throw new Error(`HyperFrames check failed: ${err.message}`);
    }
  }

  async render(projectDir: string, options: RenderOptions): Promise<RenderResult> {
    console.log(`[RENDER] Rendering HyperFrames project at ${projectDir} to ${options.output}...`);

    mkdirSync(dirname(options.output), { recursive: true });

    const startTime = Date.now();
    const args = ["render", projectDir, "-o", options.output];

    if (options.fps) {
      args.push("--fps", String(options.fps));
    }
    if (options.quality) {
      args.push("--quality", options.quality);
    }
    if (options.workers) {
      args.push("--workers", String(options.workers));
    }

    await execFileAsync(this.hfBin, args, {
      env: { ...process.env, PATH: `./node_modules/.bin:${process.env.PATH}` }
    });

    const renderTimeMs = Date.now() - startTime;

    if (!existsSync(options.output)) {
      throw new Error(`Render completed but output file was not found at ${options.output}`);
    }

    const probe = await FFmpegService.probe(options.output);

    console.log(
      `[RENDER] Render complete in ${(renderTimeMs / 1000).toFixed(1)}s: ${probe.width}x${probe.height} @ ${probe.fps}fps, ${probe.duration.toFixed(1)}s`
    );

    return {
      outputPath: options.output,
      duration: probe.duration,
      width: probe.width,
      height: probe.height,
      fps: probe.fps,
      renderTimeMs
    };
  }
}
