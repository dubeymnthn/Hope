import React, { useEffect, useState } from "react";
import { useRoute, navigate } from "./router.js";
import { SearchPalette } from "./components/SearchPalette.js";
import { ProjectsPage } from "./pages/ProjectsPage.js";
import { OverviewPage } from "./pages/OverviewPage.js";
import { EditorPage } from "./pages/EditorPage.js";
import { ResearchPage } from "./pages/ResearchPage.js";
import { ScriptPage } from "./pages/ScriptPage.js";
import { StoryboardPage } from "./pages/StoryboardPage.js";
import { AudioPage } from "./pages/AudioPage.js";
import { SourcesPage } from "./pages/SourcesPage.js";
import { SearchPage } from "./pages/SearchPage.js";
import { QAPage } from "./pages/QAPage.js";
import { ExportPage } from "./pages/ExportPage.js";
import { SettingsPage } from "./pages/SettingsPage.js";
import {
  ProjectsIcon,
  EditorIcon,
  ResearchIcon,
  ScriptIcon,
  StoryboardIcon,
  AudioIcon,
  SourcesIcon,
  QAIcon,
  ExportIcon,
  SearchIcon,
  SettingsIcon,
  CollapseIcon
} from "./components/Icons.js";

interface NavItem {
  key: string;
  label: string;
  needsProject: boolean;
  icon: (props: { size?: number }) => React.JSX.Element;
}

const NAV_ITEMS: NavItem[] = [
  { key: "projects", label: "Projects", needsProject: false, icon: (p) => <ProjectsIcon {...p} /> },
  { key: "overview", label: "Overview", needsProject: true, icon: (p) => <ProjectsIcon {...p} /> },
  { key: "editor", label: "Editor", needsProject: true, icon: (p) => <EditorIcon {...p} /> },
  { key: "research", label: "Research", needsProject: true, icon: (p) => <ResearchIcon {...p} /> },
  { key: "script", label: "Script", needsProject: true, icon: (p) => <ScriptIcon {...p} /> },
  { key: "storyboard", label: "Storyboard", needsProject: true, icon: (p) => <StoryboardIcon {...p} /> },
  { key: "audio", label: "Audio", needsProject: true, icon: (p) => <AudioIcon {...p} /> },
  { key: "sources", label: "Sources", needsProject: true, icon: (p) => <SourcesIcon {...p} /> },
  { key: "search", label: "Search", needsProject: true, icon: (p) => <SearchIcon {...p} /> },
  { key: "qa", label: "QA", needsProject: true, icon: (p) => <QAIcon {...p} /> },
  { key: "export", label: "Export", needsProject: true, icon: (p) => <ExportIcon {...p} /> },
  { key: "settings", label: "Settings", needsProject: false, icon: (p) => <SettingsIcon {...p} /> }
];

