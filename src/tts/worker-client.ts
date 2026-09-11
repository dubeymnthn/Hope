import { spawn } from "node:child_process";
import { existsSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { TTSRequest, TTSResult } from "./provider.js";

export class ChatterboxWorkerClient {
  private pythonPath: string;
  private workerScript: string;

  constructor(options?: { pythonPath?: string; workerScript?: string }) {
    this.pythonPath = options?.pythonPath || resolve(process.cwd(), ".venv/bin/python");
    this.workerScript = options?.workerScript || resolve(process.cwd(), "src/tts/chatterbox_worker.py");

    if (!existsSync(this.pythonPath)) {
      throw new Error(`Python virtual environment not found at ${this.pythonPath}`);
    }
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    const outputPath = request.outputFilePath || resolve(process.cwd(), `test-artifacts/tts-${Date.now()}.wav`);
    const args = [
      this.workerScript,
      "--text", request.text,
      "--output", outputPath,
      "--device", "cpu"
    ];

    const stdout = await this.runProcess(args);
    const parsed = JSON.parse(stdout.trim());
    return {
      audioPath: parsed.audioPath,
      sampleRate: parsed.sampleRate || 24000,
      duration: parsed.duration
    };
  }

  async synthesizeBatch(items: Array<{ id: string; text: string; output: string }>): Promise<Array<TTSResult & { id: string }>> {
    const tempJson = resolve(process.cwd(), `test-artifacts/batch-${Date.now()}.json`);
    writeFileSync(tempJson, JSON.stringify(items, null, 2), "utf-8");

    try {
      const args = [
        this.workerScript,
        "--batch-json", tempJson,
        "--device", "cpu"
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
