export interface RenderOptions {
  output: string;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  workers?: number;
}

export interface RenderResult {
  outputPath: string;
  duration: number;
  width: number;
  height: number;
  fps: number;
  renderTimeMs: number;
}

export interface VideoRenderer {
  render(projectDir: string, options: RenderOptions): Promise<RenderResult>;
}
