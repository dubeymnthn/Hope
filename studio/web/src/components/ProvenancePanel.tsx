import { useEffect, useState } from "react";
import { api, SceneDetail } from "../api/client.js";
import { navigate } from "../router.js";

export function ProvenancePanel({ projectId, scene }: { projectId: string; scene: SceneDetail }) {
  const [graph, setGraph] = useState<any>(null);
  const [vem, setVem] = useState<any>(null);

  useEffect(() => {
    api.getProject(projectId).then((p) => {
      setGraph(p.artifacts?.evidenceGraph);
      setVem(p.artifacts?.visualEvidenceMap);
    }).catch(() => {});
  }, [projectId]);

  if (scene.scriptClaims.length === 0) {
    return (
      <div style={{ color: "var(--text-tertiary)", fontSize: "var(--text-xs)", padding: "var(--space-3) 0" }}>
        No structured evidence claims associated with this scene.
      </div>
    );
  }

  return (
    <div className="inspector-provenance-list" style={{ display: "flex", flexDirection: "column", gap: "var(--space-3)" }}>
      {scene.scriptClaims.map((sc: any) => (
        <ClaimChain key={sc.scriptClaimId || sc.claimText} scriptClaim={sc} graph={graph} vem={vem} projectId={projectId} />
      ))}
    </div>
  );
}

function ClaimChain({ scriptClaim, graph, vem, projectId }: { scriptClaim: any; graph: any; vem: any; projectId: string }) {
  const claim = graph?.claims?.find((c: any) => scriptClaim.evidenceIds?.includes(c.claimId));
  const evidenceIds: string[] = claim ? claim.supportingEvidenceIds : (scriptClaim.evidenceIds || []);
  const evidence = (graph?.evidence ?? []).filter((e: any) => evidenceIds.includes(e.evidenceId));
  const sourceIds = new Set(evidence.map((e: any) => e.sourceId));
  const sources = (graph?.sources ?? []).filter((s: any) => sourceIds.has(s.sourceId));

  return (
    <div
      style={{
        background: "var(--surface-2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-md)",
        padding: "var(--space-3)",
        display: "flex",
        flexDirection: "column",
        gap: 6
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>Claim</span>
        <span style={{ fontSize: "var(--text-xs)", color: "var(--text)", fontWeight: 500 }}>
          {claim ? claim.statement : scriptClaim.claimText}
        </span>
      </div>

      {evidence.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 4, paddingLeft: 12, borderLeft: "1px solid var(--border)" }}>
          {evidence.map((e: any) => (
            <div key={e.evidenceId} style={{ fontSize: "var(--text-2xs)", color: "var(--text-secondary)" }}>
              <span style={{ color: "var(--accent)" }}>Evidence:</span> "{e.evidenceExcerpt || e.quote || e.claim}"
            </div>
          ))}
        </div>
      )}

      {sources.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span className="badge badge-neutral" style={{ fontSize: "var(--text-2xs)" }}>Source</span>
          {sources.map((s: any) => (
            <span
              key={s.sourceId}
              style={{
                fontSize: "var(--text-2xs)",
                color: "var(--accent)",
                cursor: "pointer",
                textDecoration: "underline"
              }}
              onClick={() => navigate("sources", projectId)}
            >
              {s.title || s.name || s.sourceId}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
