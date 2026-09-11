import { join } from "node:path";
import { writeFileSync as fsWriteFileSync } from "node:fs";
import { StoryboardResult } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";
import { SceneCompositionGenerator, GenerationResult } from "../scenes/scene-generator.js";

export class VisualSceneAgent {
  private generator: SceneCompositionGenerator;

  constructor() {
    this.generator = new SceneCompositionGenerator();
  }

  async generateAllScenes(
    storyboard: StoryboardResult,
    design: ChannelDesign,
    designVersion: string,
    outputDir: string,
    repoRoot?: string
  ): Promise<GenerationResult[]> {
    console.log(`[VISUAL-SCENE] Generating visual compositions for ${storyboard.scenes.length} storyboard scenes...`);

    const results: GenerationResult[] = [];
    for (const scene of storyboard.scenes) {
      const res = await this.generator.generateScene(scene, {
        design,
        designVersion,
        outputDir,
        repoRoot
      });
      results.push(res);
    }

    // Build Master HyperFrames Composition (index.html + hyperframes.json)
    this.buildMasterComposition(storyboard, design, outputDir);

    const reused = results.filter((r) => r.reused).length;
    const degraded = results.filter((r) => r.degraded).length;
    console.log(
      `[VISUAL-SCENE] ${results.length} compositions ready (${reused} reused, ${results.length - reused} rebuilt` +
        `${degraded > 0 ? `, ${degraded} degraded for missing data` : ""}).`
    );

    return results;
  }

  private buildMasterComposition(
    storyboard: StoryboardResult,
    design: ChannelDesign,
    outputDir: string
  ): void {
    const configPath = join(outputDir, "hyperframes.json");
    const projectName = (storyboard.video_title || "documentary")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "") || "documentary";

    fsWriteFileSync(
      configPath,
      JSON.stringify(
        {
          name: projectName,
          fps: design.canvas.fps,
          width: design.canvas.width,
          height: design.canvas.height
        },
        null,
        2
      ),
      "utf-8"
    );

    const sceneDivs = storyboard.scenes
      .map(
        (s) =>
          `    <div id="${s.id}" data-composition-id="${s.id}" data-composition-src="compositions/${s.id}.html" data-start="${s.start}" data-duration="${s.duration}"></div>`
      )
      .join("\n");

    const masterHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>${storyboard.video_title}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body { width: 100%; height: 100%; overflow: hidden; background: ${design.colors.background}; }
    #root { width: ${design.canvas.width}px; height: ${design.canvas.height}px; position: relative; }
  </style>
</head>
<body>
  <div id="root" data-composition-id="main" data-no-timeline data-start="0" data-duration="${storyboard.total_duration}" data-fps="${design.canvas.fps}" data-width="${design.canvas.width}" data-height="${design.canvas.height}">
${sceneDivs}
  </div>
</body>
</html>`;

    const indexPath = join(outputDir, "index.html");
    fsWriteFileSync(indexPath, masterHtml, "utf-8");
    console.log(`[VISUAL-SCENE] Master HyperFrames index.html generated at ${indexPath}`);
  }
}
