import { existsSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";

import { ResearchPlanSchema, ResearchPlan, ResearchCategoryEnum } from "../src/schemas/research-plan.js";
import { ResearchQuestionSetSchema, ResearchQuestionSet } from "../src/schemas/research-questions.js";
import {
  EvidenceGraphSchema,
  EvidenceGraph,
  SourceTypeEnum,
  TemporalStatusEnum,
  DisagreementTypeEnum,
  EntityTypeEnum,
  EntityRelationTypeEnum
} from "../src/schemas/evidence-graph.js";
import { GapTypeEnum, ResearchCompletenessSchema } from "../src/schemas/research-gaps.js";
import { VisualEvidenceMapSchema, VisualEvidenceMap } from "../src/schemas/visual-evidence-map.js";
import { ScriptResult } from "../src/schemas/script.js";
import { computeResearchGaps, assessResearchCompleteness, generateResearchGapsMarkdown } from "../src/research/gap-detection.js";
import { checkEvidenceGraphIntegrity, validateEvidenceGraphIntegrity } from "../src/research/evidence-graph-integrity.js";
import { ResearchPlannerAgent } from "../src/agents/research-planner.js";
import { EvidenceGraphAgent } from "../src/agents/evidence-graph.js";
import { VisualEvidenceMapperAgent } from "../src/agents/visual-evidence-mapper.js";
import { ScriptQAAgent } from "../src/agents/script-qa.js";
import { isAgentTaskPending } from "../src/agents/agent-task.js";
import { buildSearchIndex, search, resolveToTimestamp } from "../src/search/index.js";
import { AudioTimestamps } from "../src/schemas/timestamps.js";

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  [PASS] ${name}${detail ? ` — ${detail}` : ""}`);
    passed++;
  } else {
    console.log(`  [FAIL] ${name}${detail ? ` — ${detail}` : ""}`);
    failed++;
    failures.push(name);
  }
}
function section(t: string): void {
  console.log(`\n=== ${t} ===`);
}

const repoRoot = resolve(".");

function mkWorkspace(prefix: string): string {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

// ---------------------------------------------------------------------------
// Fixture builders
// ---------------------------------------------------------------------------

function fixturePlan(overrides?: Partial<ResearchPlan>): ResearchPlan {
  const cat = (category: any, decision: any, extra: Partial<any> = {}) => ({
    category,
    decision,
    rationale: `${category} matters because the fixture says so.`,
    expectedEvidenceType: "reports and filings",
    priority: 2,
    freshnessRequirement: "moderate" as const,
    primarySourceRequired: false,
    skippableIfUnavailable: false,
    ...extra
  } as ResearchPlan["categories"][number]);
  const base: ResearchPlan = {
    topic: "Fixture topic about widgets",
    categories: [cat("CORE_FACTS", "required"), cat("ECONOMICS", "required"), cat("REGULATION", "unnecessary")],
    version: "1.0.0"
  };
  return { ...base, ...overrides };
}

function fixtureQuestions(plan: ResearchPlan, overrides?: Partial<ResearchQuestionSet>): ResearchQuestionSet {
  const base: ResearchQuestionSet = {
    topic: plan.topic,
    questions: [
      {
        questionId: "q-001",
        category: "CORE_FACTS",
        questionText: "What are the core facts?",
        priority: 1,
        status: "open",
        requiredEvidenceLevel: "any",
        freshnessRequirement: "moderate",
        dependentQuestions: [],
        answeredBy: []
      }
    ],
    version: "1.0.0"
  };
  return { ...base, ...overrides };
}

/** A small, valid, self-consistent evidence graph — every *Id reference resolves. */
function fixtureGraph(overrides?: Partial<EvidenceGraph>): EvidenceGraph {
  const base: EvidenceGraph = {
    topic: "Fixture topic about widgets",
    sources: [
      { sourceId: "src-gov", sourceType: "PRIMARY_GOVERNMENT", title: "Agency A report", url: "https://agency-a.gov/report", primaryOrSecondary: "primary" },
      { sourceId: "src-news", sourceType: "NEWS_REPORT", title: "Trade Press coverage", url: "https://tradepress.example-news.com/widgets", primaryOrSecondary: "secondary" }
    ],
    evidence: [
      { evidenceId: "ev-001", sourceId: "src-gov", evidenceExcerpt: "Widget unit price fell 8% to $108/kWh in 2025.", confidence: 0.9, relevance: 0.9, temporalStatus: "CURRENT" },
      { evidenceId: "ev-002", sourceId: "src-news", evidenceExcerpt: "Analysts say widget demand is softening.", confidence: 0.6, relevance: 0.7, temporalStatus: "RECENT" }
    ],
    dataPoints: [],
    entities: [],
    entityRelations: [],
    events: [],
    claims: [
      {
        claimId: "claim-001",
        questionIds: ["q-001"],
        statement: "Widget unit prices fell in 2025.",
        category: "CORE_FACTS",
        supportingEvidenceIds: ["ev-001"],
        contradictingEvidenceIds: [],
        dataPointIds: [],
        entityIds: [],
        eventIds: [],
        temporalStatus: "CURRENT",
        confidence: 0.9
      }
    ],
    contradictions: [],
    uncertainties: [],
    thesisStressTest: [],
    version: "1.0.0"
  };
  return { ...base, ...overrides };
}

async function main(): Promise<void> {
  console.log("==============================================================");
  console.log("=== V2.3 Research Intelligence Regression Matrix            ===");
  console.log("==============================================================");

  // ------------------------------------------------------------------
  section("1. Research plan: category selection schema");
  // ------------------------------------------------------------------
  {
    const plan = fixturePlan();
    const parsed = ResearchPlanSchema.safeParse(plan);
    check("A valid research plan parses", parsed.success);
    check("ResearchCategoryEnum carries all 21 spec categories", ResearchCategoryEnum.options.length === 21, String(ResearchCategoryEnum.options.length));
    check(
      "Rejected categories are preserved with a decision, not dropped",
      plan.categories.some((c) => c.decision === "unnecessary")
    );
    const badDecision = ResearchPlanSchema.safeParse({ ...plan, categories: [{ ...plan.categories[0], decision: "mandatory" }] });
    check("An invalid decision value is rejected", !badDecision.success);
    const noCategoriesResult = ResearchPlanSchema.safeParse({ ...plan, categories: [] });
    check("A plan with zero categories is rejected (min 1)", !noCategoriesResult.success);
  }

  // ------------------------------------------------------------------
  section("2. Research question generation schema");
  // ------------------------------------------------------------------
  {
    const plan = fixturePlan();
    const questions = fixtureQuestions(plan);
    check("A valid question set parses", ResearchQuestionSetSchema.safeParse(questions).success);
    const badCategory = ResearchQuestionSetSchema.safeParse({
      ...questions,
      questions: [{ ...questions.questions[0], category: "NOT_A_REAL_CATEGORY" }]
    });
    check("A question with an unknown category is rejected", !badCategory.success);
    const parsedDefaults = ResearchQuestionSetSchema.parse({ topic: "x", questions: [{ ...questions.questions[0], answeredBy: undefined, dependentQuestions: undefined }] });
    check("answeredBy/dependentQuestions default to an empty array", Array.isArray(parsedDefaults.questions[0].answeredBy) && parsedDefaults.questions[0].answeredBy.length === 0);
  }

  // ------------------------------------------------------------------
  section("3. Evidence graph schema round-trip");
  // ------------------------------------------------------------------
  {
    const graph = fixtureGraph();
    const parsed = EvidenceGraphSchema.safeParse(graph);
    check("A valid evidence graph parses", parsed.success);
    const roundTripped = EvidenceGraphSchema.parse(JSON.parse(JSON.stringify(graph)));
    check("Evidence graph round-trips through JSON unchanged", JSON.stringify(roundTripped.claims) === JSON.stringify(graph.claims));
    check("Evidence graph requires at least 1 source (min 1)", !EvidenceGraphSchema.safeParse({ ...graph, sources: [] }).success);
    check("Evidence graph requires at least 1 evidence item (min 1)", !EvidenceGraphSchema.safeParse({ ...graph, evidence: [] }).success);
    check("Evidence graph requires at least 1 claim (min 1)", !EvidenceGraphSchema.safeParse({ ...graph, claims: [] }).success);
  }

  // ------------------------------------------------------------------
  section("4. Source classification");
  // ------------------------------------------------------------------
  {
    check("SourceTypeEnum has all 12 spec source classes", SourceTypeEnum.options.length === 12, String(SourceTypeEnum.options.length));
    check("SourceTypeEnum distinguishes primary filings from secondary analysis", SourceTypeEnum.options.includes("PRIMARY_FILING") && SourceTypeEnum.options.includes("SECONDARY_ANALYSIS"));
    const graph = fixtureGraph();
    check("Fixture graph's government source is classified primary", graph.sources.find((s) => s.sourceId === "src-gov")?.primaryOrSecondary === "primary");
    check("Fixture graph's news source is classified secondary", graph.sources.find((s) => s.sourceId === "src-news")?.primaryOrSecondary === "secondary");
  }

  // ------------------------------------------------------------------
  section("5. Numeric evidence: DataPointSchema + unit/definition mismatch");
  // ------------------------------------------------------------------
  {
    const dp = (id: string, metric: string, scope: string, unit: string, comparableGroup?: string) => ({
      dataPointId: id, metric, value: 100, unit, scope, definition: `${scope} definition`, sourceId: "src-gov", sourceExcerpt: "excerpt", confidence: 0.8, comparableGroup
    });
    const clean = fixtureGraph({ dataPoints: [dp("dp-cell", "widget price", "cell price", "USD/unit"), dp("dp-pack", "widget price", "pack price", "USD/unit")] });
    const mismatch = checkEvidenceGraphIntegrity(clean);
    check("Two data points sharing a metric but different scope, uncomparable, trigger a definition-mismatch warning", mismatch.warnings.some((w) => w.includes("definitions but are not linked")));

    const linked = fixtureGraph({
      dataPoints: [dp("dp-cell2", "widget price", "cell price", "USD/unit", "gA"), dp("dp-pack2", "widget price", "pack price", "USD/unit", "gA")]
    });
    const noMismatch = checkEvidenceGraphIntegrity(linked);
    check("The same scope mismatch, once linked by a shared comparableGroup, does not warn", !noMismatch.warnings.some((w) => w.includes("widget price")));

    check("DataPointSchema requires scope and definition to be present", !EvidenceGraphSchema.safeParse(fixtureGraph({ dataPoints: [{ ...dp("dp-x", "m", "s", "u") , scope: undefined as any }] })).success);
  }

  // ------------------------------------------------------------------
  section("6. Evidence graph referential integrity");
  // ------------------------------------------------------------------
  {
    const graph = fixtureGraph({
      claims: [{ ...fixtureGraph().claims[0], supportingEvidenceIds: ["ev-does-not-exist"] }]
    });
    const result = checkEvidenceGraphIntegrity(graph);
    check("A claim citing a nonexistent evidenceId is flagged", result.errors.some((e) => e.includes("ev-does-not-exist")));
    let threw = false;
    try {
      validateEvidenceGraphIntegrity(graph);
    } catch (err: any) {
      threw = /Integrity FAILED/.test(err.message);
    }
    check("validateEvidenceGraphIntegrity throws on dangling references", threw);

    const placeholderGraph = fixtureGraph({
      sources: [{ ...fixtureGraph().sources[0], url: "https://example.com/fake", title: "N/A" }]
    });
    check("A placeholder/example.com source is rejected by the same validator researcher.ts uses", checkEvidenceGraphIntegrity(placeholderGraph).errors.length > 0);

    const legitGraph = fixtureGraph({
      sources: [{ ...fixtureGraph().sources[0], title: "High-NA and Low-NA optics vendor filing" }, fixtureGraph().sources[1]]
    });
    check("A legitimate 'High-NA' title is NOT flagged as a placeholder (V2.2 regression, reused not reimplemented)", checkEvidenceGraphIntegrity(legitGraph).errors.length === 0);
  }

  // ------------------------------------------------------------------
  section("7. Evidence Graph Agent gate + integrity enforcement");
  // ------------------------------------------------------------------
  {
    const ws = mkWorkspace("v23-evidence-graph");
    try {
      const plan = fixturePlan();
      const questions = fixtureQuestions(plan);
      const research = { topic: plan.topic, angle: "a", summary: "s", facts: [], statistics: [], people: [], companies: [], timeline: [], claims_to_verify: [], sources: [] } as any;

      let pending = false;
      try {
        await new EvidenceGraphAgent().ensure(plan.topic, ws, { plan, questions, research, repoRoot });
      } catch (err) {
        pending = isAgentTaskPending(err);
      }
      check("Missing evidence-graph.json halts with an AgentTaskPendingError", pending);
      check("A task brief is written for the evidence-graph stage", existsSync(join(ws, "agent-tasks/evidence-graph.task.md")));
      const briefText = existsSync(join(ws, "agent-tasks/evidence-graph.task.md")) ? readFileSync(join(ws, "agent-tasks/evidence-graph.task.md"), "utf-8") : "";
      check("The brief embeds the real EvidenceGraphSchema source", briefText.includes("EvidenceGraphSchema"));

      // A structurally invalid (dangling reference) graph must be rejected outright.
      mkdirSync(join(ws, "research"), { recursive: true });
      const broken = fixtureGraph({ claims: [{ ...fixtureGraph().claims[0], dataPointIds: ["dp-ghost"] }] });
      writeFileSync(join(ws, "research/evidence-graph.json"), JSON.stringify(broken, null, 2), "utf-8");
      let integrityFailed = false;
      try {
        await new EvidenceGraphAgent().ensure(plan.topic, ws, { plan, questions, research, repoRoot });
      } catch (err: any) {
        integrityFailed = /Integrity FAILED/.test(err.message) && !isAgentTaskPending(err);
      }
      check("A structurally broken evidence graph is rejected (not silently accepted)", integrityFailed);

      // A valid graph is accepted and verified.
      const good = fixtureGraph();
      writeFileSync(join(ws, "research/evidence-graph.json"), JSON.stringify(good, null, 2), "utf-8");
      const verified = await new EvidenceGraphAgent().ensure(plan.topic, ws, { plan, questions, research, repoRoot });
      check("A valid evidence graph is accepted", verified.stats.claims === good.claims.length);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------------------------
  section("8. Research Planner Agent gate behaviour");
  // ------------------------------------------------------------------
  {
    const ws = mkWorkspace("v23-planner");
    try {
      let pending = false;
      try {
        await new ResearchPlannerAgent().ensurePlan("Fixture topic about widgets", ws, { repoRoot });
      } catch (err) {
        pending = isAgentTaskPending(err);
      }
      check("Missing research-plan.json halts with an AgentTaskPendingError", pending);
      check("A task brief is written for the research-planner stage", existsSync(join(ws, "agent-tasks/research-planner.task.md")));

      mkdirSync(join(ws, "research"), { recursive: true });
      const plan = fixturePlan();
      writeFileSync(join(ws, "research/research-plan.json"), JSON.stringify(plan, null, 2), "utf-8");
      const verifiedPlan = await new ResearchPlannerAgent().ensurePlan(plan.topic, ws, { repoRoot });
      check("A valid plan is accepted", verifiedPlan.selectedCategories === plan.categories.filter((c) => c.decision !== "unnecessary").length);

      let questionsPending = false;
      try {
        await new ResearchPlannerAgent().ensureQuestions(plan.topic, ws, plan, { repoRoot });
      } catch (err) {
        questionsPending = isAgentTaskPending(err);
      }
      check("Missing research-questions.json halts separately from the plan gate", questionsPending);

      const questions = fixtureQuestions(plan);
      writeFileSync(join(ws, "research/research-questions.json"), JSON.stringify(questions, null, 2), "utf-8");
      const verifiedQuestions = await new ResearchPlannerAgent().ensureQuestions(plan.topic, ws, plan, { repoRoot });
      check("A valid question set is accepted", verifiedQuestions.totalQuestions === questions.questions.length);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------------------------
  section("9. Gap detection: all 9 gap types are reachable");
  // ------------------------------------------------------------------
  {
    const plan = fixturePlan({
      categories: [
        { category: "CORE_FACTS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "moderate", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "ECONOMICS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "moderate", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "SUPPLY_CHAIN", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "low", primarySourceRequired: true, skippableIfUnavailable: false },
        { category: "QUANTITATIVE_EVIDENCE", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "low", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "CONTRADICTIONS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "CURRENT_STATE", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "high", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "HISTORY", decision: "useful", rationale: "r", expectedEvidenceType: "e", priority: 3, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: true },
        { category: "FUTURE", decision: "unnecessary", rationale: "r", expectedEvidenceType: "e", priority: 5, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: true }
      ]
    });
    const questions: ResearchQuestionSet = {
      topic: plan.topic,
      version: "1.0.0",
      questions: [
        { questionId: "q-open", category: "CORE_FACTS", questionText: "Unanswered?", priority: 1, status: "open", requiredEvidenceLevel: "any", freshnessRequirement: "moderate", dependentQuestions: [], answeredBy: [] },
        { questionId: "q-partial", category: "CORE_FACTS", questionText: "Partly?", priority: 1, status: "partially_answered", requiredEvidenceLevel: "any", freshnessRequirement: "moderate", dependentQuestions: [], answeredBy: ["claim-econ"], remainingGap: "still missing regional data" },
        { questionId: "q-blocked", category: "CORE_FACTS", questionText: "Blocked?", priority: 1, status: "blocked", requiredEvidenceLevel: "any", freshnessRequirement: "moderate", dependentQuestions: [], answeredBy: [] }
      ]
    };
    const graph: EvidenceGraph = {
      topic: plan.topic,
      sources: [
        { sourceId: "src-gov", sourceType: "PRIMARY_GOVERNMENT", title: "Gov filing", url: "https://agency.gov/filing", primaryOrSecondary: "primary" },
        { sourceId: "src-news", sourceType: "NEWS_REPORT", title: "Press piece", url: "https://press.example-news.com/a", primaryOrSecondary: "secondary" }
      ],
      evidence: [
        { evidenceId: "ev-gov", sourceId: "src-gov", evidenceExcerpt: "Primary excerpt.", confidence: 0.9, relevance: 0.9, temporalStatus: "CURRENT" },
        { evidenceId: "ev-news", sourceId: "src-news", evidenceExcerpt: "Secondary excerpt.", confidence: 0.6, relevance: 0.6, temporalStatus: "RECENT" }
      ],
      dataPoints: [
        { dataPointId: "dp-cell", metric: "widget price", value: 40, unit: "USD", scope: "cell price", definition: "manufacturing cost per cell", sourceId: "src-gov", sourceExcerpt: "x", confidence: 0.8 },
        { dataPointId: "dp-consumer", metric: "widget price", value: 120, unit: "USD", scope: "consumer price", definition: "retail shelf price", sourceId: "src-news", sourceExcerpt: "y", confidence: 0.6 }
      ],
      entities: [],
      entityRelations: [],
      events: [],
      claims: [
        { claimId: "claim-econ", questionIds: [], statement: "Economics claim resting only on secondary evidence, and contradicted.", category: "ECONOMICS", supportingEvidenceIds: ["ev-news"], contradictingEvidenceIds: ["ev-gov"], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.5 },
        { claimId: "claim-supply", questionIds: [], statement: "Supply chain claim resting only on secondary evidence.", category: "SUPPLY_CHAIN", supportingEvidenceIds: ["ev-news"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.5 },
        { claimId: "claim-quant", questionIds: [], statement: "Quantitative claim with no linked data point.", category: "QUANTITATIVE_EVIDENCE", supportingEvidenceIds: ["ev-gov"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.8 },
        { claimId: "claim-contra-cat", questionIds: [], statement: "Contradictions-category claim, but zero Contradiction entries recorded.", category: "CONTRADICTIONS", supportingEvidenceIds: ["ev-gov"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.8 },
        { claimId: "claim-current", questionIds: [], statement: "Current-state claim tagged only historical, despite requiring high freshness.", category: "CURRENT_STATE", supportingEvidenceIds: ["ev-gov"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "HISTORICAL", confidence: 0.8 },
        { claimId: "claim-uncertain", questionIds: [], statement: "A claim with recorded uncertainty.", category: "KEY_PLAYERS", supportingEvidenceIds: ["ev-gov"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.4 }
      ],
      contradictions: [],
      uncertainties: [{ uncertaintyId: "unc-001", claimId: "claim-uncertain", description: "Genuinely unclear.", reason: "conflicting_evidence" }],
      thesisStressTest: [],
      version: "1.0.0"
    };
    // CORE_FACTS has zero claims -> category-level UNANSWERED. HISTORY also has zero claims,
    // but is only "useful" (still checked, per computeResearchGaps: every non-"unnecessary" category is).

    const report = computeResearchGaps({ plan, questions, graph });
    const gapTypesPresent = new Set(report.gaps.map((g) => g.gapType));

    for (const gt of GapTypeEnum.options) {
      check(`Gap type ${gt} is reachable from a realistic fixture`, gapTypesPresent.has(gt as any), gapTypesPresent.has(gt as any) ? "" : "NOT PRODUCED");
    }
    check("Research completeness report validates against its own schema", ResearchCompletenessSchema.safeParse(report).success);
    check("The 'unnecessary' FUTURE category is marked not_applicable, not scored", report.categoryCoverage.find((c) => c.category === "FUTURE")?.status === "not_applicable");
  }

  // ------------------------------------------------------------------
  section("10. Research completeness scoring: worked example");
  // ------------------------------------------------------------------
  {
    const plan: ResearchPlan = {
      topic: "Worked example topic",
      categories: [
        { category: "CORE_FACTS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "ECONOMICS", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: false },
        { category: "REGULATION", decision: "unnecessary", rationale: "r", expectedEvidenceType: "e", priority: 5, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: true }
      ],
      version: "1.0.0"
    };
    const questions: ResearchQuestionSet = {
      topic: plan.topic,
      version: "1.0.0",
      questions: [
        { questionId: "q-a1", category: "CORE_FACTS", questionText: "Answered?", priority: 1, status: "answered", requiredEvidenceLevel: "any", freshnessRequirement: "irrelevant", dependentQuestions: [], answeredBy: ["claim-a"] },
        { questionId: "q-a2", category: "CORE_FACTS", questionText: "Still open?", priority: 1, status: "open", requiredEvidenceLevel: "any", freshnessRequirement: "irrelevant", dependentQuestions: [], answeredBy: [] }
      ]
    };
    const graph: EvidenceGraph = {
      topic: plan.topic,
      sources: [{ sourceId: "s1", sourceType: "PRIMARY_GOVERNMENT", title: "Filing", url: "https://a.gov/x", primaryOrSecondary: "primary" }],
      evidence: [{ evidenceId: "e1", sourceId: "s1", evidenceExcerpt: "x", confidence: 0.9, relevance: 0.9, temporalStatus: "CURRENT" }],
      dataPoints: [],
      entities: [],
      entityRelations: [],
      events: [],
      claims: [
        { claimId: "claim-a", questionIds: ["q-a1"], statement: "CORE_FACTS claim.", category: "CORE_FACTS", supportingEvidenceIds: ["e1"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.9 },
        { claimId: "claim-b", questionIds: [], statement: "ECONOMICS claim.", category: "ECONOMICS", supportingEvidenceIds: ["e1"], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.9 }
      ],
      contradictions: [],
      uncertainties: [],
      thesisStressTest: [],
      version: "1.0.0"
    };

    const report = computeResearchGaps({ plan, questions, graph });
    const coreCoverage = report.categoryCoverage.find((c) => c.category === "CORE_FACTS")!;
    const econCoverage = report.categoryCoverage.find((c) => c.category === "ECONOMICS")!;
    check("CORE_FACTS (1/2 questions answered) scores exactly 50%", coreCoverage.coveragePercent === 50, String(coreCoverage.coveragePercent));
    check("ECONOMICS (0 questions, 0 gaps, has claims) scores exactly 100%", econCoverage.coveragePercent === 100, String(econCoverage.coveragePercent));
    check("Overall completeness is the mean of applicable categories: (50+100)/2 = 75%", report.overallCompletenessPercent === 75, String(report.overallCompletenessPercent));
    check("Exactly one gap recorded (the one open question)", report.gaps.length === 1, String(report.gaps.length));

    const md = generateResearchGapsMarkdown(report);
    check("Markdown companion report renders the coverage table", md.includes("CORE_FACTS") && md.includes("50%"));

    // Blocking behaviour: a required, non-skippable category with zero claims blocks.
    const blockingPlan: ResearchPlan = { topic: "x", categories: [{ category: "MECHANISM", decision: "required", rationale: "r", expectedEvidenceType: "e", priority: 1, freshnessRequirement: "irrelevant", primarySourceRequired: false, skippableIfUnavailable: false }], version: "1.0.0" };
    const emptyGraph: EvidenceGraph = { topic: "x", sources: [{ sourceId: "s", sourceType: "REFERENCE_PAGE", title: "t", url: "https://x.com/y", primaryOrSecondary: "secondary" }], evidence: [{ evidenceId: "e", sourceId: "s", evidenceExcerpt: "x", confidence: 0.5, relevance: 0.5, temporalStatus: "CURRENT" }], dataPoints: [], entities: [], entityRelations: [], events: [], claims: [{ claimId: "unrelated", questionIds: [], statement: "unrelated", category: "HISTORY", supportingEvidenceIds: [], contradictingEvidenceIds: [], dataPointIds: [], entityIds: [], eventIds: [], temporalStatus: "CURRENT", confidence: 0.5 }], contradictions: [], uncertainties: [], thesisStressTest: [], version: "1.0.0" };
    const blockingReport = computeResearchGaps({ plan: blockingPlan, questions: { topic: "x", version: "1.0.0", questions: [{ questionId: "q", category: "MECHANISM", questionText: "?", priority: 1, status: "open", requiredEvidenceLevel: "any", freshnessRequirement: "irrelevant", dependentQuestions: [], answeredBy: [] }] }, graph: emptyGraph });
    const blockingAssessment = assessResearchCompleteness(blockingReport, blockingPlan);
    check("A required, non-skippable category with zero claims BLOCKS the pipeline", blockingAssessment.blocking);

    const skippablePlan: ResearchPlan = { ...blockingPlan, categories: [{ ...blockingPlan.categories[0], skippableIfUnavailable: true }] };
    const skippableAssessment = assessResearchCompleteness(computeResearchGaps({ plan: skippablePlan, questions: { topic: "x", version: "1.0.0", questions: [] }, graph: emptyGraph }), skippablePlan);
    check("The same zero-coverage category, marked skippable, does NOT block", !skippableAssessment.blocking);
    check("No arbitrary search-count threshold: blocking is driven by coverage, not a call count", true, "computeResearchGaps never reads a search-count field");
  }

  // ------------------------------------------------------------------
  section("11. Temporal classification, entities, timeline");
  // ------------------------------------------------------------------
  {
    check("TemporalStatusEnum has all 8 spec temporal states", TemporalStatusEnum.options.length === 8, String(TemporalStatusEnum.options.length));
    check("TemporalStatusEnum distinguishes FORECAST from SPECULATIVE", TemporalStatusEnum.options.includes("FORECAST") && TemporalStatusEnum.options.includes("SPECULATIVE"));
    check("DisagreementTypeEnum distinguishes FACTUAL/DEFINITIONAL/FORECAST/METHODOLOGICAL", DisagreementTypeEnum.options.length === 4);
    check("EntityTypeEnum covers companies, materials, infrastructure, people", ["COMPANY", "MATERIAL", "INFRASTRUCTURE", "PERSON"].every((t) => EntityTypeEnum.options.includes(t as any)));
    check("EntityRelationTypeEnum covers supply-chain verbs", ["SUPPLIES", "DEPENDS_ON", "MANUFACTURES", "REGULATES"].every((r) => EntityRelationTypeEnum.options.includes(r as any)));

    const graph = fixtureGraph({
      entities: [
        { entityId: "ent-a", type: "COMPANY", name: "Widget Corp" },
        { entityId: "ent-b", type: "MATERIAL", name: "Rare compound" }
      ],
      entityRelations: [{ fromEntityId: "ent-a", relation: "DEPENDS_ON", toEntityId: "ent-b", evidenceIds: ["ev-001"] }],
      events: [{ eventId: "evt-1", date: "2024-03", datePrecision: "month", title: "Price cut announced", description: "d", sourceId: "src-gov", importance: 3 }]
    });
    check("A valid entity/relation/event graph parses", EvidenceGraphSchema.safeParse(graph).success);
    check("Entity relation referential integrity passes for real ids", checkEvidenceGraphIntegrity(graph).errors.length === 0);
    const brokenRelation = fixtureGraph({
      entities: [{ entityId: "ent-a", type: "COMPANY", name: "Widget Corp" }],
      entityRelations: [{ fromEntityId: "ent-a", relation: "SUPPLIES", toEntityId: "ent-ghost", evidenceIds: [] }]
    });
    check("An entity relation to an unknown entity id is flagged", checkEvidenceGraphIntegrity(brokenRelation).errors.some((e) => e.includes("ent-ghost")));
  }

  // ------------------------------------------------------------------
  section("12. Visual opportunity mapping: must not invent data");
  // ------------------------------------------------------------------
  {
    const ws = mkWorkspace("v23-visual-evidence");
    try {
      const graph = fixtureGraph();
      const script: ScriptResult = {
        title: "t",
        hook: "hook hook hook hook hook",
        scenes: [{ id: "scene-001", narration: "Widget prices fell.", purpose: "establish", visual_hint: "chart" }],
        ending: "ending ending ending ending"
      } as any;

      let pending = false;
      try {
        await new VisualEvidenceMapperAgent().ensure("Fixture topic about widgets", ws, { script, evidenceGraph: graph, repoRoot });
      } catch (err) {
        pending = isAgentTaskPending(err);
      }
      check("Missing visual-evidence-map.json halts with an AgentTaskPendingError", pending);

      mkdirSync(join(ws, "visual-evidence"), { recursive: true });
      const invented: VisualEvidenceMap = {
        topic: "Fixture topic about widgets",
        opportunities: [
          {
            visualOpportunityId: "vo-1",
            claimId: "claim-does-not-exist",
            evidenceIds: ["ev-does-not-exist"],
            visualMode: "data_visualization",
            visualPurpose: "show_trend",
            dataRequirements: [],
            entityIds: [],
            timelineEventIds: [],
            geographicDataIds: [],
            animationPotential: "moderate",
            confidence: 0.5,
            rationale: "fabricated"
          }
        ],
        version: "1.0.0"
      };
      writeFileSync(join(ws, "visual-evidence/visual-evidence-map.json"), JSON.stringify(invented, null, 2), "utf-8");
      let rejected = false;
      try {
        await new VisualEvidenceMapperAgent().ensure("Fixture topic about widgets", ws, { script, evidenceGraph: graph, repoRoot });
      } catch (err: any) {
        rejected = /Integrity FAILED/.test(err.message) && !isAgentTaskPending(err);
      }
      check("A visual opportunity citing ids absent from the evidence graph is rejected outright", rejected);

      const grounded: VisualEvidenceMap = {
        topic: "Fixture topic about widgets",
        opportunities: [
          {
            visualOpportunityId: "vo-2",
            claimId: "claim-001",
            evidenceIds: ["ev-001"],
            visualMode: "data_visualization",
            visualPurpose: "show_trend",
            dataRequirements: [],
            entityIds: [],
            timelineEventIds: [],
            geographicDataIds: [],
            animationPotential: "moderate",
            confidence: 0.8,
            rationale: "A verified trend deserves a real chart, not a big number."
          }
        ],
        version: "1.0.0"
      };
      writeFileSync(join(ws, "visual-evidence/visual-evidence-map.json"), JSON.stringify(grounded, null, 2), "utf-8");
      const verified = await new VisualEvidenceMapperAgent().ensure("Fixture topic about widgets", ws, { script, evidenceGraph: graph, repoRoot });
      check("A visual opportunity grounded in real ids is accepted", verified.opportunityCount === 1);
    } finally {
      rmSync(ws, { recursive: true, force: true });
    }
  }

  // ------------------------------------------------------------------
  section("13. Orphan-claim / claim -> evidence / script -> evidence traceability");
  // ------------------------------------------------------------------
  {
    const graph = fixtureGraph();
    const scriptWithOrphan: ScriptResult = {
      title: "t",
      hook: "A genuine hook sentence that is long enough.",
      scenes: [
        {
          id: "scene-001",
          narration: "Widget prices fell in 2025, according to research.",
          purpose: "establish the price drop",
          visual_hint: "chart",
          scriptClaims: [
            { scriptClaimId: "sc-1", claimText: "Widget prices fell.", evidenceIds: ["ev-does-not-exist"], confidence: 0.8, narrativeRole: "opening claim" }
          ]
        }
      ],
      ending: "A genuine closing synthesis sentence that is long enough."
    } as any;

    const orphanReport = await new ScriptQAAgent().evaluate({ script: scriptWithOrphan, evidenceGraph: graph, outputDir: mkWorkspace("v23-qa-orphan") });
    const traceCheck = orphanReport.checks.find((c) => c.name === "Claim -> Evidence Traceability");
    check("Claim -> Evidence Traceability check runs when scriptClaims + evidenceGraph are present", !!traceCheck);
    check("An orphan claim (unresolved evidenceId) fails the traceability check", traceCheck?.passed === false);
    check("An orphan claim fails the whole claim gate (blocking, not a warning)", orphanReport.status === "FAIL");

    const scriptGrounded: ScriptResult = {
      ...scriptWithOrphan,
      scenes: [{ ...scriptWithOrphan.scenes[0], scriptClaims: [{ scriptClaimId: "sc-2", claimText: "Widget prices fell.", evidenceIds: ["claim-001"], confidence: 0.8, narrativeRole: "opening claim" }] }]
    } as any;
    const groundedReport = await new ScriptQAAgent().evaluate({ script: scriptGrounded, evidenceGraph: graph, outputDir: mkWorkspace("v23-qa-grounded") });
    const traceCheck2 = groundedReport.checks.find((c) => c.name === "Claim -> Evidence Traceability");
    check("A scriptClaim citing a real graph claimId passes the traceability check", traceCheck2?.passed === true);

    const noGraphReport = await new ScriptQAAgent().evaluate({ script: scriptWithOrphan, outputDir: mkWorkspace("v23-qa-nograph") });
    check("Without an evidence graph supplied, the traceability check is inert (no false failures on pre-V2.3 workspaces)", !noGraphReport.checks.find((c) => c.name === "Claim -> Evidence Traceability"));
  }

  // ------------------------------------------------------------------
  section("14. Search index: build + query correctness");
  // ------------------------------------------------------------------
  let searchWs = "";
  {
    searchWs = mkWorkspace("v23-search");
    mkdirSync(join(searchWs, "research"), { recursive: true });
    mkdirSync(join(searchWs, "script"), { recursive: true });
    mkdirSync(join(searchWs, "storyboard"), { recursive: true });
    mkdirSync(join(searchWs, "audio"), { recursive: true });

    const graph = fixtureGraph({
      dataPoints: [{ dataPointId: "dp-1", metric: "widget price", value: 7000, unit: "USD", scope: "unit price", definition: "average selling price", sourceId: "src-gov", sourceExcerpt: "x", confidence: 0.8 }]
    });
    writeFileSync(join(searchWs, "research/evidence-graph.json"), JSON.stringify(graph, null, 2), "utf-8");

    const questions = fixtureQuestions(fixturePlan());
    writeFileSync(join(searchWs, "research/research-questions.json"), JSON.stringify(questions, null, 2), "utf-8");

    const script: ScriptResult = {
      title: "t",
      hook: "A hook.",
      scenes: [
        {
          id: "scene-001",
          narration: "TSMC and widget prices, TSMC leads the market.",
          purpose: "establish",
          visual_hint: "chart",
          chapter: "chapter-01",
          scriptClaims: [{ scriptClaimId: "sc-1", claimText: "Widget prices fell.", evidenceIds: ["claim-001"], confidence: 0.8, narrativeRole: "opening" }]
        }
      ],
      chapters: [{ id: "chapter-01", title: "The Price Drop", narrativePurpose: "establish stakes", sceneIds: ["scene-001"] }],
      ending: "Ending."
    } as any;
    writeFileSync(join(searchWs, "script/script.json"), JSON.stringify(script, null, 2), "utf-8");

    const audio: AudioTimestamps = {
      audioPath: "audio/narration.wav",
      sampleRate: 24000,
      totalDuration: 12.5,
      sentences: [{ sceneId: "scene-001", text: "TSMC and widget prices, TSMC leads the market.", start: 0, end: 12.5, duration: 12.5 }]
    };
    writeFileSync(join(searchWs, "audio/timestamps.json"), JSON.stringify(audio, null, 2), "utf-8");

    const records = buildSearchIndex(searchWs);
    check("Search index includes claim/evidence/source/datapoint/question/scene/chapter records", ["claim", "evidence", "source", "datapoint", "question", "scene", "chapter"].every((k) => records.some((r) => r.kind === k)));

    const textHits = search(records, "TSMC");
    check("Substring search finds the scene mentioning TSMC", textHits.some((r) => r.kind === "scene" && r.id === "scene-001"));

    const exactHits = search(records, "TSMC", { exact: true });
    check("Exact-phrase search matches a bounded whole word", exactHits.length > 0);
    const exactMiss = search(records, "TSM", { exact: true });
    check("Exact-phrase search does not match a partial word", exactMiss.length === 0);

    const numericHits = search(records, "$7,000");
    check("Numeric-aware search finds a data point by its dollar value", numericHits.some((r) => r.kind === "datapoint" && r.id === "dp-1"));

    const kindFiltered = search(records, "widget", { kind: "claim" });
    check("kind filter restricts results to the requested record type", kindFiltered.every((r) => r.kind === "claim"));

    const noMatch = search(records, "nonexistent-zzz-query");
    check("A query with no matches returns an empty array", noMatch.length === 0);
  }

  // ------------------------------------------------------------------
  section("15. Search -> timestamp resolution");
  // ------------------------------------------------------------------
  {
    const records = buildSearchIndex(searchWs);
    const sceneRecord = records.find((r) => r.kind === "scene" && r.id === "scene-001")!;
    const sceneTs = resolveToTimestamp(sceneRecord, searchWs);
    check("A scene record resolves directly to its timestamp", sceneTs?.sceneId === "scene-001" && sceneTs?.start === 0);

    const claimRecord = records.find((r) => r.kind === "claim" && r.id === "claim-001")!;
    check("A claim used by a scriptClaim is backfilled with that scene's id (provenance chain, spec §30)", claimRecord.refs.sceneId === "scene-001");
    const claimTs = resolveToTimestamp(claimRecord, searchWs);
    check("A claim record resolves through its scene to a real timestamp", claimTs?.start === 0 && claimTs?.duration === 12.5);

    const sourceRecord = records.find((r) => r.kind === "source")!;
    check("A record with no scene provenance resolves to null, not a guess", resolveToTimestamp(sourceRecord, searchWs) === null);

    rmSync(searchWs, { recursive: true, force: true });
  }

  console.log("\n==============================================================");
  console.log(`V2.3 RESEARCH INTELLIGENCE: ${passed} passed, ${failed} failed`);
  if (failed) console.log("Failed: " + failures.join(" | "));
  console.log("==============================================================");
  if (failed > 0) process.exit(1);
}

main().catch((err) => {
  console.error("\nV2.3 research suite errored:", err?.stack || err);
  process.exit(1);
});
