import { StoryboardScene, StoryboardResult } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";

export interface GenerationContext {
  design: ChannelDesign;
  storyboard: StoryboardResult;
  videoDir: string;
}

export interface GeneratedScene {
  sceneId: string;
  htmlPath: string;
  metaPath: string;
  hash: string;
  duration: number;
}

export interface SceneGenerator {
  generate(scene: StoryboardScene, context: GenerationContext): Promise<GeneratedScene>;
}
