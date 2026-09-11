import { useEffect, useRef, useState } from "react";
import { api, SearchResult } from "../api/client.js";
import { navigate } from "../router.js";
import { SearchIcon, CloseIcon } from "./Icons.js";

export function SearchPalette({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!query.trim()) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.search(projectId, query, { limit: 30 }).then((r) => setResults(r.results)).catch(() => {});
    }, 120);
    return () => clearTimeout(t);
  }, [query, projectId]);

  const grouped = results.reduce<Record<string, SearchResult[]>>((acc, r) => {
    (acc[r.kind] ??= []).push(r);
    return acc;
  }, {});

  const goTo = (r: SearchResult) => {
    if (r.timestamp) {
      navigate("editor", projectId, { scene: r.timestamp.sceneId, t: String(r.timestamp.start) });
    } else if (r.refs?.sceneId) {
      navigate("editor", projectId, { scene: r.refs.sceneId });
    } else if (r.kind === "source") {
      navigate("sources", projectId);
    } else if (r.kind === "question" || r.kind === "claim" || r.kind === "evidence" || r.kind === "entity" || r.kind === "contradiction") {
      navigate("research", projectId);
    }
    onClose();
  };

  return (
    <div
      className="modal-overlay"
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.65)",
        backdropFilter: "blur(2px)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: 90,
        zIndex: 1000
      }}
      onClick={onClose}
    >
      <div
        className="modal"
        style={{
          width: 580,
          maxHeight: "65vh",
          background: "var(--panel)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-lg)",
          boxShadow: "var(--shadow-md)",
          overflow: "hidden",
          display: "flex",
          flexDirection: "column"
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "var(--space-3)",
            padding: "var(--space-3) var(--space-4)",
            borderBottom: "1px solid var(--border)"
          }}
        >
          <SearchIcon size={18} style={{ color: "var(--accent)" }} />
          <input
            ref={inputRef}
            type="text"
            className="input search-input"
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              fontSize: "var(--text-md)",
              color: "var(--text)",
              outline: "none"
            }}
            placeholder="Search claims, evidence, script, scenes, sources…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
            }}
          />
          {query && (
            <button
              type="button"
              className="icon-btn"
              onClick={() => setQuery("")}
              aria-label="Clear query"
            >
              <CloseIcon size={14} />
            </button>
          )}
          <span className="kbd">ESC</span>
        </div>

        <div style={{ flex: 1, overflowY: "auto", padding: "var(--space-2) 0" }}>
          {query.trim() && results.length === 0 && (
            <div className="empty-state" style={{ padding: "var(--space-5)" }}>
              No matches found for "{query}".
            </div>
          )}

          {!query.trim() && (
            <div style={{ padding: "var(--space-4)", color: "var(--text-tertiary)", fontSize: "var(--text-xs)" }}>
              Tip: Type a keyword to search across research claims, sources, scene timestamps, and script sentences.
            </div>
          )}

          {Object.entries(grouped).map(([kind, items]) => (
            <div key={kind} style={{ marginBottom: "var(--space-2)" }}>
              <div
                style={{
                  padding: "4px var(--space-4)",
                  fontSize: "var(--text-2xs)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                  color: "var(--text-secondary)",
                  background: "var(--surface-2)"
                }}
              >
                {kind} ({items.length})
              </div>
              {items.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "8px var(--space-4)",
                    cursor: "pointer",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    borderBottom: "1px solid var(--border)",
                    transition: "background var(--dur-fast)"
                  }}
                  className="search-result-row"
                  onClick={() => goTo(item)}
                >
                  <div style={{ flex: 1, minWidth: 0, paddingRight: 12 }}>
                    <div style={{ fontSize: "var(--text-xs)", color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {item.text}
                    </div>
                    <div style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-tertiary)", marginTop: 2 }}>
                      {item.id}
                    </div>
                  </div>

                  {item.timestamp && (
                    <span
                      style={{
                        fontFamily: "var(--font-mono)",
                        fontSize: 10,
                        color: "var(--accent)",
                        background: "var(--surface-3)",
                        padding: "2px 6px",
                        borderRadius: "var(--radius-sm)"
                      }}
                    >
                      {item.timestamp.sceneId} · {item.timestamp.start?.toFixed(1)}s
                    </span>
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
