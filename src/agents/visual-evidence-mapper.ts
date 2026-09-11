import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { VisualEvidenceMap, VisualEvidenceMapSchema } from "../schemas/visual-evidence-map.js";
import { EvidenceGraph } from "../schemas/evidence-graph.js";
import { ScriptResult } from "../schemas/script.js";
import { AgentTaskGate, hashArtifact } from "./agent-task.js";

export interface VisualEvidenceMapVerification {
  map: VisualEvidenceMap;
  artifactHash: string;
  opportunityCount: number;
}

/** Normalises an id for comparison; ids are compared verbatim (no fuzzy matching, unlike free-text claims). */
function idSet<T extends { [key: string]: any }>(items: T[], key: string): Set<string> {
  return new Set(items.map((i) => i[key]));
}

/**
 * Visual Evidence Mapper stage (V2.3 spec section 20-21).
 *
 * For every major claim, decides the best way to SHOW its evidence, before the Visual
 * Director lays out scenes. Runs after the claim-gate passes (script is locked) and
 * before TTS, since it needs no real audio timing. Enforces "must not invent data" the
 * same way visual-director.ts's chart-data-integrity check does: every evidence/data
 * reference must resolve into the evidence graph, or the artifact is rejected outright.
 */
export class VisualEvidenceMapperAgent {
  public async ensure(
    topic: string,
    outputDir: string = process.cwd(),
    options: { script: ScriptResult; evidenceGraph: EvidenceGraph; repoRoot?: string }
  ): Promise<VisualEvidenceMapVerification> {
    const dir = join(outputDir, "visual-evidence");
    const jsonPath = join(dir, "visual-evidence-map.json");
    const gate = new AgentTaskGate({ projectDir: outputDir, repoRoot: options.repoRoot });

    if (!existsSync(jsonPath)) {
      mkdirSync(dir, { recursive: true });
      this.requestMap(gate, topic, options, "visual-evidence/visual-evidence-map.json does not exist yet.");
    }

    let validated: VisualEvidenceMap;
    try {
      validated = VisualEvidenceMapSchema.parse(JSON.parse(readFileSync(jsonPath, "utf-8")));
    } catch (err: any) {
      this.requestMap(gate, topic, options, `Existing visual-evidence/visual-evidence-map.json is invalid and was rejected: ${err.message}`);
    }

    const map = validated!;
    if (map.topic.trim().toLowerCase() !== topic.trim().toLowerCase()) {
      this.requestMap(gate, topic, options, `Existing visual evidence map addresses "${map.topic}" but the requested topic is "${topic}".`);
    }

    // --- "Must not invent data" (spec §20): every reference must resolve into the graph ---
    const claimIds = idSet(options.evidenceGraph.claims, "claimId");
    const evidenceIds = idSet(options.evidenceGraph.evidence, "evidenceId");
    const dataPointIds = idSet(options.evidenceGraph.dataPoints, "dataPointId");
    const entityIds = idSet(options.evidenceGraph.entities, "entityId");
    const eventIds = idSet(options.evidenceGraph.events, "eventId");

    const unresolved: string[] = [];
    for (const op of map.opportunities) {
      if (!claimIds.has(op.claimId)) unresolved.push(`${op.visualOpportunityId}: unknown claimId "${op.claimId}"`);
      for (const id of op.evidenceIds) if (!evidenceIds.has(id)) unresolved.push(`${op.visualOpportunityId}: unknown evidenceId "${id}"`);
      for (const id of op.dataRequirements) if (!dataPointIds.has(id)) unresolved.push(`${op.visualOpportunityId}: unknown dataPointId "${id}"`);
      for (const id of op.entityIds) if (!entityIds.has(id)) unresolved.push(`${op.visualOpportunityId}: unknown entityId "${id}"`);
      for (const id of op.timelineEventIds) if (!eventIds.has(id)) unresolved.push(`${op.visualOpportunityId}: unknown eventId "${id}"`);
    }

    if (unresolved.length > 0) {
      throw new Error(
        `[VISUAL-EVIDENCE-MAPPER] Integrity FAILED: ${unresolved.length} reference(s) do not resolve into ` +
          `research/evidence-graph.json. A visual opportunity must never point at data that does not exist.\n` +
          unresolved.map((u) => `  - ${u}`).join("\n")
      );
    }

    console.log(`[VISUAL-EVIDENCE-MAPPER] Verified visual evidence map for "${map.topic}"`);
    console.log(`  - Visual opportunities: ${map.opportunities.length}`);
    console.log(`  - Distinct visual modes suggested: ${new Set(map.opportunities.map((o) => o.visualMode)).size}`);

    return { map, artifactHash: hashArtifact(jsonPath), opportunityCount: map.opportunities.length };
  }

  private requestMap(
    gate: AgentTaskGate,
    topic: string,
    options: { script: ScriptResult; evidenceGraph: EvidenceGraph },
    reason: string
  ): never {
    return gate.request({
      stage: "visual-evidence-map",
      title: `Visual evidence map for "${topic}"`,
      reason,
      artifactPath: "visual-evidence/visual-evidence-map.json",
      schemaName: "VisualEvidenceMapSchema",
      schemaFiles: ["src/schemas/visual-evidence-map.ts", "src/schemas/evidence-graph.ts"],
      mission:
        `For every major claim in the script, decide the best way to SHOW its evidence: what is the ` +
        `evidence, and what is the best way to communicate it visually? This runs BEFORE the Visual ` +
        `Director lays out scenes, so your recommendations become authoritative guidance for that stage.\n\n` +
        `Prefer visuals that communicate information over decoration: a verified historical line chart ` +
        `beats a big number for a trend claim; a map/flow beats a diagram for geographic concentration; ` +
        `a process diagram with verified stages beats a generic list. Do not turn every claim into a ` +
        `chart, and never animate a number that has no evidence behind it.`,
      context: { topic, scriptScenes: options.script.scenes.length, availableClaims: options.evidenceGraph.claims.length },
      requirements: [
        "Cover the major claims that actually appear in the script's narration/scriptClaims.",
        "Every `claimId` must be a real claimId from research/evidence-graph.json.",
        "Every `evidenceIds`/`dataRequirements`/`entityIds`/`timelineEventIds` entry must reference a real id in the graph.",
        "Set `visualPurpose` to what the visual is actually FOR (show_trend, show_comparison, show_structure, ...).",
        "Write a `rationale` explaining why this mode communicates the claim better than a simpler alternative.",
        "Set `animationPotential` and `confidence` honestly, not uniformly high."
      ],
      prohibitions: [
        "Never invent a claimId, evidenceId, dataPointId, entityId or eventId that isn't in the evidence graph.",
        "Never recommend a chart/graph visual for a claim with no backing dataPoints.",
        "Never recommend the same visualMode for every opportunity regardless of what the claim needs.",
        "Never suggest a visual purely for decoration; every recommendation must communicate the claim's evidence."
      ],
      inputs: [
        { label: "Script (claims to visualize)", path: "script/script.json", inline: true },
        { label: "Evidence graph (the only permitted data source)", path: "research/evidence-graph.json", inline: true }
      ]
    });
  }
}
