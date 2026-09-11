import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ScriptResult, ScriptResultSchema } from "../schemas/script.js";
import { ArgumentResult } from "../schemas/argument.js";
import { ChannelConfig, resolvePlanningRate } from "../schemas/channel.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface ScriptVerification {
  script: ScriptResult;
  artifactHash: string;
  totalWords: number;
  estimatedMinutes: number;
}

/**
 * Script stage.
 *
 * The Antigravity Script Agent writes the documentary narration and authors
 * script/script.json. TypeScript requests, validates, hashes and checkpoints.
 */
export class ScriptAgent {
  public async ensure(
    topic: string,
    outputDir: string = process.cwd(),
    options?: {
      argument?: ArgumentResult;
      config?: ChannelConfig;
      repoRoot?: string;
      /** V2.3: when available, so the agent can populate scriptClaims[].evidenceIds with real ids. */
      evidenceGraph?: EvidenceGraph;
    }
  ): Promise<ScriptVerification> {
    const scriptDir = join(outputDir, "script");
    const jsonPath = join(scriptDir, "script.json");
    const mdPath = join(scriptDir, "script.md");

    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });
    // Planning rate is measurement-driven (spec V2.2 §3): the calibration block wins,
    // the legacy estimate is a labelled fallback, and neither is a sacred constant.
    const rate = resolvePlanningRate(options?.config?.video);
    const wpm = rate.wordsPerMinute;
    if (rate.source === "legacy-estimate") {
      console.warn(
        `[SCRIPT] No TTS calibration in config; planning at the legacy estimate of ${wpm} wpm. ` +
          `Run a production and record the measured rate to calibrate.`
      );
    }
    // The argument stage owns the runtime decision; fall back to the channel target.
    const targetMinutes =
      options?.argument?.estimatedDepthMinutes ?? options?.config?.video?.targetDurationMinutes ?? 10;
    const toleranceMinutes = options?.config?.video?.targetToleranceMinutes ?? 1;

    if (!existsSync(jsonPath)) {
      mkdirSync(scriptDir, { recursive: true });
      this.requestScript(gate, topic, targetMinutes, wpm, "script/script.json does not exist yet.", toleranceMinutes, options?.evidenceGraph);
    }

    let validated: ScriptResult;
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
      validated = ScriptResultSchema.parse(parsed);
    } catch (err: any) {
      this.requestScript(
        gate,
        topic,
        targetMinutes,
        wpm,
        `Existing script/script.json is invalid and was rejected: ${err.message}`,
        toleranceMinutes,
        options?.evidenceGraph
      );
    }

    const script = validated!;
    const totalWords = script.scenes.reduce(
      (acc, s) => acc + s.narration.trim().split(/\s+/).filter(Boolean).length,
      0
    );
    const estimatedMinutes = Math.round((totalWords / wpm) * 10) / 10;

    console.log(`[SCRIPT] Verified documentary script: "${script.title}"`);
    console.log(`  - Scenes: ${script.scenes.length}`);
    console.log(`  - Chapters: ${script.chapters?.length ?? 0}`);
    console.log(`  - Total words: ${totalWords}`);
    console.log(`  - Estimated narration: ~${estimatedMinutes} min at ${wpm} wpm`);

    if (!existsSync(mdPath)) {
      this.generateMarkdown(script, totalWords, estimatedMinutes, mdPath);
    }

    return { script, artifactHash: hashArtifact(jsonPath), totalWords, estimatedMinutes };
  }

  /** Backwards-compatible entry point used by existing tests. */
  public async loadOrValidate(outputDir: string = process.cwd()): Promise<ScriptResult> {
    const jsonPath = join(outputDir, "script", "script.json");
    if (!existsSync(jsonPath)) {
      throw new Error(`[SCRIPT AGENT] Missing script artifact at ${jsonPath}.`);
    }
    const validated = ScriptResultSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    const totalWords = validated.scenes.reduce(
      (acc, s) => acc + s.narration.trim().split(/\s+/).filter(Boolean).length,
      0
    );
    const estimatedMinutes = Math.round((totalWords / 150) * 10) / 10;
    const mdPath = join(outputDir, "script", "script.md");
    if (!existsSync(mdPath)) this.generateMarkdown(validated, totalWords, estimatedMinutes, mdPath);
    return validated;
  }

  private requestScript(
    gate: AgentTaskGate,
    topic: string,
    targetMinutes: number,
    wpm: number,
    reason: string,
    toleranceMinutes = 1,
    evidenceGraph?: EvidenceGraph
  ): never {
    // The planning band is the target ± the configured tolerance, expressed in words at
    // the MEASURED rate (spec V2.2 §3): a 10 min target at 189 wpm plans 1,701-2,079 words
    // so that the synthesised result lands in 9-11 minutes without padding.
    const lowWords = Math.round(Math.max(1, targetMinutes - toleranceMinutes) * wpm);
    const highWords = Math.round((targetMinutes + toleranceMinutes) * wpm);

    const evidenceGraphGuidance = evidenceGraph
      ? `\n\nAn evidence graph is available (research/evidence-graph.json, attached below). For each ` +
        `scene's major factual claims, populate \`scriptClaims\` with the real claimId/evidenceId ` +
        `values from the graph in \`evidenceIds\` — no orphan factual claims. The legacy \`claims\` ` +
        `free-text field may still be used for minor/transitional claims that don't need full traceability.`
      : "";

    return gate.request({
      stage: "script",
      title: `Long-form documentary script for "${topic}"`,
      reason,
      artifactPath: "script/script.json",
      schemaName: "ScriptResultSchema",
      schemaFiles: ["src/schemas/script.ts", "src/schemas/argument.ts"],
      mission:
        `Write a genuine long-form documentary narration that argues the thesis in ` +
        `argument/argument.json, grounded strictly in research/research.json.\n\n` +
        `This is writing, not assembly. Do not concatenate research facts into paragraphs. ` +
        `Build an argument that develops: explain mechanisms so a smart non-specialist follows ` +
        `them, use concrete examples, show cause and effect, apply appropriate skepticism, engage ` +
        `the counterarguments, and reach a conclusion that actually concludes something.\n\n` +
        `The argument stage judged this topic supports about ${targetMinutes} minutes. Use ` +
        `${lowWords}-${highWords} words as a planning range, not a quota. Never add filler to ` +
        `reach a length. A strong shorter documentary beats a padded longer one.\n\n` +
        `Break the narration into scenes at genuine narrative beats. Each scene's narration is ` +
        `synthesised as one contiguous TTS unit, so keep scenes to coherent spoken passages ` +
        `(roughly 20-45 seconds of speech each). Let the scene count follow the material.${evidenceGraphGuidance}`,
      context: {
        topic,
        targetNarrationMinutes: targetMinutes,
        planningWordRange: `${lowWords}-${highWords}`,
        wordsPerMinuteEstimate: wpm
      },
      requirements: [
        "Ground every factual claim in research/research.json; nothing new may enter here.",
        "Open with a cold open that states real stakes in the first 10-15 seconds.",
        "State the central question explicitly early, then progressively answer it.",
        "Explain mechanisms concretely; when a technical idea is needed, actually explain it.",
        "Engage the counterarguments from the argument artifact rather than ignoring them.",
        "Vary sentence length: mix short punchy statements with longer explanatory sentences.",
        "Write for the ear, not the page: this text will be read aloud by a TTS voice.",
        "Give each scene a `purpose`, a `visual_hint`, and the `claims` it carries.",
        "Define `chapters` that reflect this topic's actual structure.",
        "Set `estimatedDurationMinutes` and `totalWordCount` to honest computed values.",
        "End with a synthesis that earns its conclusion from the evidence presented."
      ],
      prohibitions: [
        "Never invent statistics, quotations, dates, sources or causal claims.",
        "Never present ESTIMATE, OPINION or SPECULATION material as established fact.",
        "Never use generic AI phrasing ('delve into', 'tapestry of', 'a testament to', 'in today's fast-paced world').",
        "Never use empty rhetorical questions, fake suspense, or manufactured hype.",
        "Never repeat an explanation already given, and never pad paragraphs to fill time.",
        "Never write a greeting, a subscribe plug, or 'in this video we will'.",
        "Never let the script read like an article being read aloud."
      ],
      inputs: [
        { label: "Editorial argument (the thesis to argue)", path: "argument/argument.json", inline: true },
        { label: "Research dossier (the only permitted evidence base)", path: "research/research.json", inline: true },
        ...(evidenceGraph ? [{ label: "Evidence graph (for scriptClaims traceability)", path: "research/evidence-graph.json", inline: true }] : []),
        { label: "Channel configuration", path: "config/channel.json", inline: true }
      ]
    });
  }

  private generateMarkdown(
    script: ScriptResult,
    totalWords: number,
    estimatedMinutes: number,
    mdPath: string
  ): void {
    const lines: string[] = [
      `# Documentary Script: ${script.title}`,
      ``,
      `*Total Words:* ${totalWords} | *Estimated Duration:* ~${estimatedMinutes} min`,
      ``,
      `## Cold Open Hook`,
      `> ${script.hook}`,
      ``,
      ...(script.chapters && script.chapters.length > 0
        ? [
            `## Chapter Structure`,
            ...script.chapters.map(
              (c) => `- **${c.id}: ${c.title}**${c.act ? ` (Act ${c.act})` : ""} — ${c.narrativePurpose}`
            ),
            ``
          ]
        : []),
      `## Narrative Scenes`,
      ...script.scenes.map(
        (s, i) =>
          `### Scene ${i + 1}: \`${s.id}\` — ${s.purpose}\n` +
          (s.chapter ? `*Chapter:* ${s.chapter}\n\n` : "") +
          `> "${s.narration}"\n\n` +
          `*Visual hint:* ${s.visual_hint}\n`
      ),
      ``,
      `## Closing Takeaway`,
      `> ${script.ending}`
    ];

    writeFileSync(mdPath, lines.join("\n"), "utf-8");
    console.log(`[SCRIPT] Emitted companion script markdown to ${mdPath}`);
  }
}
