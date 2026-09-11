export interface RenderOptions {
  output: string;
  fps?: number;
  quality?: "draft" | "standard" | "high";
  workers?: number;
  /**
   * Render a specific composition file (e.g. `compositions/scene-003.html`) instead of
   * the project's `index.html`. Passed straight through to the `hyperframes` CLI's own
   * `-c/--composition` flag (V2.4: scene-level preview renders, not a new render engine).
   */
  composition?: string;
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
