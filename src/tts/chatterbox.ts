import { TTSProvider, TTSRequest, TTSResult } from "./provider.js";
import { ChatterboxWorkerClient, ChatterboxSession } from "./worker-client.js";

export class ChatterboxTTS implements TTSProvider {
  private client: ChatterboxWorkerClient;

  constructor(options?: { pythonPath?: string; device?: string }) {
    this.client = new ChatterboxWorkerClient(options);
  }

  /** The local compute device synthesis runs on. */
  getDevice(): string {
    return this.client.getDevice();
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    return this.client.synthesize(request);
  }

  /**
   * Opens a resident synthesis session so a long-form run loads the model once.
   */
  async openSession(): Promise<ChatterboxSession> {
    return this.client.openSession();
  }

  async synthesizeScenes(scenes: Array<{ id: string; narration: string; output: string }>): Promise<Array<TTSResult & { id: string }>> {
    const items = scenes.map((s) => ({
      id: s.id,
      text: s.narration,
      output: s.output
    }));
    return this.client.synthesizeBatch(items);
  }
}
