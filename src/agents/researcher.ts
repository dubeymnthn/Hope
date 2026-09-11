import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { ResearchResult, ResearchResultSchema } from "../schemas/research.js";
import { ResearchPlan } from "../schemas/research-plan.js";
import { ResearchQuestionSet } from "../schemas/research-questions.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface ResearchVerification {
  research: ResearchResult;
  artifactHash: string;
  sourceTraceability: {
    totalFacts: number;
    factsWithUsableSource: number;
    distinctSources: number;
    suspiciousSources: string[];
  };
  evidenceDepth: {
    estimatedSupportedMinutes: number;
    sufficientForTarget: boolean;
  };
}

/**
 * Markers of a placeholder citation rather than a real retrieved source.
 *
 * These must not fire on legitimate technical vocabulary. In particular "N/A" is only
 * treated as a placeholder when it stands alone as the whole field or as its own word
 * with a slash: hyphenated optics terms such as "High-NA" and "Low-NA" are real source
 * titles, not missing data.
 */
/**
 * Structured rather than substring-based (spec V2.2 §8): a citation is a placeholder when
 * its URL host is a reserved/example domain, or when the WHOLE title or WHOLE url is a
 * null-like token. An "N/A" mention inside an otherwise real title with a real URL is
 * legitimate prose and must not be flagged.
 */
export const RESERVED_HOST = /^(?:www\.)?(?:example\.(?:com|org|net|edu)|localhost|127\.0\.0\.1|0\.0\.0\.0|test\.invalid|invalid)$/i;
export const WHOLE_FIELD_NULL = /^\s*(?:n\/?a|none|null|unknown|tbd|todo|placeholder|-|—|\?)\s*$/i;
export const PLACEHOLDER_SOURCE_PATTERNS = [
  /your-source-here/i,
  /^https?:\/\/(www\.)?source\b/i,
  /lorem ipsum/i,
  /\bTODO\b/
];

