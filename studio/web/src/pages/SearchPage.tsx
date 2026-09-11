import { useState } from "react";
import { api, SearchResult } from "../api/client.js";
import { navigate } from "../router.js";
import { SearchIcon } from "../components/Icons.js";

export function SearchPage({ projectId }: { projectId: string }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [exact, setExact] = useState(false);

  const run = () => {
    if (!query.trim()) return;
    api.search(projectId, query, { exact }).then((r) => setResults(r.results)).catch(() => {});
  };

  const grouped = (results ?? []).reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  return (
    <div style={{ padding: "var(--space-6) var(--space-8) var(--space-8)", maxWidth: 1000 }}>
      <div style={{ marginBottom: "var(--space-5)" }}>
        <h1 style={{ fontFamily: "var(--font-display)", fontSize: "var(--text-3xl)", margin: 0, fontWeight: 600 }}>
          Deep Search
        </h1>
        <p style={{ color: "var(--text-secondary)", fontSize: "var(--text-sm)", margin: "var(--space-1) 0 0" }}>
          Full-text, exact-phrase, and numeric query across research dossiers, evidence graph, script, and timestamps.
        </p>
      </div>

      <div style={{ display: "flex", gap: "var(--space-3)", alignItems: "center", marginBottom: "var(--space-6)" }}>
        <div style={{ position: "relative", flex: 1 }}>
          <input
            type="text"
            className="input search-input"
            style={{ width: "100%", height: 38, paddingLeft: 34 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="Search keywords, timestamps, data figures (e.g. $7,000, cathode, bottlenecks)…"
          />
          <span style={{ position: "absolute", left: 10, top: 10, color: "var(--text-secondary)" }}>
            <SearchIcon size={18} />
          </span>
        </div>

        <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "var(--text-xs)", cursor: "pointer", color: "var(--text-secondary)" }}>
          <input type="checkbox" checked={exact} onChange={(e) => setExact(e.target.checked)} />
          <span>Exact phrase</span>
        </label>

        <button type="button" className="btn btn-primary" style={{ height: 38, padding: "0 var(--space-4)" }} onClick={run}>
          Search
        </button>
      </div>

      {results && results.length === 0 && <div className="empty-state">No matching records found.</div>}

      {Object.entries(grouped).map(([kind, items]) => (
        <div
          key={kind}
          className="panel"
          style={{
            background: "var(--panel)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-lg)",
            marginBottom: "var(--space-4)",
            overflow: "hidden"
          }}
        >
          <div className="panel-header" style={{ textTransform: "uppercase", fontSize: "var(--text-xs)" }}>
            <span>{kind} ({items.length})</span>
          </div>

          <div style={{ display: "flex", flexDirection: "column" }}>
            {items.map((r) => (
              <div
                key={`${r.kind}:${r.id}`}
                style={{
                  padding: "var(--space-3) var(--space-4)",
                  borderBottom: "1px solid var(--border)",
                  cursor: "pointer",
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center"
                }}
                className="search-result-row"
                onClick={() => {
                  if (r.timestamp) navigate("editor", projectId, { scene: r.timestamp.sceneId, t: String(r.timestamp.start) });
                  else if (r.refs?.sceneId) navigate("editor", projectId, { scene: r.refs.sceneId });
                  else if (r.kind === "source") navigate("sources", projectId);
                  else navigate("research", projectId);
                }}
              >
                <div style={{ flex: 1, minWidth: 0, paddingRight: 16 }}>
                  <div style={{ fontSize: "var(--text-sm)", color: "var(--text)", lineHeight: 1.4 }}>
                    {r.text}
                  </div>
                  <div style={{ fontFamily: "var(--font-mono)", fontSize: "var(--text-2xs)", color: "var(--text-tertiary)", marginTop: 2 }}>
                    ID: {r.id}
                  </div>
                </div>

                {r.timestamp && (
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "var(--text-2xs)",
                      color: "var(--accent)",
                      background: "var(--surface-2)",
                      padding: "3px 8px",
                      borderRadius: "var(--radius-sm)"
                    }}
                  >
                    {r.timestamp.sceneId} @ {r.timestamp.start.toFixed(1)}s
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
