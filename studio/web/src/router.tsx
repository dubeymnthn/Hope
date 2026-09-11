import { useEffect, useState, useCallback } from "react";

/**
 * A tiny hash router (`#/editor/<projectId>?scene=<id>`) — no router dependency added,
 * since this app's routing needs (a handful of top-level pages + one project-id param)
 * don't justify one. Refresh-safe and back/forward-safe via window.location.hash.
 */
export interface Route {
  page: string;
  projectId?: string;
  query: URLSearchParams;
}

function parseHash(): Route {
  const raw = window.location.hash.replace(/^#\/?/, "");
  const [pathPart, queryPart] = raw.split("?");
  const segments = pathPart.split("/").filter(Boolean);
  const page = segments[0] || "projects";
  const projectId = segments[1];
  return { page, projectId, query: new URLSearchParams(queryPart ?? "") };
}

export function navigate(page: string, projectId?: string, query?: Record<string, string>): void {
  const qs = query ? "?" + new URLSearchParams(query).toString() : "";
  window.location.hash = `/${page}${projectId ? `/${projectId}` : ""}${qs}`;
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(parseHash());
  useEffect(() => {
    const onChange = () => setRoute(parseHash());
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function useNavigate(): (page: string, projectId?: string, query?: Record<string, string>) => void {
  return useCallback(navigate, []);
}
