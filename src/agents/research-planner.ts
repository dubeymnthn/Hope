import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { ResearchPlan, ResearchPlanSchema, ResearchCategoryPlan } from "../schemas/research-plan.js";
import { ResearchQuestionSet, ResearchQuestionSetSchema } from "../schemas/research-questions.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface ResearchPlanVerification {
  plan: ResearchPlan;
  artifactHash: string;
  selectedCategories: number;
  rejectedCategories: number;
}

export interface ResearchQuestionVerification {
  questions: ResearchQuestionSet;
  artifactHash: string;
  totalQuestions: number;
}

function topicsMatch(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 3 && !["what", "why", "how", "does", "the", "and", "for", "are", "with", "this", "that", "from"].includes(w));
  const aw = norm(a);
  const bw = norm(b);
  if (aw.length === 0 || bw.length === 0) return a.trim().toLowerCase() === b.trim().toLowerCase();
  return aw.filter((w) => bw.includes(w)).length / Math.min(aw.length, bw.length) >= 0.6;
}

/**
 * Research Planner stage (V2.3 spec sections 2-3).
 *
 * Two sequential gates rather than one multi-artifact gate: the plan must exist before
 * questions can be generated per selected category. Both are Antigravity reasoning
 * artifacts — TypeScript only requests, validates, hashes and checkpoints, exactly like
 * every other gated stage in this codebase (agent-task.ts is untouched).
 */
