import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ProjectDesignStrategy, ProjectDesignStrategySchema } from "../schemas/design-strategy.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface DesignStrategyVerification {
  strategy: ProjectDesignStrategy;
  artifactHash: string;
}

/**
 * Design Strategist stage (V2.6 spec §3-§6). Entirely optional: only fires when a project
 * has a `design.md` file. Interprets it into a structured `ProjectDesignStrategy` — see
 * `src/schemas/design-strategy.ts` for the hard boundary against `ChannelDesignSchema`.
 * Same `AgentTaskGate` pattern as every other reasoning stage; `design.md` itself is never
 * treated as factual input anywhere downstream (spec §6).
 */
export class DesignStrategistAgent {
  /** Returns `null` (no gate, no artifact) when the project has no design.md at all. */
  public async ensure(
    topic: string,
    outputDir: string = process.cwd(),
    options?: { repoRoot?: string }
  ): Promise<DesignStrategyVerification | null> {
    const designMdPath = join(outputDir, "design.md");
    if (!existsSync(designMdPath)) return null;

    const designDir = join(outputDir, "design");
    const jsonPath = join(designDir, "design-strategy.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });
    const designMdHash = hashArtifact(designMdPath);

    if (!existsSync(jsonPath)) {
      mkdirSync(designDir, { recursive: true });
      this.requestStrategy(gate, topic, designMdHash, "design/design-strategy.json does not exist yet.");
    }

    let validated: ProjectDesignStrategy;
    try {
      validated = ProjectDesignStrategySchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    } catch (err: any) {
      this.requestStrategy(gate, topic, designMdHash, `Existing design/design-strategy.json is invalid and was rejected: ${err.message}`);
    }

    const strategy = validated!;
    if (strategy.sourceDesignMdHash !== designMdHash) {
      this.requestStrategy(gate, topic, designMdHash, "design.md changed since this strategy was generated; it must be re-interpreted.");
    }

    return { strategy, artifactHash: hashArtifact(jsonPath) };
  }

  private requestStrategy(gate: AgentTaskGate, topic: string, designMdHash: string, reason: string): never {
    return gate.request({
      stage: "design-strategist",
      title: `Design strategy for "${topic}"`,
      reason,
      artifactPath: "design/design-strategy.json",
      schemaName: "ProjectDesignStrategySchema",
      schemaFiles: ["src/schemas/design-strategy.ts"],
      mission:
        `Interpret design.md into a structured editorial design strategy for this documentary. ` +
        `design.md describes HOW the documentary should look and feel — visual identity, pacing, ` +
        `chart/diagram style, camera and animation language, caption style. It is never a source of ` +
        `facts, numbers or claims: nothing in this artifact may introduce content that belongs to ` +
        `research/argument/script.\n\n` +
        `Set \`sourceDesignMdHash\` to exactly "${designMdHash}" so the pipeline can detect when ` +
        `design.md changes again and this strategy needs to be re-interpreted.\n\n` +
        `Only add \`chapterOverrides\`/\`sceneOverrides\` entries when design.md actually asks for a ` +
        `specific chapter or scene to look different from the global strategy (e.g. "scene 8 should ` +
        `use a technical blueprint treatment"). Do not invent overrides that design.md never mentioned.`,
      context: { topic },
      requirements: [
        "Populate `global` with the documentary-wide editorial design preferences design.md describes.",
        "Use words/descriptions for color/typography character (e.g. 'restrained, warm, editorial'), never a literal hex color or font family name — those are governed exclusively by design/channel-design.json.",
        "`preferredVisualModes` must use values from VisualTypeEnum (src/schemas/storyboard.ts).",
        `Set sourceDesignMdHash to exactly "${designMdHash}".`
      ],
      prohibitions: [
        "Never introduce a fact, statistic, claim, date or entity name — that belongs to research/argument/script, never to design.",
        "Never specify a literal color hex code, RGB value or font family name.",
        "Never contradict a hard evidentiary requirement (e.g. never suggest hiding source citations)."
      ],
      inputs: [{ label: "design.md (the project's visual style brief)", path: "design.md", inline: true }]
    });
  }
}
