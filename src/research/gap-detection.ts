import { ResearchPlan } from "../schemas/research-plan.js";
import { ResearchQuestionSet } from "../schemas/research-questions.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { Gap, GapType, CategoryCoverage, CoverageStatus, ResearchCompleteness } from "../schemas/research-gaps.js";
import { checkEvidenceGraphIntegrity } from "./evidence-graph-integrity.js";

/**
 * Deterministic gap detection and completeness scoring (V2.3 spec sections 10, 22, 34).
 *
 * Unlike every reasoning stage, this is pure TypeScript over already-authored artifacts —
 * no agent gate, no fabrication risk. It measures what the Research Planner and Evidence
 * Graph stages produced, the same role `duration-gate.ts` plays for TTS output: a
 * deterministic policy layer over agent-authored content, not a content author itself.
 * Coverage is never a flat search-count threshold (spec §9/§34); it is derived from
 * whether questions were actually answered and whether claims meet the category's own
 * stated requirements (primary source, freshness).
 */
export function computeResearchGaps(params: {
  plan: ResearchPlan;
  questions: ResearchQuestionSet;
  graph: EvidenceGraph;
}): ResearchCompleteness {
  const { plan, questions, graph } = params;
  const gaps: Gap[] = [];
  let gapSeq = 0;
  const nextId = () => `gap-${String(++gapSeq).padStart(3, "0")}`;
  const push = (gapType: GapType, fields: Omit<Gap, "gapId" | "gapType">) => {
    gaps.push({ gapId: nextId(), gapType, ...fields });
  };

  const claimsByCategory = new Map<string, EvidenceGraph["claims"]>();
  for (const c of graph.claims) {
    if (!claimsByCategory.has(c.category)) claimsByCategory.set(c.category, []);
    claimsByCategory.get(c.category)!.push(c);
  }
  const sourceById = new Map(graph.sources.map((s) => [s.sourceId, s]));
  const evidenceById = new Map(graph.evidence.map((e) => [e.evidenceId, e]));
  const uncertainClaimIds = new Set(graph.uncertainties.map((u) => u.claimId));

  const isSupportedByPrimary = (evidenceIds: string[]): boolean =>
    evidenceIds.some((id) => {
      const ev = evidenceById.get(id);
      const src = ev && sourceById.get(ev.sourceId);
      return src?.primaryOrSecondary === "primary";
    });

  // --- Question-level gaps ---
  for (const q of questions.questions) {
    if (q.status === "open" && q.answeredBy.length === 0) {
      push("UNANSWERED", {
        category: q.category,
        questionId: q.questionId,
        description: `Question "${q.questionText}" has no answering claim.`,
        suggestedFollowUp: `Search specifically to answer: ${q.questionText}`
      });
    } else if (q.status === "partially_answered") {
      push("WEAKLY_SUPPORTED", {
        category: q.category,
        questionId: q.questionId,
        description: q.remainingGap ?? `Question "${q.questionText}" is only partially answered.`
      });
    } else if (q.status === "blocked") {
      push("AMBIGUOUS", {
        category: q.category,
        questionId: q.questionId,
        description: q.remainingGap ?? `Question "${q.questionText}" is blocked.`
      });
    }
  }

  // --- Claim-level gaps ---
  for (const claim of graph.claims) {
    if (claim.supportingEvidenceIds.length > 0 && !isSupportedByPrimary(claim.supportingEvidenceIds)) {
      push("SECONDARY_ONLY", {
        category: claim.category,
        claimId: claim.claimId,
        description: `Claim "${claim.statement.slice(0, 80)}" rests only on secondary sources.`
      });
    }
    if (claim.contradictingEvidenceIds.length > 0) {
      push("CONTRADICTED", {
        category: claim.category,
        claimId: claim.claimId,
        description: `Claim "${claim.statement.slice(0, 80)}" has recorded contradicting evidence.`
      });
    }
    if (uncertainClaimIds.has(claim.claimId)) {
      push("AMBIGUOUS", {
        category: claim.category,
        claimId: claim.claimId,
        description: `Claim "${claim.statement.slice(0, 80)}" has recorded uncertainty.`
      });
    }
  }

  // --- Category-level gaps ---
  for (const cat of plan.categories) {
    if (cat.decision === "unnecessary") continue;
    const claims = claimsByCategory.get(cat.category) ?? [];

    if (claims.length === 0) {
      push("UNANSWERED", {
        category: cat.category,
        description: `Category "${cat.category}" (${cat.decision}) has no supporting claims in the evidence graph.`,
        suggestedFollowUp: `Research: ${cat.expectedEvidenceType}`
      });
      continue;
    }

    if (cat.primarySourceRequired) {
      const anyPrimary = claims.some((c) => isSupportedByPrimary(c.supportingEvidenceIds));
      if (!anyPrimary) {
        push("MISSING_PRIMARY_SOURCE", {
          category: cat.category,
          description: `Category "${cat.category}" requires a primary source but none of its claims cite one.`
        });
      }
    }

    if (cat.freshnessRequirement === "high" || cat.freshnessRequirement === "real_time") {
      const anyRecent = claims.some((c) => c.temporalStatus === "CURRENT" || c.temporalStatus === "RECENT");
      if (!anyRecent) {
        push("STALE", {
          category: cat.category,
          description: `Category "${cat.category}" requires ${cat.freshnessRequirement} freshness but no claim is tagged CURRENT/RECENT.`
        });
      }
    }

    if (cat.category === "QUANTITATIVE_EVIDENCE") {
      const linkedDataPoints = claims.reduce((n, c) => n + c.dataPointIds.length, 0);
      if (linkedDataPoints === 0) {
        push("INSUFFICIENT_QUANTITATIVE_EVIDENCE", {
          category: cat.category,
          description: `Category "QUANTITATIVE_EVIDENCE" is selected but no claim links to a dataPoint.`
        });
      }
    }

    if ((cat.category === "CONTRADICTIONS" || cat.category === "COUNTERARGUMENTS") && cat.decision === "required" && graph.contradictions.length === 0) {
      push("WEAKLY_SUPPORTED", {
        category: cat.category,
        description: `Category "${cat.category}" is required but no Contradiction entries were recorded — adversarial search may not have happened.`
      });
    }
  }

  // --- Definition mismatches: reuse the integrity checker's warnings, don't reimplement ---
  const { warnings } = checkEvidenceGraphIntegrity(graph);
  for (const w of warnings) {
    push("DEFINITION_MISMATCH", { description: w });
  }

  // --- Coverage per category ---
  const categoryCoverage: CategoryCoverage[] = plan.categories.map((cat): CategoryCoverage => {
    if (cat.decision === "unnecessary") {
      return { category: cat.category, coveragePercent: 100, status: "not_applicable" as CoverageStatus };
    }
    const claims = claimsByCategory.get(cat.category) ?? [];
    const catQuestions = questions.questions.filter((q) => q.category === cat.category);
    const answeredQuestions = catQuestions.filter((q) => q.status === "answered");
    const gapCountForCategory = gaps.filter((g) => g.category === cat.category).length;

    let coveragePercent: number;
    if (claims.length === 0) coveragePercent = 0;
    else if (catQuestions.length > 0) coveragePercent = Math.round((answeredQuestions.length / catQuestions.length) * 100);
    else coveragePercent = Math.max(0, 100 - gapCountForCategory * 20);

    const status: CoverageStatus = coveragePercent >= 90 ? "complete" : coveragePercent >= 50 ? "partial" : "weak";
    return { category: cat.category, coveragePercent, status };
  });

  const applicable = categoryCoverage.filter((c) => c.status !== "not_applicable");
  const overallCompletenessPercent =
    applicable.length === 0 ? 100 : Math.round(applicable.reduce((s, c) => s + c.coveragePercent, 0) / applicable.length);

  return {
    topic: plan.topic,
    categoryCoverage,
    overallCompletenessPercent,
    gaps,
    generatedAt: new Date().toISOString(),
    version: "1.0.0"
  };
}

