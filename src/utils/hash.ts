import { createHash } from "node:crypto";
import { StoryboardScene } from "../schemas/storyboard.js";
import { ChannelDesign } from "../schemas/design.js";

export function computeSceneHash(scene: StoryboardScene, design: ChannelDesign): string {
  const payload = [
    scene.id,
    scene.narration,
    scene.visual_type,
    scene.visual_description,
    scene.on_screen_text,
    scene.duration.toFixed(3),
    design.version,
    design.colors.background,
    design.colors.primary,
    design.colors.secondary
  ].join("::");

  return createHash("sha256").update(payload).digest("hex").slice(0, 16);
}
