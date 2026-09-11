import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { TTSRequest, TTSResult } from "./provider.js";
import { resolveTtsDevice, resolvePythonForDevice, resolveTtsCfgWeight, venvPython, TtsDevice } from "../system/runtime.js";

export class ChatterboxWorkerClient {
  private pythonPath: string;
  private workerScript: string;
  private device: string;
  private cfgWeight: number;

  constructor(options?: { pythonPath?: string; workerScript?: string; device?: string; cfgWeight?: number }) {
    this.device = options?.device || ChatterboxWorkerClient.resolveDevice();
    this.cfgWeight = options?.cfgWeight ?? resolveTtsCfgWeight().cfgWeight;
    this.pythonPath =
      options?.pythonPath || ChatterboxWorkerClient.resolveVenvPython(process.cwd(), this.device);
    this.workerScript = options?.workerScript || resolve(process.cwd(), "src/tts/chatterbox_worker.py");

    if (!existsSync(this.pythonPath)) {
      throw new Error(
        `Python virtual environment for TTS device "${this.device}" not found at ${this.pythonPath}. ` +
          (this.device === "cpu"
            ? "Run: npm run setup:tts   (Python 3.10-3.12 required; system Python 3.14 is not supported by Chatterbox's dependencies)"
            : "Run: npm run setup:tts:xpu   or set TTS_DEVICE=cpu to use the reference path")
      );
    }
  }

  /**
   * Device selection is delegated to the central runtime resolver so there is exactly
   * one place that knows how TTS_DEVICE, the accelerator venv and the platform interact
   * (spec V2.2 §5). Kept as a static for callers that already use it.
   */
  public static resolveDevice(baseDir: string = process.cwd()): string {
    return resolveTtsDevice(baseDir).device;
  }

  /**
   * Interpreter resolution is likewise delegated. When nothing is installed the
   * platform-conventional path is returned so the error message names a real location.
   */
  public static resolveVenvPython(baseDir: string = process.cwd(), device = "cpu"): string {
    return (
      resolvePythonForDevice(device as TtsDevice, baseDir) ??
      venvPython(device === "cpu" ? ".venv" : ".venv-xpu", baseDir)
    );
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const outputPath = request.outputFilePath || resolve(process.cwd(), `test-artifacts/tts-${Date.now()}.wav`);
    const args = [
      this.workerScript,
      "--text", request.text,
      "--output", outputPath,
      "--device", this.device,
      "--cfg-weight", String(this.cfgWeight)
    ];

    const stdout = await this.runProcess(args);
    const parsed = JSON.parse(stdout.trim());
    return {
      audioPath: parsed.audioPath,
      sampleRate: parsed.sampleRate || 24000,
      duration: parsed.duration
    };
  }

  /**
   * Opens a persistent synthesis session. The Python worker loads the model once and
   * then synthesises scene by scene, so long-form runs pay the load cost a single time
   * while the caller still validates and checkpoints each scene individually.
   */
  async openSession(options?: { device?: string; cfgWeight?: number; readyTimeoutMs?: number }): Promise<ChatterboxSession> {
    return ChatterboxSession.start(this.pythonPath, this.workerScript, {
      device: options?.device ?? this.device,
      cfgWeight: options?.cfgWeight ?? this.cfgWeight,
      readyTimeoutMs: options?.readyTimeoutMs
    });
  }

  /** The device synthesis will run on, for logging. */
  public getDevice(): string {
    return this.device;
  }

  /** The classifier-free-guidance weight synthesis will run with, for logging/cache-keying. */
  public getCfgWeight(): number {
    return this.cfgWeight;
  }

  async synthesizeBatch(items: Array<{ id: string; text: string; output: string }>): Promise<Array<TTSResult & { id: string }>> {
    const tempJson = resolve(process.cwd(), `test-artifacts/batch-${Date.now()}.json`);
    writeFileSync(tempJson, JSON.stringify(items, null, 2), "utf-8");

    try {
      const args = [
        this.workerScript,
        "--batch-json", tempJson,
        "--device", this.device,
        "--cfg-weight", String(this.cfgWeight)
      ];

      const stdout = await this.runProcess(args, 1800000); // 30 mins timeout
      return JSON.parse(stdout.trim());
    } finally {
      if (existsSync(tempJson)) {
        unlinkSync(tempJson);
      }
    }
  }

