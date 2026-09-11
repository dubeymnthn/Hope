/**
 * Typed fetch wrappers mirroring the Express routes in studio/server/routes/*.ts.
 * Types here are intentionally light/duck-typed rather than re-importing the backend's
 * zod schemas — the frontend build stays decoupled from the Node-targeted server code.
 */

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) }
  });
  const isJson = res.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await res.json() : undefined;
  if (!res.ok) {
    throw new ApiError(res.status, body?.error ?? res.statusText);
  }
  return body as T;
}

export interface HealthInfo {
  state: "HEALTHY" | "NEEDS_REVIEW" | "BLOCKED" | "RUNNING" | "FAILED";
  reasons: string[];
}

export interface ProjectSummary {
  id: string;
  title: string;
  topic: string;
  runtimeSeconds: number | null;
  sceneCount: number;
  chapterCount: number;
  lastModified: string;
  health: HealthInfo;
  stages: Record<string, string>;
  productionPhase: string;
  qaStatus: string | null;
}

export interface ProjectDetail {
  id: string;
  summary: ProjectSummary;
  artifacts: any;
  qa: any;
  health: HealthInfo;
  jobs: RenderJob[];
}

export interface SceneSummary {
  sceneId: string;
  chapter?: string;
  visualMode?: string;
  duration?: number;
  beatCount: number;
  narrationExcerpt: string;
  qaState: string;
  stale: boolean;
}

export interface SceneDetail extends SceneSummary {
  narration: string;
  purpose: string;
  wordCount: number;
  scriptClaims: any[];
  start?: number;
  visualDescription?: string;
  onScreenText?: string;
  camera?: string;
  animationIntent?: string;
  beats: any[];
  dataPoints: any[];
  visualOpportunities: any[];
  tts: { cached: boolean; duration?: number; generatedAt?: string } | null;
}

export interface RenderJob {
  jobId: string;
  projectId: string;
  scope: "full" | "produce" | "tts" | { scene: string };
  status: "queued" | "running" | "complete" | "failed" | "blocked" | "awaiting_agent";
  startedAt: string;
  completedAt?: string;
  stages: { stage: string; status: string; durationMs: number; detail?: string }[];
  error?: string;
  outputPath?: string;
}

export interface ApprovalRecord {
  approvedAt: string;
  approvedArtifactHash: string;
  atRevision: number;
}

export interface ProductionSummary {
  phase: string;
  approvals: { research: ApprovalRecord | null; script: ApprovalRecord | null };
  revisionCounters: { research: number; argument: number; script: number; design: number };
  researchApprovalValid: boolean;
  scriptApprovalValid: boolean;
  stages: { key: string; label: string; status: string }[];
}

export interface StalenessReport {
  generatedAt: string;
  staleReasons: string[];
  affectedClaims: string[];
  affectedArgumentSections: string[];
  affectedScriptScenes: string[];
  affectedVisualOpportunities: string[];
  summary: string;
}

export interface DesignInfo {
  designMd: string | null;
  strategy: any | null;
  stale: boolean;
}

export interface SearchResult {
  kind: string;
  id: string;
  text: string;
  refs: Record<string, string>;
  timestamp: { sceneId: string; start: number; duration: number; narration: string } | null;
}

