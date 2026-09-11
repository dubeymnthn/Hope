import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { ScriptResult } from "../schemas/script.js";
import { ArgumentResult } from "../schemas/argument.js";
import { VisualEvidenceMap } from "../schemas/visual-evidence-map.js";
import { StalenessReport } from "../schemas/staleness.js";

/**
 * Staleness detection (V2.6 spec §10/§31): when a human edits research (typically
 * deleting an evidence/data point a downstream claim relied on), find exactly what
 * downstream content now cites something that no longer exists. Deliberately reuses the
 * same `knownIds` referential-integrity approach `script-qa.ts`'s E4 check and
 * `evidence-graph-integrity.ts` already use, rather than building a generic
 * dependency-graph engine (CLAUDE.md explicitly rejected that shape once already, for
 * scene fingerprints — see the V2.4 notes).
 */
export function computeStaleness(params: {
  evidenceGraph: EvidenceGraph;
  script?: ScriptResult | null;
  argument?: ArgumentResult | null;
  visualEvidenceMap?: VisualEvidenceMap | null;
}): StalenessReport {
  const { evidenceGraph, script, argument, visualEvidenceMap } = params;

  const knownEvidenceOrClaimIds = new Set<string>([
    ...evidenceGraph.evidence.map((e) => e.evidenceId),
    ...evidenceGraph.claims.map((c) => c.claimId)
  ]);
  const knownDataPointIds = new Set(evidenceGraph.dataPoints.map((d) => d.dataPointId));

  const affectedClaims: string[] = [];
  for (const claim of evidenceGraph.claims) {
    const missingEvidence = [...claim.supportingEvidenceIds, ...claim.contradictingEvidenceIds].some(
      (id) => !knownEvidenceOrClaimIds.has(id)
    );
    const missingDataPoints = claim.dataPointIds.some((id) => !knownDataPointIds.has(id));
    if (missingEvidence || missingDataPoints) affectedClaims.push(claim.claimId);
  }

  const affectedArgumentSections: string[] = [];
  for (const sc of argument?.supportingClaims ?? []) {
    const evidenceIds = sc.evidenceIds ?? [];
    if (evidenceIds.length > 0 && evidenceIds.some((id) => !knownEvidenceOrClaimIds.has(id))) {
      affectedArgumentSections.push(sc.claim);
    }
  }

  const affectedScriptScenes: string[] = [];
  for (const scene of script?.scenes ?? []) {
    const orphan = (scene.scriptClaims ?? []).some((sc) => sc.evidenceIds.some((id) => !knownEvidenceOrClaimIds.has(id)));
    if (orphan) affectedScriptScenes.push(scene.id);
  }

  const affectedVisualOpportunities: string[] = [];
  for (const op of visualEvidenceMap?.opportunities ?? []) {
    const orphan =
      !knownEvidenceOrClaimIds.has(op.claimId) || op.evidenceIds.some((id) => !knownEvidenceOrClaimIds.has(id));
    if (orphan) affectedVisualOpportunities.push(op.visualOpportunityId);
  }

  const staleReasons: string[] = [];
  if (affectedClaims.length > 0) staleReasons.push(`${affectedClaims.length} evidence-graph claim(s) reference evidence/data that no longer exists`);
  if (affectedArgumentSections.length > 0) staleReasons.push(`${affectedArgumentSections.length} argument section(s) cite removed evidence`);
  if (affectedScriptScenes.length > 0) staleReasons.push(`${affectedScriptScenes.length} script scene(s) contain orphaned claims`);
  if (affectedVisualOpportunities.length > 0) staleReasons.push(`${affectedVisualOpportunities.length} visual opportunity(ies) cite removed evidence`);

  const summary =
    staleReasons.length === 0
      ? "No downstream content references removed evidence."
      : `Research change detected. Affected: ${affectedClaims.length} claim(s), ${affectedArgumentSections.length} argument section(s), ` +
        `${affectedScriptScenes.length} script scene(s), ${affectedVisualOpportunities.length} visual opportunity(ies).`;

  return {
    generatedAt: new Date().toISOString(),
    staleReasons,
    affectedClaims,
    affectedArgumentSections,
    affectedScriptScenes,
    affectedVisualOpportunities,
    summary
  };
}
