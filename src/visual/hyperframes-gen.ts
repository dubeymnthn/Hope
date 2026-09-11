import { join } from "node:path";
import { SceneGenerator, GenerationContext, GeneratedScene } from "./generator.js";
import { StoryboardScene } from "../schemas/storyboard.js";
import { SceneCompositionGenerator } from "../scenes/scene-generator.js";

/**
 * HyperFrames scene generator.
 *
 * This is the `SceneGenerator` interface adapter for the production renderer. It used to
 * contain a second, parallel set of hardcoded compositions whose chart values, wafer counts
 * and node labels were baked into the source for one specific topic. That duplicated the
 * real renderer and displayed data no research artifact backed, so it has been replaced by
 * delegation to SceneCompositionGenerator (spec sections 13, 22).
 *
 * All topic content now arrives through the StoryboardScene authored by the Visual Director.
 */
export class HyperFramesSceneGenerator implements SceneGenerator {
  private generator = new SceneCompositionGenerator();

  async generate(scene: StoryboardScene, context: GenerationContext): Promise<GeneratedScene> {
    const { design, videoDir } = context;

    const result = await this.generator.generateScene(scene, {
      design,
      designVersion: design.version,
      outputDir: videoDir
    });

    return {
      sceneId: result.sceneId,
      htmlPath: result.htmlPath,
      metaPath: result.metaPath,
      hash: result.fingerprint,
      duration: scene.duration
    };
  }
}