export const api = {
  listProjects: () => request<{ projects: ProjectSummary[] }>("/projects"),
  createProject: (topic: string, generate: boolean, designMd?: string) =>
    request<{ id: string; jobId?: string }>("/projects", { method: "POST", body: JSON.stringify({ topic, generate, designMd }) }),
  getProject: (id: string) => request<ProjectDetail>(`/projects/${id}`),
  getHealth: (id: string) => request<HealthInfo>(`/projects/${id}/health`),

  listScenes: (id: string) => request<{ scenes: SceneSummary[]; chapters: { id: string; title: string; sceneIds: string[] }[] }>(`/projects/${id}/scenes`),
  getScene: (id: string, sceneId: string) => request<SceneDetail>(`/projects/${id}/scenes/${sceneId}`),
  patchScene: (id: string, sceneId: string, patch: Record<string, unknown>) =>
    request(`/projects/${id}/scenes/${sceneId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  patchBeat: (id: string, sceneId: string, beatId: string, patch: Record<string, unknown>) =>
    request(`/projects/${id}/scenes/${sceneId}/beats/${beatId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  patchNarration: (id: string, sceneId: string, narration: string) =>
    request<{ script: any; qa: any }>(`/projects/${id}/scenes/${sceneId}/narration`, { method: "PATCH", body: JSON.stringify({ narration }) }),
  regenerateNarration: (id: string, sceneId: string) =>
    request<RenderJob>(`/projects/${id}/scenes/${sceneId}/narration/regenerate`, { method: "POST" }),

  search: (id: string, q: string, opts?: { kind?: string; exact?: boolean; limit?: number }) =>
    request<{ query: string; total: number; results: SearchResult[] }>(
      `/projects/${id}/search?q=${encodeURIComponent(q)}${opts?.kind ? `&kind=${opts.kind}` : ""}${opts?.exact ? "&exact=true" : ""}${opts?.limit ? `&limit=${opts.limit}` : ""}`
    ),

  getAudio: (id: string) => request<any>(`/projects/${id}/audio`),
  getQa: (id: string) => request<any>(`/projects/${id}/qa`),

  startRender: (id: string, scope: string) => request<RenderJob>(`/projects/${id}/render`, { method: "POST", body: JSON.stringify({ scope }) }),
  getJob: (jobId: string) => request<RenderJob>(`/jobs/${jobId}`),
  listJobs: (projectId: string) => request<{ jobs: RenderJob[] }>(`/jobs?projectId=${projectId}`),

  runExport: (id: string) => request<any>(`/projects/${id}/export`, { method: "POST" }),

  listRevisions: (id: string) => request<{ entries: any[]; cursor: number }>(`/projects/${id}/revisions`),
  undo: (id: string) => request<any>(`/projects/${id}/revisions/undo`, { method: "POST" }),
  redo: (id: string) => request<any>(`/projects/${id}/revisions/redo`, { method: "POST" }),

  // --- V2.6: research review workbench ---
  getResearch: (id: string) => request<{ plan: any; questions: any; evidenceGraph: any; gaps: any; research: any }>(`/projects/${id}/research`),
  getResearchStaleness: (id: string) => request<StalenessReport>(`/projects/${id}/research/staleness`),
  patchQuestion: (id: string, questionId: string, patch: Record<string, unknown>) =>
    request<any>(`/projects/${id}/research/questions/${questionId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  addQuestion: (id: string, input: Record<string, unknown>) =>
    request<any>(`/projects/${id}/research/questions`, { method: "POST", body: JSON.stringify(input) }),
  patchEvidence: (id: string, evidenceId: string, patch: Record<string, unknown>) =>
    request<any>(`/projects/${id}/research/evidence/${evidenceId}`, { method: "PATCH", body: JSON.stringify(patch) }),
  addEvidence: (id: string, input: Record<string, unknown>) =>
    request<any>(`/projects/${id}/research/evidence`, { method: "POST", body: JSON.stringify(input) }),
  getEvidenceRemovalImpact: (id: string, evidenceId: string) =>
    request<StalenessReport>(`/projects/${id}/research/evidence/${evidenceId}/removal-impact`),
  deleteEvidence: (id: string, evidenceId: string) => request<any>(`/projects/${id}/research/evidence/${evidenceId}`, { method: "DELETE" }),
  requestMoreResearch: (id: string, input: { instruction: string; targetQuestionId?: string; targetClaimId?: string }) =>
    request<{ stage: string; briefPath: string }>(`/projects/${id}/research/request-more`, { method: "POST", body: JSON.stringify(input) }),
  approveResearch: (id: string) => request<{ approved: true; warnings: string[] }>(`/projects/${id}/research/approve`, { method: "POST" }),

  // --- V2.6: script review workbench ---
  getScriptReview: (id: string) => request<{ script: any; argument: any; evidenceGraph: any }>(`/projects/${id}/script-review`),
  deleteScene: (id: string, sceneId: string) => request<any>(`/projects/${id}/script-review/scenes/${sceneId}`, { method: "DELETE" }),
  moveScene: (id: string, sceneId: string, toIndex: number) =>
    request<any>(`/projects/${id}/script-review/scenes/${sceneId}/move`, { method: "POST", body: JSON.stringify({ toIndex }) }),
  overrideClaim: (id: string, sceneId: string, claimId: string, justification: string) =>
    request<any>(`/projects/${id}/script-review/scenes/${sceneId}/claims/${claimId}/override`, { method: "POST", body: JSON.stringify({ justification }) }),
  approveScript: (id: string) => request<{ approved: true; warnings: string[] }>(`/projects/${id}/script-review/approve`, { method: "POST" }),
  requestScriptRevision: (id: string, input: { instruction: string; sceneId?: string }) =>
    request<{ stage: string; briefPath: string }>(`/projects/${id}/script-review/request-revision`, { method: "POST", body: JSON.stringify(input) }),

  // --- V2.6: production dashboard ---
  getProduction: (id: string) => request<ProductionSummary>(`/projects/${id}/production`),
  startProduction: (id: string) => request<RenderJob>(`/projects/${id}/production/start`, { method: "POST" }),

  // --- V2.6: design.md ---
  getDesign: (id: string) => request<DesignInfo>(`/projects/${id}/design`),
  saveDesign: (id: string, designMd: string) => request<DesignInfo>(`/projects/${id}/design`, { method: "PUT", body: JSON.stringify({ designMd }) }),
  generateDesignStrategy: (id: string) => request<any>(`/projects/${id}/design/generate`, { method: "POST" }),

  getSettings: () => request<any>("/settings")
};

export function mediaUrl(projectId: string, kind: "final" | "narration" | "captions" | `scene-preview-${string}`): string {
  return `/api/projects/${projectId}/media/${kind}`;
}

export function subscribeJobEvents(jobId: string, onEvent: (e: any) => void): () => void {
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (msg) => {
    try {
      onEvent(JSON.parse(msg.data));
    } catch {
      /* ignore malformed event */
    }
  };
  return () => source.close();
}
