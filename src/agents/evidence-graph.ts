import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EvidenceGraph, EvidenceGraphSchema } from "../schemas/evidence-graph.js";
import { ResearchPlan } from "../schemas/research-plan.js";
import { ResearchQuestionSet } from "../schemas/research-questions.js";
import { ResearchResult } from "../schemas/research.js";
import { validateEvidenceGraphIntegrity } from "../research/evidence-graph-integrity.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface EvidenceGraphVerification {
  graph: EvidenceGraph;
  artifactHash: string;
  integrityWarnings: string[];
  stats: {
    sources: number;
    evidence: number;
    claims: number;
    contradictions: number;
    dataPoints: number;
  };
}

/**
 * Evidence Graph stage (V2.3 spec sections 4-19).
 *
 * Deepens research/research.json (which stays exactly as-is, still required upstream)
 * into a structured graph: sources classified by authority, claims traced to evidence,
 * contradictions and uncertainty recorded explicitly, a thesis stress test evaluated.
 * The brief asks the agent to internally run the full iterative loop from spec §9 (broad
 * search -> initial graph -> gap ID -> targeted search -> primary-source search ->
 * contradiction search -> thesis re-evaluation) before producing the final artifact,
 * mirroring how researcher.ts already asks for one complete, internally-diligent pass
 * rather than orchestrating each micro-step as its own gate.
 */