export default function App() {
  const route = useRoute();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [navCollapsed, setNavCollapsed] = useState(false);

  useEffect(() => {
    if (navCollapsed) {
      document.body.setAttribute("data-nav-collapsed", "true");
    } else {
      document.body.removeAttribute("data-nav-collapsed");
    }
  }, [navCollapsed]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen(true);
      } else if (e.key === "/" && !["input", "textarea"].includes((e.target as HTMLElement)?.tagName?.toLowerCase())) {
        e.preventDefault();
        setPaletteOpen(true);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const currentNav = NAV_ITEMS.find((n) => n.key === route.page);
  const isLibrary = route.page === "projects" && !route.projectId;

  return (
    <div className="app-shell" tabIndex={-1}>
      {/* Topbar */}
      <header className="topbar">
        <div className="topbar-left" style={{ display: "flex", alignItems: "center", gap: "var(--space-3)", minWidth: 0 }}>
          <div
            className="library-wordmark"
            style={{
              fontFamily: "var(--font-ui)",
              fontSize: "var(--text-base)",
              fontWeight: 600,
              color: "var(--text)",
              cursor: "pointer"
            }}
            onClick={() => navigate("projects")}
          >
            Documentary Studio
          </div>

          {route.projectId && (
            <>
              <span className="topbar-sep" style={{ color: "var(--text-tertiary)" }}>/</span>
              <span
                className="topbar-project-title"
                style={{
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-sm)",
                  color: "var(--text-secondary)",
                  cursor: "pointer"
                }}
                onClick={() => navigate("overview", route.projectId)}
              >
                {route.projectId}
              </span>
              {currentNav && (
                <>
                  <span className="topbar-sep" style={{ color: "var(--text-tertiary)" }}>/</span>
                  <span className="topbar-page-title" style={{ color: "var(--accent)", fontSize: "var(--text-sm)", fontWeight: 500 }}>
                    {currentNav.label}
                  </span>
                </>
              )}
            </>
          )}
        </div>

        <div className="topbar-actions">
          {route.projectId && (
            <button
              type="button"
              className="search-pill-btn"
              onClick={() => setPaletteOpen(true)}
              aria-label="Search project"
            >
              <SearchIcon size={14} />
              <span>Search</span>
              <span className="kbd" style={{ marginLeft: 4 }}>Ctrl K</span>
            </button>
          )}
        </div>
      </header>

      {/* Left Navigation (hidden on standalone library unless project active or toggled) */}
      <nav className="app-nav" aria-label="Main Navigation">
        <div className="app-nav-list">
          {NAV_ITEMS.map((item) => {
            const isActive = route.page === item.key;
            return (
              <button
                key={item.key}
                type="button"
                className={`nav-item${isActive ? " active" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "var(--space-3)",
                  width: "100%",
                  textAlign: "left",
                  padding: "8px 16px",
                  background: isActive ? "var(--surface-2)" : "transparent",
                  border: "none",
                  borderLeft: isActive ? "2px solid var(--accent)" : "2px solid transparent",
                  color: isActive ? "var(--text)" : "var(--text-secondary)",
                  cursor: "pointer",
                  fontFamily: "var(--font-ui)",
                  fontSize: "var(--text-sm)",
                  whiteSpace: "nowrap"
                }}
                title={navCollapsed ? item.label : undefined}
                onClick={() => navigate(item.key, item.needsProject ? route.projectId : undefined)}
              >
                <span style={{ display: "flex", alignItems: "center", justifyContent: "center", width: 20 }}>
                  {item.icon({ size: 18 })}
                </span>
                {!navCollapsed && <span>{item.label}</span>}
              </button>
            );
          })}
        </div>

        <div className="app-nav-footer">
          <button
            type="button"
            className="icon-btn"
            style={{
              background: "transparent",
              border: "none",
              color: "var(--text-secondary)",
              cursor: "pointer",
              padding: 6,
              borderRadius: "var(--radius-sm)"
            }}
            onClick={() => setNavCollapsed(!navCollapsed)}
            title={navCollapsed ? "Expand sidebar" : "Collapse sidebar"}
            aria-label="Toggle sidebar"
          >
            <CollapseIcon size={18} style={{ transform: navCollapsed ? "rotate(180deg)" : "none", transition: "transform var(--dur-fast)" }} />
          </button>
        </div>
      </nav>

      {/* Main Area */}
      <main className="app-main" style={{ paddingLeft: isLibrary ? 0 : undefined }}>
        <div className="app-content">
          <Page route={route} />
        </div>
      </main>

      {/* Global Search Palette */}
      {paletteOpen && route.projectId && (
        <SearchPalette projectId={route.projectId} onClose={() => setPaletteOpen(false)} />
      )}
    </div>
  );
}

function Page({ route }: { route: ReturnType<typeof useRoute> }) {
  const needsProject = NAV_ITEMS.find((n) => n.key === route.page)?.needsProject;
  if (needsProject && !route.projectId) {
    return (
      <div className="empty-state" style={{ padding: "var(--space-8)", textAlign: "center" }}>
        <p style={{ color: "var(--text-secondary)", marginBottom: "var(--space-4)" }}>
          No project selected for {route.page}.
        </p>
        <button type="button" className="btn btn-primary" onClick={() => navigate("projects")}>
          Open the Project Library &rarr;
        </button>
      </div>
    );
  }

  switch (route.page) {
    case "overview":
      return <OverviewPage projectId={route.projectId!} />;
    case "editor":
      return <EditorPage projectId={route.projectId!} sceneId={route.query.get("scene") ?? undefined} />;
    case "research":
      return <ResearchPage projectId={route.projectId!} />;
    case "script":
      return <ScriptPage projectId={route.projectId!} />;
    case "storyboard":
      return <StoryboardPage projectId={route.projectId!} />;
    case "audio":
      return <AudioPage projectId={route.projectId!} />;
    case "sources":
      return <SourcesPage projectId={route.projectId!} />;
    case "search":
      return <SearchPage projectId={route.projectId!} />;
    case "qa":
      return <QAPage projectId={route.projectId!} />;
    case "export":
      return <ExportPage projectId={route.projectId!} />;
    case "settings":
      return <SettingsPage />;
    case "projects":
    default:
      return <ProjectsPage />;
  }
}
