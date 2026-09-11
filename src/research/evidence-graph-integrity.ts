import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { isPlaceholderCitation } from "../agents/researcher.js";

export interface EvidenceGraphIntegrityResult {
  errors: string[];
  warnings: string[];
}

/**
 * Structural integrity checks for evidence-graph.json (V2.3 spec sections 5, 8).
 *
 * Pure function so it is directly unit-testable (test/test-v23-research.ts) without
 * needing to catch a thrown error. `src/agents/evidence-graph.ts` calls this after schema
 * parse and turns any `errors` into a hard `throw`, the same "structural correctness
 * enforced outside zod" pattern already used by visual-director.ts's chart-data-integrity
 * check and researcher.ts's source-count check — a production stop, not a re-request gate,
 * because the shape is right but the content references something that does not exist.
 */
export function checkEvidenceGraphIntegrity(graph: EvidenceGraph): EvidenceGraphIntegrityResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  const sourceIds = new Set(graph.sources.map((s) => s.sourceId));
  const evidenceIds = new Set(graph.evidence.map((e) => e.evidenceId));
  const dataPointIds = new Set(graph.dataPoints.map((d) => d.dataPointId));
  const entityIds = new Set(graph.entities.map((e) => e.entityId));
  const eventIds = new Set(graph.events.map((e) => e.eventId));
  const claimIds = new Set(graph.claims.map((c) => c.claimId));

  const missing = (ids: string[], pool: Set<string>, kind: string, from: string) => {
    for (const id of ids) {
      if (!pool.has(id)) errors.push(`${from} references unknown ${kind} id "${id}"`);
    }
  };

  // --- Referential integrity: every *Id must resolve within the same graph ---
  for (const e of graph.evidence) {
    if (!sourceIds.has(e.sourceId)) errors.push(`evidence "${e.evidenceId}" references unknown source id "${e.sourceId}"`);
  }
  for (const d of graph.dataPoints) {
    if (!sourceIds.has(d.sourceId)) errors.push(`dataPoint "${d.dataPointId}" references unknown source id "${d.sourceId}"`);
  }
  for (const ev of graph.events) {
    if (!sourceIds.has(ev.sourceId)) errors.push(`event "${ev.eventId}" references unknown source id "${ev.sourceId}"`);
  }
  for (const rel of graph.entityRelations) {
    if (!entityIds.has(rel.fromEntityId)) errors.push(`entityRelation references unknown entity id "${rel.fromEntityId}"`);
    if (!entityIds.has(rel.toEntityId)) errors.push(`entityRelation references unknown entity id "${rel.toEntityId}"`);
    missing(rel.evidenceIds, evidenceIds, "evidence", `entityRelation ${rel.fromEntityId}->${rel.toEntityId}`);
  }
  for (const c of graph.claims) {
    missing(c.supportingEvidenceIds, evidenceIds, "evidence", `claim "${c.claimId}"`);
    missing(c.contradictingEvidenceIds, evidenceIds, "evidence", `claim "${c.claimId}"`);
    missing(c.dataPointIds, dataPointIds, "dataPoint", `claim "${c.claimId}"`);
    missing(c.entityIds, entityIds, "entity", `claim "${c.claimId}"`);
    missing(c.eventIds, eventIds, "event", `claim "${c.claimId}"`);
  }
  for (const ct of graph.contradictions) {
    if (!claimIds.has(ct.claimId)) errors.push(`contradiction "${ct.contradictionId}" references unknown claim id "${ct.claimId}"`);
    missing(ct.supportingEvidenceIds, evidenceIds, "evidence", `contradiction "${ct.contradictionId}"`);
    missing(ct.contradictingEvidenceIds, evidenceIds, "evidence", `contradiction "${ct.contradictionId}"`);
  }
  for (const u of graph.uncertainties) {
    if (!claimIds.has(u.claimId)) errors.push(`uncertainty "${u.uncertaintyId}" references unknown claim id "${u.claimId}"`);
  }
  for (const t of graph.thesisStressTest) {
    missing(t.supportingClaimIds, claimIds, "claim", `thesis "${t.thesisId}"`);
    missing(t.contradictingClaimIds, claimIds, "claim", `thesis "${t.thesisId}"`);
  }

  // --- Citation placeholder check (spec V2.2 §8, reused rather than reimplemented) ---
  for (const s of graph.sources) {
    if (isPlaceholderCitation(s.url, s.title)) {
      errors.push(`source "${s.sourceId}" looks like a placeholder citation: "${s.title}" -> "${s.url}"`);
    }
  }

  // --- Definition/unit mismatch (spec §8): same metric, different scope/unit, not
  // explicitly marked comparable. This is a warning, not a hard error: it is often a
  // legitimate editorial choice (e.g. two genuinely different prices worth showing side
  // by side), it just must not be silently merged as if directly comparable. ---
  const byMetric = new Map<string, typeof graph.dataPoints>();
  for (const dp of graph.dataPoints) {
    const key = dp.metric.trim().toLowerCase();
    if (!byMetric.has(key)) byMetric.set(key, []);
    byMetric.get(key)!.push(dp);
  }
  for (const [metric, points] of byMetric) {
    if (points.length < 2) continue;
    const distinctDefinitions = new Set(points.map((p) => `${p.scope.trim().toLowerCase()}|${p.unit.trim().toLowerCase()}`));
    if (distinctDefinitions.size < 2) continue;
    const ungroupedPairs = points.some((a, i) =>
      points.some(
        (b, j) =>
          i < j &&
          (a.scope.trim().toLowerCase() !== b.scope.trim().toLowerCase() || a.unit.trim().toLowerCase() !== b.unit.trim().toLowerCase()) &&
          (!a.comparableGroup || !b.comparableGroup || a.comparableGroup !== b.comparableGroup)
      )
    );
    if (ungroupedPairs) {
      warnings.push(
        `dataPoints for metric "${metric}" have different scope/unit definitions but are not linked by a shared ` +
          `comparableGroup — they must not be treated as directly comparable downstream (spec §8)`
      );
    }
  }

  return { errors, warnings };
}

/** Throws with a formatted message when integrity errors are present. */
export function validateEvidenceGraphIntegrity(graph: EvidenceGraph): EvidenceGraphIntegrityResult {
  const result = checkEvidenceGraphIntegrity(graph);
  if (result.errors.length > 0) {
    throw new Error(
      `[EVIDENCE GRAPH] Integrity FAILED: ${result.errors.length} issue(s). The graph must never ` +
        `contain dangling references or fabricated-looking citations.\n` +
        result.errors.map((e) => `  - ${e}`).join("\n")
    );
  }
  return result;
}
