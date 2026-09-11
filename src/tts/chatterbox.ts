import { TTSProvider, TTSRequest, TTSResult } from "./provider.js";
import { ChatterboxWorkerClient } from "./worker-client.js";

export class ChatterboxTTS implements TTSProvider {
  private client: ChatterboxWorkerClient;

  constructor(options?: { pythonPath?: string }) {
    this.client = new ChatterboxWorkerClient(options);
  }

  async synthesize(request: TTSRequest): Promise<TTSResult> {
    return this.client.synthesize(request);
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