export class ResearchPlannerAgent {
  public async ensurePlan(
    topic: string,
    outputDir: string = process.cwd(),
    options?: { repoRoot?: string }
  ): Promise<ResearchPlanVerification> {
    const researchDir = join(outputDir, "research");
    const jsonPath = join(researchDir, "research-plan.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });

    if (!existsSync(jsonPath)) {
      mkdirSync(researchDir, { recursive: true });
      this.requestPlan(gate, topic, "research/research-plan.json does not exist yet.");
    }

    let validated: ResearchPlan;
    try {
      validated = ResearchPlanSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    } catch (err: any) {
      this.requestPlan(gate, topic, `Existing research/research-plan.json is invalid and was rejected: ${err.message}`);
    }

    const plan = validated!;
    if (!topicsMatch(plan.topic, topic)) {
      this.requestPlan(
        gate,
        topic,
        `Existing plan addresses "${plan.topic}" but the requested topic is "${topic}".`
      );
    }

    const required = plan.categories.filter((c: ResearchCategoryPlan) => c.decision === "required" || c.decision === "useful").length;
    const rejected = plan.categories.filter((c: ResearchCategoryPlan) => c.decision === "unnecessary").length;

    console.log(`[RESEARCH-PLANNER] Verified research plan for "${plan.topic}"`);
    console.log(`  - Categories considered: ${plan.categories.length}`);
    console.log(`  - Selected (required/useful): ${required}`);
    console.log(`  - Rejected as unnecessary: ${rejected}`);

    return {
      plan,
      artifactHash: hashArtifact(jsonPath),
      selectedCategories: required,
      rejectedCategories: rejected
    };
  }

  public async ensureQuestions(
    topic: string,
    outputDir: string = process.cwd(),
    plan: ResearchPlan,
    options?: { repoRoot?: string }
  ): Promise<ResearchQuestionVerification> {
    const researchDir = join(outputDir, "research");
    const jsonPath = join(researchDir, "research-questions.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options?.repoRoot });

    if (!existsSync(jsonPath)) {
      mkdirSync(researchDir, { recursive: true });
      this.requestQuestions(gate, topic, plan, "research/research-questions.json does not exist yet.");
    }

    let validated: ResearchQuestionSet;
    try {
      validated = ResearchQuestionSetSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    } catch (err: any) {
      this.requestQuestions(
        gate,
        topic,
        plan,
        `Existing research/research-questions.json is invalid and was rejected: ${err.message}`
      );
    }

    const questions = validated!;
    const planCategories = new Set(plan.categories.map((c) => c.category));
    const orphanCategoryQuestions = questions.questions.filter((q) => !planCategories.has(q.category));
    if (orphanCategoryQuestions.length > 0) {
      console.warn(
        `[RESEARCH-PLANNER] ${orphanCategoryQuestions.length} question(s) reference a category not present ` +
          `in research-plan.json: ${[...new Set(orphanCategoryQuestions.map((q) => q.category))].join(", ")}`
      );
    }

    console.log(`[RESEARCH-PLANNER] Verified research questions for "${questions.topic}"`);
    console.log(`  - Questions: ${questions.questions.length}`);
    console.log(`  - Categories covered: ${new Set(questions.questions.map((q) => q.category)).size}`);

    return {
      questions,
      artifactHash: hashArtifact(jsonPath),
      totalQuestions: questions.questions.length
    };
  }

  private requestPlan(gate: AgentTaskGate, topic: string, reason: string): never {
    return gate.request({
      stage: "research-planner",
      title: `Research plan for "${topic}"`,
      reason,
      artifactPath: "research/research-plan.json",
      schemaName: "ResearchPlanSchema",
      schemaFiles: ["src/schemas/research-plan.ts"],
      mission:
        `Before any searching happens, decide what this documentary actually needs to know. ` +
        `You receive only the topic "${topic}" and must reason about which research dimensions ` +
        `genuinely matter for THIS specific topic, not a fixed checklist.\n\n` +
        `Go through every category in the ResearchCategoryEnum and decide: required, useful, ` +
        `optional or unnecessary. A category being "unnecessary" is a real, useful answer — ` +
        `record it with a rationale, do not omit it. Do not mark everything "required"; that is ` +
        `not planning, it is refusing to plan.`,
      context: { topic },
      requirements: [
        "Produce one ResearchCategoryPlan entry for EVERY value in ResearchCategoryEnum, including rejected ones.",
        "Give each category a specific `rationale` referencing this topic, not a generic justification.",
        "Set `expectedEvidenceType` to what kind of evidence would actually answer this category.",
        "Set `priority` (1=highest) reflecting genuine editorial importance to this topic's argument.",
        "Set `freshnessRequirement` honestly: a historical trend category does not need real-time evidence.",
        "Set `primarySourceRequired` only where a primary source genuinely matters for that category.",
        "Set `skippableIfUnavailable` true for categories that would not break the documentary if evidence is thin."
      ],
      prohibitions: [
        "Never mark every category 'required'; that defeats the purpose of planning.",
        "Never omit a category from the output; rejected categories must be recorded, not dropped.",
        "Never write a rationale generic enough to apply to any topic; it must reference this one."
      ],
      inputs: []
    });
  }

  private requestQuestions(gate: AgentTaskGate, topic: string, plan: ResearchPlan, reason: string): never {
    const selected = plan.categories.filter((c) => c.decision !== "unnecessary");

    return gate.request({
      stage: "research-planner-questions",
      title: `Research questions for "${topic}"`,
      reason,
      artifactPath: "research/research-questions.json",
      schemaName: "ResearchQuestionSetSchema",
      schemaFiles: ["src/schemas/research-questions.ts", "src/schemas/research-plan.ts"],
      mission:
        `research-plan.json (attached below) has already selected which categories matter for ` +
        `"${topic}". Turn every selected (non-'unnecessary') category into explicit, answerable ` +
        `research questions — the questions the evidence graph stage must go answer. Questions ` +
        `are what turn "search around the topic" into "know what you're looking for".`,
      context: {
        topic,
        selectedCategories: selected.map((c) => c.category).join(", ")
      },
      requirements: [
        "Generate at least one question for every selected (non-'unnecessary') category.",
        "Phrase each `questionText` as a concrete, answerable question, not a restated category name.",
        "Set `requiredEvidenceLevel` per question based on how load-bearing it is to the thesis.",
        "Set `freshnessRequirement` consistent with the category's own requirement in the plan.",
        "Use `dependentQuestions` where one question genuinely cannot be answered before another.",
        "Leave `status` as 'open' and `answeredBy` empty; those are filled in by the evidence graph stage."
      ],
      prohibitions: [
        "Never generate a question for a category the plan marked 'unnecessary'.",
        "Never write a vague question ('tell me about economics'); it must be specific and answerable.",
        "Never invent an answer here; this stage only asks questions, it does not answer them."
      ],
      inputs: [{ label: "Research plan (selected categories)", path: "research/research-plan.json", inline: true }]
    });
  }
}
