import { useEffect, useState } from "react";
import { api, SceneSummary } from "../api/client.js";
import { navigate } from "../router.js";
import { SceneBrowser } from "../components/SceneBrowser.js";
import { Preview } from "../components/Preview.js";
import { Timeline } from "../components/Timeline.js";
import { Inspector } from "../components/Inspector.js";
import { JobsPanel } from "../components/JobsPanel.js";
import { HealthBadge } from "../components/HealthBadge.js";

export function EditorPage({ projectId, sceneId }: { projectId: string; sceneId?: string }) {
  const [scenes, setScenes] = useState<SceneSummary[]>([]);
  const [chapters, setChapters] = useState<{ id: string; title: string; sceneIds: string[] }[]>([]);
  const [hasFinal, setHasFinal] = useState(false);
  const [health, setHealth] = useState<any>(null);
  const [showJobs, setShowJobs] = useState(false);
  const [playheadSeconds, setPlayheadSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const reload = () => {
    api
      .listScenes(projectId)
      .then((r) => {
        setScenes(r.scenes);
        setChapters(r.chapters);
        if (!sceneId && r.scenes.length > 0) {
          navigate("editor", projectId, { scene: r.scenes[0].sceneId });
        }
      })
      .catch((e) => setError(e.message));

    api
      .getProject(projectId)
      .then((p) => {
        setHasFinal(!!p.artifacts?.audio && p.summary?.stages?.render === "complete");
        setHealth(p.health);
      })
      .catch(() => {});
  };

  useEffect(reload, [projectId]);

  const activeScene = scenes.find((s) => s.sceneId === sceneId) || scenes[0];
  const activeSceneIdx = scenes.findIndex((s) => s.sceneId === sceneId);
  const totalDuration = scenes.reduce((sum, s) => sum + (s.duration ?? 0), 0);

  const handlePreviousScene = () => {
    if (activeSceneIdx > 0) {
      navigate("editor", projectId, { scene: scenes[activeSceneIdx - 1].sceneId });
    }
  };

  const handleNextScene = () => {
    if (activeSceneIdx < scenes.length - 1) {
      navigate("editor", projectId, { scene: scenes[activeSceneIdx + 1].sceneId });
    }
  };

  const startFullRender = () => {
    api.startRender(projectId, "full").then(() => setShowJobs(true)).catch((e) => setError(e.message));
  };

  const startScenePreview = () => {
    if (!sceneId) return;
    api.startRender(projectId, `scene:${sceneId}`).then(() => setShowJobs(true)).catch((e) => setError(e.message));
  };

  return (
    <div className="editor-layout" style={{ height: "calc(100vh - var(--topbar-h))", display: "flex", flexDirection: "column", gap: "var(--space-3)", padding: "var(--space-3)", boxSizing: "border-box" }}>
      {/* Top 3-Column Area */}
      <div
        className="editor-top"
        style={{
          display: "grid",
          gridTemplateColumns: "272px minmax(480px, 1fr) 320px",
          gap: "var(--space-3)",
          flex: "1 1 auto",
          minHeight: 0
        }}
      >
        {/* Left: Scene Browser */}
        <SceneBrowser
          scenes={scenes}
          chapters={chapters}
          selected={sceneId}
          onSelect={(id) => navigate("editor", projectId, { scene: id })}
        />

        {/* Center: Video Preview */}
        <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
          {/* Quick Action Header */}
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "var(--space-2)",
              padding: "4px 8px",
              background: "var(--panel)",
              border: "1px solid var(--border)",
              borderBottom: "none",
              borderRadius: "var(--radius-md) var(--radius-md) 0 0"
            }}
          >
            {health && <HealthBadge health={health} />}
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "var(--text-xs)", height: 26, padding: "0 8px" }}
              onClick={startScenePreview}
              disabled={!sceneId}
            >
              Preview Scene
            </button>
            <button
              type="button"
              className="btn btn-primary"
              style={{ fontSize: "var(--text-xs)", height: 26, padding: "0 8px" }}
              onClick={startFullRender}
            >
              Render Full
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              style={{ fontSize: "var(--text-xs)", height: 26, padding: "0 8px" }}
              onClick={() => setShowJobs(!showJobs)}
            >
              {showJobs ? "Hide Jobs" : "Jobs"}
            </button>
          </div>

          {error && <div className="error-banner" style={{ margin: "var(--space-2) 0" }}>{error}</div>}

          <div style={{ flex: 1, minHeight: 0 }}>
            <Preview
              projectId={projectId}
              currentScene={activeScene}
              hasFinal={hasFinal}
              seekToSeconds={playheadSeconds}
              onPreviousScene={handlePreviousScene}
              onNextScene={handleNextScene}
            />
          </div>

          {showJobs && (
            <div style={{ padding: "var(--space-2)", background: "var(--panel)", border: "1px solid var(--border)", borderTop: "none", maxHeight: 150, overflowY: "auto" }}>
              <JobsPanel projectId={projectId} onJobDone={reload} />
            </div>
          )}
        </div>

        {/* Right: Inspector */}
        <div style={{ height: "100%", minHeight: 0 }}>
          {sceneId && <Inspector projectId={projectId} sceneId={sceneId} onSceneChanged={reload} />}
        </div>
      </div>

      {/* Bottom Timeline */}
      <div style={{ height: 160, flexShrink: 0 }}>
        <Timeline
          scenes={scenes}
          totalDuration={totalDuration}
          playheadSeconds={playheadSeconds}
          selected={sceneId}
          onSelect={(id) => navigate("editor", projectId, { scene: id })}
          onSeek={(t) => setPlayheadSeconds(t)}
        />
      </div>
    </div>
  );
}