function hostOf(url: string): string | null {
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

/** Exported for reuse by evidence-graph-integrity.ts (V2.3) — one citation validator, not two. */
export function isPlaceholderCitation(url: string, title: string): boolean {
  if (WHOLE_FIELD_NULL.test(title) || WHOLE_FIELD_NULL.test(url)) return true;
  const host = hostOf(url);
  if (host && RESERVED_HOST.test(host)) return true;
  return PLACEHOLDER_SOURCE_PATTERNS.some((p) => p.test(url) || p.test(title));
}

/**
 * Research stage.
 *
 * The Antigravity Research Agent performs the actual web research and authors
 * research/research.json. This class never synthesises research content; it
 * requests the work, then validates, traces, hashes and checkpoints the result.
 */
export class ResearchAgent {
  /**
   * Ensures a valid, topic-matching research dossier exists for `topic`.
   * Halts the pipeline with an agent task brief when one does not.
   */
  public async ensure(topic: string, outputDir: string = process.cwd(), options?: {
    repoRoot?: string;
    targetMinutes?: number;
    wordsPerMinute?: number;
    /** V2.3: when the research-planner stage has already run, surfaced as extra brief context. */
    plan?: ResearchPlan;
    questions?: ResearchQuestionSet;
  }): Promise<ResearchVerification> {
    const researchDir = join(outputDir, "research");
    const jsonPath = join(researchDir, "research.json");
    const mdPath = join(researchDir, "research.md");
    const targetMinutes = options?.targetMinutes ?? 10;

    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });

    if (!existsSync(jsonPath)) {
      mkdirSync(researchDir, { recursive: true });
      this.requestResearch(gate, topic, targetMinutes, "research/research.json does not exist yet.", options);
    }

    let validated: ResearchResult;
    try {
      const parsed = JSON.parse(readFileSync(jsonPath, "utf-8"));
      validated = ResearchResultSchema.parse(parsed);
    } catch (err: any) {
      this.requestResearch(
        gate,
        topic,
        targetMinutes,
        `Existing research/research.json is invalid and was rejected: ${err.message}`,
        options
      );
    }

    // Topic drift guard: a dossier researched for a different subject must never be
    // silently reused for a new topic. This is what makes multi-topic runs honest.
    if (!this.topicsMatch(validated!.topic, topic)) {
      this.requestResearch(
        gate,
        topic,
        targetMinutes,
        `Existing dossier researches "${validated!.topic}" but the requested topic is ` +
          `"${topic}". Research must be performed for the requested topic.`,
        options
      );
    }

    const research = validated!;

    // --- Source traceability audit (spec section 22 / acceptance: traceability verified) ---
    const suspiciousSources: string[] = [];
    let factsWithUsableSource = 0;
    for (const fact of research.facts) {
      const url = fact.source?.url ?? "";
      const title = fact.source?.title ?? "";
      const isPlaceholder = isPlaceholderCitation(url, title);
      const looksResolvable = /^https?:\/\/[^\s/]+\.[^\s/]+/i.test(url);
      if (isPlaceholder) {
        suspiciousSources.push(`${fact.source?.title || "(untitled)"} -> ${url || "(no url)"}`);
      } else if (looksResolvable) {
        factsWithUsableSource++;
      } else if (url.trim().length > 0) {
        // Non-URL provenance (e.g. an earnings call transcript) is acceptable but noted.
        factsWithUsableSource++;
      }
    }

    const distinctSources = new Set(
      research.sources.map((s) => (s.url || s.title || "").toLowerCase().trim()).filter(Boolean)
    ).size;

    if (suspiciousSources.length > 0) {
      throw new Error(
        `[RESEARCH AGENT] Source traceability FAILED: ${suspiciousSources.length} placeholder or ` +
          `fabricated-looking citation(s) detected. Research must preserve real retrieved sources.\n` +
          suspiciousSources.map((s) => `  - ${s}`).join("\n")
      );
    }

    if (distinctSources < 2) {
      throw new Error(
        `[RESEARCH AGENT] Source traceability FAILED: only ${distinctSources} distinct source(s). ` +
          `Multiple independent searches and sources are required (spec section 1).`
      );
    }

    // --- Evidence depth assessment: is there enough for the target runtime? ---
    const evidenceUnits =
      research.facts.length + research.statistics.length + research.timeline.length;
    // Calibration: a substantive documentary minute consumes roughly 3 evidence units.
    const estimatedSupportedMinutes = Math.round((evidenceUnits / 3) * 10) / 10;
    const sufficientForTarget = estimatedSupportedMinutes >= Math.min(targetMinutes, 7);

    console.log(`[RESEARCH] Verified dossier for topic: "${research.topic}"`);
    console.log(`  - Facts: ${research.facts.length}`);
    console.log(`  - Statistics: ${research.statistics.length}`);
    console.log(`  - Timeline events: ${research.timeline.length}`);
    console.log(`  - Distinct sources: ${distinctSources}`);
    console.log(`  - Claims flagged for careful treatment: ${research.claims_to_verify.length}`);
    console.log(
      `  - Evidence depth: ~${estimatedSupportedMinutes} min of supportable narration ` +
        `(target ${targetMinutes} min)`
    );
    if (!sufficientForTarget) {
      console.warn(
        `[RESEARCH] WARNING: evidence may be thin for a ${targetMinutes}-minute documentary. ` +
          `The argument stage should reduce the runtime rather than pad it.`
      );
    }

    if (!existsSync(mdPath)) {
      this.generateMarkdownSummary(research, mdPath);
    }

    return {
      research,
      artifactHash: hashArtifact(jsonPath),
      sourceTraceability: {
        totalFacts: research.facts.length,
        factsWithUsableSource,
        distinctSources,
        suspiciousSources
      },
      evidenceDepth: { estimatedSupportedMinutes, sufficientForTarget }
    };
  }

  /**
   * Backwards-compatible entry point used by the V1 milestone tests.
   */
  public async loadOrValidate(topic: string, outputDir: string = process.cwd()): Promise<ResearchResult> {
    const result = await this.ensure(topic, outputDir);
    return result.research;
  }

  private topicsMatch(a: string, b: string): boolean {
    const norm = (s: string) =>
      s
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, " ")
        .split(/\s+/)
        .filter((w) => w.length > 3 && !["what", "why", "how", "does", "the", "and", "for", "are", "with", "this", "that", "from"].includes(w))
        .sort();

    const aw = norm(a);
    const bw = norm(b);
    if (aw.length === 0 || bw.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();

    const overlap = aw.filter((w) => bw.includes(w)).length;
    // Require a majority of the shorter keyword set to overlap.
    return overlap / Math.min(aw.length, bw.length) >= 0.6;
  }

  private requestResearch(
    gate: AgentTaskGate,
    topic: string,
    targetMinutes: number,
    reason: string,
    options?: { plan?: ResearchPlan; questions?: ResearchQuestionSet }
  ): never {
    const planGuidance = options?.plan
      ? `\n\nA research plan has already selected the categories that matter for this topic ` +
        `(research-plan.json, attached below) and, where available, the specific questions to ` +
        `answer (research-questions.json). Research against that plan rather than starting cold.`
      : "";

    return gate.request({
      stage: "research",
      title: `Research dossier for "${topic}"`,
      reason,
      artifactPath: "research/research.json",
      schemaName: "ResearchResultSchema",
      schemaFiles: ["src/schemas/research.ts"],
      mission:
        `Research the topic "${topic}" to documentary standard and produce a verified research ` +
        `dossier. You must actually search the web and read sources: perform multiple independent ` +
        `searches rather than relying on a single source, and prioritise primary and highly ` +
        `credible sources (company filings and IR releases, regulatory documents, standards bodies, ` +
        `peer-reviewed work, named-analyst reports, established trade press).\n\n` +
        `The dossier must support roughly ${targetMinutes} minutes of substantive narration. ` +
        `If the evidence genuinely does not support that, say so through the evidence you record ` +
        `rather than inventing material to fill the gap.${planGuidance}`,
      context: {
        topic,
        targetNarrationMinutes: targetMinutes,
        minimumDistinctSources: 2
      },
      requirements: [
        "Perform multiple distinct web searches covering different facets of the topic.",
        "Prefer primary and highly credible sources; record the source title and URL for every claim.",
        "Record a retrieval timestamp (`retrievedAt`, ISO 8601) on sources where available.",
        "Categorise every statement precisely: FACT, OPINION, ESTIMATE, SPECULATION or UNVERIFIED.",
        "Set a calibrated `confidence` (0-1) per fact reflecting genuine evidential strength.",
        "Capture concrete statistics with their metric, value, unit/context and source.",
        "Capture the timeline of events that actually drive the story, with significance for each.",
        "Record contradictions between sources and evidence gaps in `claims_to_verify`.",
        "List key people and organisations that genuinely appear in the sources.",
        "Write an `angle` that states the specific editorial thesis the evidence supports.",
        "Use at least 2 distinct sources; a 10-minute documentary normally needs many more."
      ],
      prohibitions: [
        "Never fabricate a URL, or cite a source you did not actually retrieve.",
        "Never fabricate statistics, quotations, dates, or company claims.",
        "Never invent causal relationships that the sources do not support.",
        "Never present speculation, estimates or opinion as established fact.",
        "Never use placeholder citations such as example.com, 'TODO' or 'N/A'."
      ],
      inputs: [
        ...(options?.plan ? [{ label: "Research plan (V2.3 — categories selected for this topic)", path: "research/research-plan.json", inline: true }] : []),
        ...(options?.questions ? [{ label: "Research questions (V2.3 — answer these)", path: "research/research-questions.json", inline: true }] : [])
      ]
    });
  }

  private generateMarkdownSummary(research: ResearchResult, mdPath: string): void {
    const lines: string[] = [
      `# Research Dossier: ${research.topic}`,
      ``,
      `**Editorial Angle:** ${research.angle}`,
      ``,
      `## Executive Summary`,
      research.summary,
      ``,
      `## Verified Facts & Categorized Claims`,
      ...research.facts.map(
        (f, i) =>
          `${i + 1}. **[${f.category}]** (Confidence: ${(f.confidence * 100).toFixed(0)}%) ${f.statement}\n` +
          `   *Source: ${f.source.title} (${f.source.url})*`
      ),
      ``,
      `## Key Statistics`,
      ...research.statistics.map((s) => `- **${s.metric}**: \`${s.value}\` (${s.context})`),
      ``,
      `## Timeline of Key Developments`,
      ...research.timeline.map((t) => `- **${t.date}**: ${t.event} — *${t.significance}*`),
      ``,
      `## Contradictions & Evidence Gaps`,
      ...research.claims_to_verify.map((c) => `- ${c}`),
      ``,
      `## Sources Cited`,
      ...research.sources.map((src) => `- [${src.title}](${src.url})${src.retrievedAt ? ` — retrieved ${src.retrievedAt}` : ""}`)
    ];

    writeFileSync(mdPath, lines.join("\n"), "utf-8");
    console.log(`[RESEARCH] Emitted companion dossier markdown to ${mdPath}`);
  }
}
