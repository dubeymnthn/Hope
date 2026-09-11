import { existsSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, resolve, sep } from "node:path";

/**
 * The ONLY place that turns a `projectId` from the network into a filesystem path.
 * Every route goes through here (via middleware/project-guard.ts) rather than building
 * its own path from request input (spec V2.4 §42 "local file safety").
 */

const PROJECT_ID_PATTERN = /^[a-z0-9-]+$/;
const ROOT_PROJECT_ID = "root";

export class InvalidProjectIdError extends Error {
  constructor(id: string) {
    super(`Invalid or unknown project id: "${id}"`);
    this.name = "InvalidProjectIdError";
  }
}

export function repoRoot(): string {
  // studio/server/services -> repo root is three levels up.
  return resolve(import.meta.dirname, "..", "..", "..");
}

function topicsDir(): string {
  return join(repoRoot(), "topics");
}

/** Same slugify rule as src/cli.ts, duplicated (small, established pattern in this codebase). */
export function slugify(topic: string): string {
  return (
    topic
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 60) || "documentary"
  );
}

function looksLikeWorkspace(dir: string): boolean {
  return (
    existsSync(join(dir, "pipeline-state.json")) ||
    existsSync(join(dir, "research")) ||
    existsSync(join(dir, "script")) ||
    existsSync(join(dir, "final.mp4"))
  );
}

/** Lists every real project id this server will serve: topics/<slug> plus the legacy root workspace, if either look like a real workspace. */
export function listProjectIds(): string[] {
  const ids: string[] = [];
  const td = topicsDir();
  if (existsSync(td)) {
    for (const entry of readdirSync(td, { withFileTypes: true })) {
      if (entry.isDirectory() && PROJECT_ID_PATTERN.test(entry.name) && looksLikeWorkspace(join(td, entry.name))) {
        ids.push(entry.name);
      }
    }
  }
  if (looksLikeWorkspace(repoRoot())) ids.push(ROOT_PROJECT_ID);
  return ids;
}

/**
 * Resolves a project id to its workspace directory. Rejects anything that is not a
 * bare `[a-z0-9-]+` segment (no `..`, no path separators, no absolute paths) and
 * anything that does not resolve to a real, existing workspace directory.
 */
export function resolveProjectDir(id: string): string {
  if (typeof id !== "string" || !PROJECT_ID_PATTERN.test(id)) {
    throw new InvalidProjectIdError(id);
  }
  if (id === ROOT_PROJECT_ID) {
    const dir = repoRoot();
    if (!looksLikeWorkspace(dir)) throw new InvalidProjectIdError(id);
    return dir;
  }
  const dir = resolve(topicsDir(), id);
  // Defence in depth: resolve() collapses `..` segments, so re-check the result is
  // still literally inside topicsDir() before trusting it.
  if (!dir.startsWith(topicsDir() + sep) || !existsSync(dir) || !looksLikeWorkspace(dir)) {
    throw new InvalidProjectIdError(id);
  }
  return dir;
}

/** Creates a brand-new topics/<slug> workspace directory for `topic`, returning its id. Never overwrites an existing project. */
export function createProjectWorkspace(topic: string): { id: string; dir: string } {
  const base = slugify(topic);
  let id = base;
  let n = 2;
  while (existsSync(join(topicsDir(), id))) {
    id = `${base}-${n}`;
    n++;
  }
  const dir = join(topicsDir(), id);
  mkdirSync(dir, { recursive: true });
  return { id, dir };
}

export function lastModified(dir: string): string {
  try {
    return statSync(dir).mtime.toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}
