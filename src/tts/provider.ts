export interface TTSRequest {
  text: string;
  voiceId: string;
  language: string;
  speed?: number;
  outputFilePath?: string;
}

export interface TTSResult {
  audioPath: string;
  sampleRate: number;
  duration: number;
}

export interface TTSProvider {
  synthesize(request: TTSRequest): Promise<TTSResult>;
}