export class EvidenceGraphAgent {
  public async ensure(
    topic: string,
    outputDir: string = process.cwd(),
    options: {
      plan: ResearchPlan;
      questions: ResearchQuestionSet;
      research: ResearchResult;
      repoRoot?: string;
    }
  ): Promise<EvidenceGraphVerification> {
    const researchDir = join(outputDir, "research");
    const jsonPath = join(researchDir, "evidence-graph.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options.repoRoot });

    if (!existsSync(jsonPath)) {
      mkdirSync(researchDir, { recursive: true });
      this.requestGraph(gate, topic, options, "research/evidence-graph.json does not exist yet.");
    }

    let validated: EvidenceGraph;
    try {
      validated = EvidenceGraphSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    } catch (err: any) {
      this.requestGraph(gate, topic, options, `Existing research/evidence-graph.json is invalid and was rejected: ${err.message}`);
    }

    const graph = validated!;
    if (graph.topic.trim().toLowerCase() !== topic.trim().toLowerCase()) {
      this.requestGraph(
        gate,
        topic,
        options,
        `Existing evidence graph addresses "${graph.topic}" but the requested topic is "${topic}".`
      );
    }

    // Structural correctness (referential integrity, placeholder citations, definition
    // mismatches) is enforced outside zod, same split as chart-data integrity elsewhere.
    const { warnings } = validateEvidenceGraphIntegrity(graph);

    console.log(`[EVIDENCE-GRAPH] Verified evidence graph for "${graph.topic}"`);
    console.log(`  - Sources: ${graph.sources.length} (${graph.sources.filter((s) => s.primaryOrSecondary === "primary").length} primary)`);
    console.log(`  - Evidence items: ${graph.evidence.length}`);
    console.log(`  - Claims: ${graph.claims.length}`);
    console.log(`  - Contradictions recorded: ${graph.contradictions.length}`);
    console.log(`  - Data points: ${graph.dataPoints.length}`);
    console.log(`  - Thesis candidates stress-tested: ${graph.thesisStressTest.length}`);
    if (warnings.length > 0) {
      console.warn(`[EVIDENCE-GRAPH] ${warnings.length} integrity warning(s):`);
      for (const w of warnings) console.warn(`  - ${w}`);
    }

    return {
      graph,
      artifactHash: hashArtifact(jsonPath),
      integrityWarnings: warnings,
      stats: {
        sources: graph.sources.length,
        evidence: graph.evidence.length,
        claims: graph.claims.length,
        contradictions: graph.contradictions.length,
        dataPoints: graph.dataPoints.length
      }
    };
  }

  private requestGraph(
    gate: AgentTaskGate,
    topic: string,
    options: { plan: ResearchPlan; questions: ResearchQuestionSet; research: ResearchResult },
    reason: string
  ): never {
    const requiredCategories = options.plan.categories.filter((c) => c.decision === "required").map((c) => c.category);

    return gate.request({
      stage: "evidence-graph",
      title: `Evidence graph for "${topic}"`,
      reason,
      artifactPath: "research/evidence-graph.json",
      schemaName: "EvidenceGraphSchema",
      schemaFiles: ["src/schemas/evidence-graph.ts", "src/schemas/research-plan.ts"],
      mission:
        `Build a structured evidence graph for "${topic}" that goes well beyond the flat research ` +
        `dossier already on disk (research/research.json, attached below). Follow this loop, ` +
        `iterating until coverage is genuinely sufficient rather than stopping at a fixed search count:\n\n` +
        `1. Search broadly enough to map the topic across the categories research-plan.json selected.\n` +
        `2. Build an initial graph of sources -> evidence -> claims.\n` +
        `3. Identify which questions from research-questions.json remain unanswered or weakly supported.\n` +
        `4. Run targeted follow-up searches specifically for those gaps.\n` +
        `5. Search specifically for primary sources (filings, regulatory documents, datasets, papers) ` +
        `for any required-category claim that currently rests only on secondary analysis.\n` +
        `6. Actively search for what would make your leading explanation WRONG: criticism, alternative ` +
        `explanations, contradictory data, limitations, failed predictions. Record what you find as ` +
        `Contradiction/Uncertainty entries, whether or not it weakens the thesis.\n` +
        `7. Once you have 2+ candidate explanations, stress-test them against each other in ` +
        `thesisStressTest: supporting evidence, contradicting evidence, unanswered questions, confidence. ` +
        `Do not force a "both sides" narrative if the evidence is genuinely asymmetric — say so.\n\n` +
        `Tag every Evidence/Claim with the correct temporalStatus (HISTORICAL/CURRENT/RECENT/ANNOUNCED/` +
        `PLANNED/UNDER_DEVELOPMENT/FORECAST/SPECULATIVE) — these categories must never be mixed silently.`,
      context: {
        topic,
        requiredCategories: requiredCategories.join(", "),
        totalQuestions: options.questions.questions.length
      },
      requirements: [
        "Classify every source's sourceType (PRIMARY_GOVERNMENT ... REFERENCE_PAGE) honestly.",
        "Prefer primary sources for factual/quantitative claims; secondary sources are acceptable but must be labelled `primaryOrSecondary: \"secondary\"`, not silently treated as primary.",
        "For every important number, record scope, definition, unit and date precisely (spec §7-8) — do not merge a cell price with a pack price just because both look like 'the price'.",
        "For every required category, actively search for contradicting evidence, not just confirming evidence.",
        "Record genuine expert disagreement (consensus/majorityView/minorityView) only where it actually exists; never manufacture balance.",
        "Every claim's supportingEvidenceIds/contradictingEvidenceIds/dataPointIds/entityIds/eventIds must reference real ids you define in this same file.",
        "Answer research-questions.json's questions where you can; leave genuinely unanswered ones out of `answeredBy` rather than force-fitting a weak answer.",
        "Extract entities and their relationships (SUPPLIES, MANUFACTURES, DEPENDS_ON, etc.) only where the sources actually support that relationship.",
        "Extract dated events with real sourceIds; do not invent a date precision you don't have (use 'approximate' honestly)."
      ],
      prohibitions: [
        "Never fabricate a URL, excerpt, statistic, date, or entity relationship.",
        "Never invent a source's authority; classify what the source actually is.",
        "Never present a FORECAST or SPECULATIVE item with the phrasing of an established CURRENT fact.",
        "Never silently merge two data points with different scope/unit/definition as if directly comparable.",
        "Never manufacture a contradiction or disagreement that the evidence does not actually contain.",
        "Never use a placeholder citation such as example.com, 'TODO' or a bare 'N/A' as a whole field.",
        "Never mark a category's questions answered without evidence that actually answers them."
      ],
      inputs: [
        { label: "Research plan (selected categories)", path: "research/research-plan.json", inline: true },
        { label: "Research questions (answer these)", path: "research/research-questions.json", inline: true },
        { label: "Existing research dossier (starting material, not a ceiling)", path: "research/research.json", inline: true }
      ]
    });
  }
}