  private runProcess(args: string[], timeoutMs = 600000): Promise<string> {
    return new Promise((res, rej) => {
      const child = spawn(this.pythonPath, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: {
          ...process.env,
          TQDM_DISABLE: "1",
          PYTHONUNBUFFERED: "1"
        }
      });

      let stdout = "";
      let stderr = "";

      const timer = setTimeout(() => {
        child.kill("SIGTERM");
        rej(new Error(`Chatterbox worker process timed out after ${timeoutMs / 1000}s`));
      }, timeoutMs);

      child.stdout.on("data", (data) => {
        stdout += data.toString();
      });

      child.stderr.on("data", (data) => {
        const text = data.toString();
        stderr += text;
        const lines = text.trim().split("\n");
        for (const line of lines) {
          if (line.startsWith("[ChatterboxWorker]")) {
            console.log(line);
          }
        }
      });

      child.on("close", (code) => {
        clearTimeout(timer);
        if (code === 0) {
          res(stdout);
        } else {
          rej(new Error(`Chatterbox worker failed with exit code ${code}.\nStderr: ${stderr}`));
        }
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        rej(err);
      });
    });
  }
}

/**
 * A live Chatterbox worker process held open across scenes.
 *
 * Requests are serialised: one line of JSON in, one line of JSON out. The model stays
 * resident, which removes the per-scene model load from long-form narration runs.
 */
export class ChatterboxSession {
  private child: ChildProcessWithoutNullStreams;
  private buffer = "";
  private pending: { resolve: (v: any) => void; reject: (e: Error) => void } | null = null;
  private closed = false;
  private exitError: Error | null = null;

  private constructor(child: ChildProcessWithoutNullStreams) {
    this.child = child;

    this.child.stdout.on("data", (chunk) => {
      this.buffer += chunk.toString();
      let idx: number;
      while ((idx = this.buffer.indexOf("\n")) >= 0) {
        const line = this.buffer.slice(0, idx).trim();
        this.buffer = this.buffer.slice(idx + 1);
        if (!line) continue;
        const waiter = this.pending;
        this.pending = null;
        if (!waiter) continue;
        try {
          waiter.resolve(JSON.parse(line));
        } catch (err: any) {
          waiter.reject(new Error(`Unparseable worker response: ${line.slice(0, 200)}`));
        }
      }
    });

    this.child.stderr.on("data", (data) => {
      for (const line of data.toString().trim().split("\n")) {
        if (line.startsWith("[ChatterboxWorker]")) console.log(line);
      }
    });

    this.child.on("close", (code) => {
      this.closed = true;
      this.exitError = new Error(`Chatterbox session exited with code ${code}`);
      if (this.pending) {
        const waiter = this.pending;
        this.pending = null;
        waiter.reject(this.exitError);
      }
    });
  }

  static async start(
    pythonPath: string,
    workerScript: string,
    options?: { device?: string; cfgWeight?: number; readyTimeoutMs?: number }
  ): Promise<ChatterboxSession> {
    const child = spawn(
      pythonPath,
      [
        workerScript,
        "--serve",
        "--device", options?.device || "cpu",
        "--cfg-weight", String(options?.cfgWeight ?? 0.5)
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env, TQDM_DISABLE: "1", PYTHONUNBUFFERED: "1" }
      }
    ) as ChildProcessWithoutNullStreams;

    const session = new ChatterboxSession(child);

    // Model load can be slow on a cold cache; wait for the explicit ready line.
    const ready = await session.awaitResponse(options?.readyTimeoutMs ?? 1800000);
    if (!ready?.ready) {
      throw new Error(`Chatterbox session failed to become ready: ${JSON.stringify(ready)}`);
    }
    return session;
  }

  private awaitResponse(timeoutMs: number): Promise<any> {
    if (this.closed) return Promise.reject(this.exitError ?? new Error("session closed"));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = null;
        reject(new Error(`Chatterbox session timed out after ${Math.round(timeoutMs / 1000)}s`));
      }, timeoutMs);

      this.pending = {
        resolve: (v) => {
          clearTimeout(timer);
          resolve(v);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        }
      };
    });
  }

  async synthesize(text: string, outputPath: string, timeoutMs = 1800000): Promise<TTSResult> {
    if (this.closed) throw this.exitError ?? new Error("Chatterbox session is closed");

    const waiter = this.awaitResponse(timeoutMs);
    this.child.stdin.write(JSON.stringify({ text, output: outputPath }) + "\n");
    const res = await waiter;

    if (!res?.ok) {
      throw new Error(`Chatterbox synthesis failed: ${res?.error || "unknown error"}`);
    }
    return {
      audioPath: res.audioPath,
      sampleRate: res.sampleRate || 24000,
      duration: res.duration
    };
  }

  async close(): Promise<void> {
    if (this.closed) return;
    try {
      this.child.stdin.write(JSON.stringify({ command: "shutdown" }) + "\n");
      this.child.stdin.end();
    } catch {
      // Process may already be gone.
    }
    await new Promise<void>((resolve) => {
      if (this.closed) return resolve();
      this.child.once("close", () => resolve());
      setTimeout(() => {
        try {
          this.child.kill();
        } catch {}
        resolve();
      }, 10000);
    });
    this.closed = true;
  }
}
