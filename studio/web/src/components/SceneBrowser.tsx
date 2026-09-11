import { useState } from "react";
import { SceneSummary } from "../api/client.js";
import {
  SceneIcon,
  EditorIcon,
  StoryboardIcon,
  MapIcon,
  DocumentIcon
} from "./Icons.js";

function getVisualModeIcon(mode?: string, size = 14) {
  switch (mode) {
    case "real-video":
      return <SceneIcon size={size} />;
    case "generated":
      return <EditorIcon size={size} />;
    case "comparison":
      return <StoryboardIcon size={size} />;
    case "map":
      return <MapIcon size={size} />;
    case "document":
      return <DocumentIcon size={size} />;
    default:
      return <SceneIcon size={size} />;
  }
}

export function SceneBrowser({
  scenes,
  chapters,
  selected,
  onSelect
}: {
  scenes: SceneSummary[];
  chapters: { id: string; title: string; sceneIds: string[] }[];
  selected?: string;
  onSelect: (sceneId: string) => void;
}) {
  const [density, setDensity] = useState<"compact" | "expanded">("compact");

  if (scenes.length === 0) {
    return <div className="empty-state">No script scenes yet.</div>;
  }

  const byChapter = new Map<string, SceneSummary[]>();
  const noChapter: SceneSummary[] = [];
  for (const s of scenes) {
    if (s.chapter) {
      if (!byChapter.has(s.chapter)) byChapter.set(s.chapter, []);
      byChapter.get(s.chapter)!.push(s);
    } else {
      noChapter.push(s);
    }
  }

  const chapterTitle = (id: string) => chapters.find((c) => c.id === id)?.title ?? id;
  const chapterNumber = (id: string, idx: number) => {
    const num = id.replace(/\D/g, "");
    return num ? num.padStart(2, "0") : String(idx + 1).padStart(2, "0");
  };

  return (
    <section className="panel scene-browser-panel" aria-label="Scene Browser" style={{ height: "100%", display: "flex", flexDirection: "column" }}>
      <div className="panel-header" style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span>Scene Browser</span>
        <div className="segmented" role="group" aria-label="Scene browser density">
          <button
            type="button"
            className={`segmented-option${density === "compact" ? " active" : ""}`}
            onClick={() => setDensity("compact")}
          >
            Compact
          </button>
          <button
            type="button"
            className={`segmented-option${density === "expanded" ? " active" : ""}`}
            onClick={() => setDensity("expanded")}
          >
            Expanded
          </button>
        </div>
      </div>

      <div className="scene-browser-body" style={{ flex: 1, overflowY: "auto", padding: "var(--space-2) 0" }}>
        {[...byChapter.entries()].map(([chapterId, chapterScenes], chIdx) => (
          <div key={chapterId} className="chapter-group">
            <div className="chapter-header">
              <span className="chapter-header-num">CH {chapterNumber(chapterId, chIdx)}</span>
              <span className="chapter-header-sep">·</span>
              <span className="chapter-header-title">{chapterTitle(chapterId)}</span>
            </div>
            <div className="chapter-scenes">
              {chapterScenes.map((s, sIdx) => (
                <SceneRow
                  key={s.sceneId}
                  scene={s}
                  index={sIdx + 1}
                  density={density}
                  active={s.sceneId === selected}
                  onClick={() => onSelect(s.sceneId)}
                />
              ))}
            </div>
          </div>
        ))}

        {noChapter.length > 0 && (
          <div className="chapter-group">
            <div className="chapter-header">
              <span className="chapter-header-title">Unassigned Scenes</span>
            </div>
            <div className="chapter-scenes">
              {noChapter.map((s, sIdx) => (
                <SceneRow
                  key={s.sceneId}
                  scene={s}
                  index={sIdx + 1}
                  density={density}
                  active={s.sceneId === selected}
                  onClick={() => onSelect(s.sceneId)}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}

function SceneRow({
  scene,
  index,
  density,
  active,
  onClick
}: {
  scene: SceneSummary;
  index: number;
  density: "compact" | "expanded";
  active: boolean;
  onClick: () => void;
}) {
  const isExpanded = density === "expanded";
  const qaState = (scene.qaState || "pass").toLowerCase();
  const dotClass =
    qaState === "pass"
      ? "status-dot-success"
      : qaState === "warning"
      ? "status-dot-warning"
      : "status-dot-danger";

  return (
    <div
      className={`scene-row${active ? " selected" : ""}`}
      style={{
        padding: isExpanded ? "8px var(--space-3)" : "6px var(--space-3)",
        cursor: "pointer"
      }}
      onClick={onClick}
    >
      <span className="scene-row-number">{String(index).padStart(2, "0")}</span>

      <div
        className="scene-row-thumb"
        style={{
          width: isExpanded ? 40 : 28,
          height: isExpanded ? 26 : 20,
          background: "var(--surface-3)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--radius-sm)",
          color: active ? "var(--accent)" : "var(--text-secondary)"
        }}
        title={`Mode: ${scene.visualMode ?? "unknown"}`}
      >
        {getVisualModeIcon(scene.visualMode, isExpanded ? 16 : 13)}
      </div>

      <div className="scene-row-body" style={{ flex: 1, minWidth: 0, paddingLeft: 6 }}>
        <div
          className="scene-row-title"
          style={{
            fontFamily: "var(--font-ui)",
            fontSize: "var(--text-xs)",
            fontWeight: active ? 600 : 500,
            color: active ? "var(--text)" : "var(--text-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap"
          }}
        >
          {scene.sceneId} · {scene.visualMode ?? "standard"}
        </div>
        {isExpanded && scene.narrationExcerpt && (
          <div
            style={{
              fontSize: "var(--text-2xs)",
              color: "var(--text-tertiary)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              marginTop: 2
            }}
          >
            {scene.narrationExcerpt}
          </div>
        )}
      </div>

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--text-2xs)",
          color: "var(--text-tertiary)",
          marginLeft: 6
        }}
      >
        {scene.duration ? `${scene.duration.toFixed(1)}s` : "—"}
      </span>

      <span
        className={`status-dot ${dotClass}`}
        style={{ marginLeft: 6, flexShrink: 0 }}
        title={`QA: ${scene.qaState || "pass"}`}
      />
    </div>
  );
}
