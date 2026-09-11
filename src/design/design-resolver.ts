import { DesignPreferenceCore, ProjectDesignStrategy } from "../schemas/design-strategy.js";

/**
 * Global -> chapter -> scene override resolution (V2.6 spec §4): the most specific valid
 * instruction wins. A simple last-write-wins per-field merge, not a templating engine —
 * every field an override supplies replaces the corresponding global/chapter value
 * wholesale (arrays included), so a scene override never has to fight an inherited list.
 */
export function resolveDesignForScene(
  strategy: ProjectDesignStrategy,
  chapterId?: string | null,
  sceneId?: string | null
): DesignPreferenceCore {
  const chapterOverride = chapterId ? strategy.chapterOverrides?.[chapterId] : undefined;
  const sceneOverride = sceneId ? strategy.sceneOverrides?.[sceneId] : undefined;
  return {
    ...strategy.global,
    ...chapterOverride,
    ...sceneOverride
  };
}
