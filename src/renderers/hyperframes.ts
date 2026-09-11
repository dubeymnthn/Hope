import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { VideoRenderer, RenderOptions, RenderResult } from "./renderer.js";
import { FFmpegService, FFMPEG_PATH, FFPROBE_PATH } from "../media/ffmpeg.js";

const execFileAsync = promisify(execFile);

export class HyperFramesRenderer implements VideoRenderer {
  private hfEntry: string;

  constructor(options?: { repoRoot?: string }) {
    this.hfEntry = HyperFramesRenderer.resolveEntry(options?.repoRoot ?? process.cwd());
  }

  /**
   * Resolves the HyperFrames CLI entry script.
   *
   * The `.bin` shims are not directly spawnable across platforms: on Windows the
   * extensionless shim is a shell script that cannot be executed, and Node refuses to
   * spawn `.cmd` files without a shell. Invoking the package's own ESM entry with the
   * current Node binary avoids both problems.
   */
  private static resolveEntry(repoRoot: string): string {
    const entry = join(repoRoot, "node_modules/hyperframes/bin/hyperframes.mjs");
    if (existsSync(entry)) return entry;
    // Fall back to the platform shim if the package layout ever changes.
    return join(
      repoRoot,
      process.platform === "win32" ? "node_modules/.bin/hyperframes.cmd" : "node_modules/.bin/hyperframes"
    );
  }

  /**
   * Builds the child environment for the HyperFrames CLI.
   *
   * HyperFrames locates ffmpeg and ffprobe on PATH, but this project ships them as npm
   * packages rather than system installs. Their directories are prepended to PATH so the
   * renderer uses the same pinned binaries as the rest of the pipeline, with no global
   * install required.
   */
  private buildEnv(): NodeJS.ProcessEnv {
    const binDirs = [dirname(FFMPEG_PATH), dirname(FFPROBE_PATH)].filter(
      (d) => d && d !== "." && existsSync(d)
    );
    const pathKey = Object.keys(process.env).find((k) => k.toUpperCase() === "PATH") || "PATH";
    const existing = process.env[pathKey] || "";
    const separator = process.platform === "win32" ? ";" : ":";
    return {
      ...process.env,
      [pathKey]: [...new Set(binDirs)].join(separator) + separator + existing
    };
  }

  /** Runs the CLI through the current Node executable. */
  private run(args: string[], options?: { maxBuffer?: number }) {
    const isShim = !this.hfEntry.endsWith(".mjs");
    const command = isShim ? this.hfEntry : process.execPath;
    const fullArgs = isShim ? args : [this.hfEntry, ...args];
    return execFileAsync(command, fullArgs, {
      maxBuffer: options?.maxBuffer ?? 64 * 1024 * 1024,
      windowsHide: true,
      env: this.buildEnv()
    });
  }

  async check(projectDir: string, options?: { snapshots?: boolean }): Promise<any> {
    const args = ["check", projectDir, "--json"];
    if (options?.snapshots) {
      args.push("--snapshots");
    }

    try {
      const { stdout } = await this.run(args);
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
    if (options.composition) {
      args.push("-c", options.composition);
    }

    await this.run(args);

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
