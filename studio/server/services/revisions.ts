import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicWriteJson } from "./atomic-write.js";
import { repoRoot } from "./workspace.js";

/**
 * A lightweight, linear (not branching) undo/redo revision log per project (spec V2.4
 * §32-33: "not a heavyweight Git-like system"). Lives at `studio/revisions/`, outside
 * every topic workspace, so it never collides with pipeline artifacts or gitignore rules.
 * Every edit-producing route in this server goes through `editArtifactWithRevision`
 * rather than writing artifacts directly, so every edit is autosaved AND undoable.
 */

interface RevisionEntry {
  revisionId: string;
  timestamp: string;
  artifactPath: string; // relative to the project dir
  description: string;
  hadBefore: boolean;
}
interface RevisionLog {
  cursor: number;
  entries: RevisionEntry[];
}

function revisionsRoot(): string {
  return join(repoRoot(), "studio", "revisions");
}
function logPath(projectId: string): string {
  return join(revisionsRoot(), `${projectId}.json`);
}
function snapshotDir(projectId: string): string {
  return join(revisionsRoot(), projectId);
}
function snapshotPath(projectId: string, revisionId: string, which: "before" | "after"): string {
  return join(snapshotDir(projectId), `${revisionId}.${which}`);
}

function loadLog(projectId: string): RevisionLog {
  const p = logPath(projectId);
  if (!existsSync(p)) return { cursor: 0, entries: [] };
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return { cursor: 0, entries: [] };
  }
}
function saveLog(projectId: string, log: RevisionLog): void {
  atomicWriteJson(logPath(projectId), log);
}

export function listRevisions(projectId: string): { entries: RevisionEntry[]; cursor: number } {
  const log = loadLog(projectId);
  return { entries: log.entries, cursor: log.cursor };
}

/**
 * Reads `<projectDir>/artifactRelPath` (or null if absent), lets `mutate` produce the new
 * content, atomically writes it, and records a revision (truncating any redo-able future
 * past the current cursor, exactly like a normal editor's undo stack after a fresh edit).
 */
export function editArtifactWithRevision<T>(
  projectId: string,
  projectDir: string,
  artifactRelPath: string,
  description: string,
  mutate: (current: T | null) => T
): T {
  const absPath = join(projectDir, artifactRelPath);
  const beforeText = existsSync(absPath) ? readFileSync(absPath, "utf-8") : null;
  const beforeParsed: T | null = beforeText ? JSON.parse(beforeText) : null;

  const after = mutate(beforeParsed);
  atomicWriteJson(absPath, after);

  const log = loadLog(projectId);
  log.entries = log.entries.slice(0, log.cursor); // drop stale redo branch
  const revisionId = randomUUID();
  mkdirSync(snapshotDir(projectId), { recursive: true });
  if (beforeText !== null) writeFileSync(snapshotPath(projectId, revisionId, "before"), beforeText, "utf-8");
  writeFileSync(snapshotPath(projectId, revisionId, "after"), JSON.stringify(after, null, 2), "utf-8");
  log.entries.push({ revisionId, timestamp: new Date().toISOString(), artifactPath: artifactRelPath, description, hadBefore: beforeText !== null });
  log.cursor = log.entries.length;
  saveLog(projectId, log);

  return after;
}

export function undo(projectId: string, projectDir: string): RevisionEntry | null {
  const log = loadLog(projectId);
  if (log.cursor <= 0) return null;
  const entry = log.entries[log.cursor - 1];
  const absPath = join(projectDir, entry.artifactPath);
  if (entry.hadBefore) {
    const before = readFileSync(snapshotPath(projectId, entry.revisionId, "before"), "utf-8");
    atomicWriteJson(absPath, JSON.parse(before));
  } else if (existsSync(absPath)) {
    unlinkSync(absPath);
  }
  log.cursor -= 1;
  saveLog(projectId, log);
  return entry;
}

export function redo(projectId: string, projectDir: string): RevisionEntry | null {
  const log = loadLog(projectId);
  if (log.cursor >= log.entries.length) return null;
  const entry = log.entries[log.cursor];
  const absPath = join(projectDir, entry.artifactPath);
  const after = readFileSync(snapshotPath(projectId, entry.revisionId, "after"), "utf-8");
  atomicWriteJson(absPath, JSON.parse(after));
  log.cursor += 1;
  saveLog(projectId, log);
  return entry;
}
