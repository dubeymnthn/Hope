import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ArgumentResult, ArgumentResultSchema } from "../schemas/argument.js";
import { ResearchResult } from "../schemas/research.js";
import { ChannelConfig } from "../schemas/channel.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { ResearchCompleteness } from "../schemas/research-gaps.js";
import { ResearchPlan } from "../schemas/research-plan.js";
import { ResearchQuestionSet } from "../schemas/research-questions.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface ArgumentVerification {
  argument: ArgumentResult;
  artifactHash: string;
  /** Runtime the argument judges the evidence actually supports. */
  resolvedDurationMinutes: number;
}

/**
 * Argument / thesis stage.
 *
 * The Antigravity Argument Agent reasons over the research dossier and authors
 * argument/argument.json. TypeScript requests, validates, hashes and checkpoints.
 */
export class ArgumentAgent {
  public async ensure(
    topic: string,
    outputDir: string = process.cwd(),
    options?: {
      research?: ResearchResult;
      config?: ChannelConfig;
      repoRoot?: string;
      /** V2.3: structured evidence, when the research-planner/evidence-graph stages have run. */
      evidenceGraph?: EvidenceGraph;
      researchGaps?: ResearchCompleteness;
      plan?: ResearchPlan;
      questions?: ResearchQuestionSet;
    }
  ): Promise<ArgumentVerification> {
    const argumentDir = join(outputDir, "argument");
    const jsonPath = join(argumentDir, "argument.json");
    const mdPath = join(argumentDir, "argument.md");

    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });
    const video = options?.config?.video;
    const minMinutes = video?.minimumDurationMinutes ?? 7;
    const maxMinutes = video?.maximumDurationMinutes ?? 13;
    const targetMinutes = video?.targetDurationMinutes ?? 10;

    if (!existsSync(jsonPath)) {
      mkdirSync(argumentDir, { recursive: true });
      this.requestArgument(gate, topic, { minMinutes, maxMinutes, targetMinutes }, "argument/argument.json does not exist yet.", options);
    }

    let validated: ArgumentResult;
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
      validated = ArgumentResultSchema.parse(parsed);
    } catch (err: any) {
      this.requestArgument(
        gate,
        topic,
        { minMinutes, maxMinutes, targetMinutes },
        `Existing argument/argument.json is invalid and was rejected: ${err.message}`,
        options
      );
    }

    const argument = validated!;

    // Topic drift guard.
    if (argument.topic.trim().toLowerCase() !== topic.trim().toLowerCase()) {
      const overlap = this.keywordOverlap(argument.topic, topic);
      if (overlap < 0.6) {
        this.requestArgument(
          gate,
          topic,
          { minMinutes, maxMinutes, targetMinutes },
          `Existing argument addresses "${argument.topic}" but the requested topic is "${topic}".`,
          options
        );
      }
    }

    // The argument agent decides the runtime; TypeScript only sanity-bounds it.
    const resolved = argument.estimatedDepthMinutes;
    if (resolved < minMinutes || resolved > maxMinutes) {
      console.warn(
        `[ARGUMENT] Note: argument judges the evidence supports ~${resolved} min, which is outside ` +
          `the configured ${minMinutes}-${maxMinutes} min range. Honouring the agent's judgement; ` +
          `duration must emerge from evidence (spec section 29).`
      );
    }

    console.log(`[ARGUMENT] Verified editorial argument for "${argument.topic}"`);
    console.log(`  - Central question: "${argument.centralQuestion}"`);
    console.log(`  - Central thesis: "${argument.centralThesis}"`);
    console.log(`  - Supporting claims: ${argument.supportingClaims.length}`);
    console.log(`  - Counterarguments: ${argument.counterArguments.length}`);
    console.log(`  - Narrative phases: ${argument.narrativeProgression.length}`);
    console.log(`  - Runtime the evidence supports: ${resolved} minutes`);

    if (!existsSync(mdPath)) {
      this.generateMarkdown(argument, mdPath);
    }

    return {
      argument,
      artifactHash: hashArtifact(jsonPath),
      resolvedDurationMinutes: resolved
    };
  }

  /** Backwards-compatible entry point used by existing tests. */
  public async loadOrValidate(outputDir: string = process.cwd()): Promise<ArgumentResult> {
    const jsonPath = join(outputDir, "argument", "argument.json");
    if (!existsSync(jsonPath)) {
      throw new Error(`[ARGUMENT AGENT] Missing argument artifact at ${jsonPath}.`);
    }
    const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
    const validated = ArgumentResultSchema.parse(parsed);
    const mdPath = join(outputDir, "argument", "argument.md");
    if (!existsSync(mdPath)) this.generateMarkdown(validated, mdPath);
    return validated;
  }

  private keywordOverlap(a: string, b: string): number {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3);
    const aw = norm(a);
    const bw = norm(b);
    if (aw.length === 0 || bw.length === 0) return 0;
    return aw.filter((w) => bw.includes(w)).length / Math.min(aw.length, bw.length);
  }

  private requestArgument(
    gate: AgentTaskGate,
    topic: string,
    bounds: { minMinutes: number; maxMinutes: number; targetMinutes: number },
    reason: string,
    options?: {
      evidenceGraph?: EvidenceGraph;
      researchGaps?: ResearchCompleteness;
      plan?: ResearchPlan;
      questions?: ResearchQuestionSet;
    }
  ): never {
    const evidenceGraphGuidance = options?.evidenceGraph
      ? `\n\nA structured evidence graph is available (research/evidence-graph.json, attached below), ` +
        `with sources classified by authority, claims traced to evidence, and contradictions/` +
        `uncertainty recorded explicitly. Use it: set \`evidenceStatus\` per supporting claim ` +
        `(SUPPORTED/PLAUSIBLE/UNCERTAIN/DISPUTED/UNSUPPORTED) honestly, and cite the graph's real ` +
        `claimId/evidenceId values in \`evidenceIds\`. An UNSUPPORTED claim may still appear, but ` +
        `must never be written as if it were established fact.` +
        (options.researchGaps
          ? ` research-gaps.json records ${options.researchGaps.gaps.length} known gap(s) at ` +
            `${options.researchGaps.overallCompletenessPercent}% overall completeness — factor genuine ` +
            `gaps into your counterarguments/evidence gaps rather than glossing over them.`
          : "")
      : "";

    return gate.request({
      stage: "argument",
      title: `Editorial argument and thesis for "${topic}"`,
      reason,
      artifactPath: "argument/argument.json",
      schemaName: "ArgumentResultSchema",
      schemaFiles: ["src/schemas/argument.ts", "src/schemas/research.ts"],
      mission:
        `Reason over the verified research dossier and decide what this documentary actually ` +
        `argues. This is an analytical stage, not a summarisation stage: determine the central ` +
        `question worth asking, the thesis the evidence genuinely supports, the strongest ` +
        `supporting claims and the evidence behind each, the serious counterarguments, the ` +
        `contradictions and evidence gaps, and the narrative progression that best explains it.\n\n` +
        `Critically: judge how long this topic genuinely deserves. Decide honestly between ` +
        `7, 8, 10 and 12 minutes based on how much the evidence actually supports. Do not force ` +
        `the subject to ${bounds.targetMinutes} minutes. A tight 7-minute argument is better than ` +
        `a padded 10-minute one. Record that judgement in estimatedDepthMinutes.${evidenceGraphGuidance}`,
      context: {
        topic,
        preferredDurationMinutes: bounds.targetMinutes,
        acceptableRangeMinutes: `${bounds.minMinutes}-${bounds.maxMinutes}`
      },
      requirements: [
        "Base every claim on the research dossier; cite the supporting evidence in `evidence`.",
        "State one central question and one central thesis; both must be specific, not generic.",
        "Provide at least 3 supporting claims, each with its evidential `strength` assessed honestly.",
        "Provide at least 1 genuine counterargument with a rebuttal and the remaining evidence gap.",
        "Provide at least 4 narrative progression phases that emerge from this topic's structure.",
        "Let the structure follow the evidence; do not apply a fixed template.",
        "Set `estimatedDepthMinutes` to the runtime the evidence genuinely supports.",
        "Write a conclusion that states the broader implication, not a restatement of the hook."
      ],
      prohibitions: [
        "Never introduce facts, statistics or sources absent from the research dossier.",
        "Never overstate certainty: claims backed by ESTIMATE or SPECULATION must be marked weaker.",
        "Never pad the estimated duration to reach the preferred target.",
        "Never present a counterargument you then strawman; represent it at its strongest.",
        "Never mark a claim SUPPORTED when the evidence graph shows it as DISPUTED or UNCERTAIN."
      ],
      inputs: [
        { label: "Research dossier (authoritative evidence base)", path: "research/research.json", inline: true },
        ...(options?.evidenceGraph ? [{ label: "Evidence graph (structured evidence)", path: "research/evidence-graph.json", inline: true }] : []),
        ...(options?.researchGaps ? [{ label: "Research completeness / gaps", path: "research/research-gaps.json", inline: true }] : []),
        { label: "Channel configuration", path: "config/channel.json", inline: true }
      ]
    });
  }

  private generateMarkdown(argument: ArgumentResult, mdPath: string): void {
    const lines: string[] = [
      `# Editorial Argument: ${argument.topic}`,
      ``,
      `## Central Question`,
      `> ${argument.centralQuestion}`,
      ``,
      `## Overarching Thesis`,
      `**${argument.centralThesis}**`,
      ``,
      `*Runtime the evidence supports:* **${argument.estimatedDepthMinutes} minutes**`,
      ``,
      `## Supporting Claims & Empirical Backing`,
      ...argument.supportingClaims.map(
        (c, i) =>
          `### Claim ${i + 1}: ${c.claim} [${c.category} - ${c.strength.toUpperCase()}]\n` +
          c.evidence.map((e) => `- *Evidence:* ${e}`).join("\n")
      ),
      ``,
      `## Counter-Arguments & Contextual Nuance`,
      ...argument.counterArguments.map(
        (ca, i) =>
          `### Position ${i + 1}: ${ca.position}\n` +
          `- **Rebuttal / Clarification:** ${ca.rebuttal}\n` +
          `- **Evidence Gap / Unknown:** ${ca.evidenceGap}`
      ),
      ``,
      `## Narrative Progression Structure`,
      ...argument.narrativeProgression.map(
        (p, i) =>
          `### Beat ${i + 1}: ${p.phase.toUpperCase()} — ${p.purpose}\n` +
          p.keyPoints.map((kp) => `- ${kp}`).join("\n") +
          `\n- **Transition:** *${p.transitionQuestion}*`
      ),
      ``,
      `## Final Synthesis`,
      argument.conclusion
    ];

    writeFileSync(mdPath, lines.join("\n"), "utf-8");
    console.log(`[ARGUMENT] Emitted companion argument markdown to ${mdPath}`);
  }
}