export interface CompletenessAssessment {
  blocking: boolean;
  message: string;
}

/**
 * Blocks only on a severe, well-defined condition: a REQUIRED, non-skippable category
 * with literally zero supporting claims. No arbitrary search-count or percentage
 * threshold (spec §9/§34) — everything else is reported, not enforced.
 */
export function assessResearchCompleteness(report: ResearchCompleteness, plan: ResearchPlan): CompletenessAssessment {
  const requiredZero = report.categoryCoverage.filter((c) => {
    const catPlan = plan.categories.find((p) => p.category === c.category);
    return catPlan?.decision === "required" && !catPlan.skippableIfUnavailable && c.coveragePercent === 0;
  });

  if (requiredZero.length > 0) {
    return {
      blocking: true,
      message:
        `Research completeness ${report.overallCompletenessPercent}%. ${requiredZero.length} required, ` +
        `non-skippable categor${requiredZero.length === 1 ? "y has" : "ies have"} zero coverage: ` +
        `${requiredZero.map((c) => c.category).join(", ")}. Revise research/evidence-graph.json to address ` +
        `these before continuing.`
    };
  }

  return {
    blocking: false,
    message: `Research completeness ${report.overallCompletenessPercent}%. ${report.gaps.length} gap(s) recorded (non-blocking).`
  };
}

/** Deterministic companion markdown, same non-gating pattern as research.md/argument.md. */
export function generateResearchGapsMarkdown(report: ResearchCompleteness): string {
  const lines: string[] = [
    `# Research Completeness: ${report.topic}`,
    ``,
    `**Overall completeness:** ${report.overallCompletenessPercent}% | **Gaps:** ${report.gaps.length}`,
    `*Generated at:* ${report.generatedAt}`,
    ``,
    `## Category coverage`,
    `| Category | Coverage | Status |`,
    `|---|---|---|`,
    ...report.categoryCoverage.map((c) => `| ${c.category} | ${c.coveragePercent}% | ${c.status} |`),
    ``,
    `## Remaining gaps`,
    ...report.gaps.map((g) => `- **[${g.gapType}]**${g.category ? ` (${g.category})` : ""} ${g.description}`)
  ];
  return lines.join("\n");
}
