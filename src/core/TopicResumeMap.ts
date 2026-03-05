/**
 * TopicResumeMap — Persistent mapping from Telegram topic IDs to Claude session UUIDs.
 *
 * Before killing an idle interactive session, the system persists the Claude
 * session UUID so it can be resumed when the next message arrives on that topic.
 * This avoids cold-starting sessions (rebuilding context from topic history)
 * and provides seamless conversational continuity.
 *
 * Storage: {stateDir}/topic-resume-map.json
 * Entries auto-prune after 24 hours.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

interface ResumeEntry {
  uuid: string;
  savedAt: string;
  sessionName: string;
}

interface ResumeMap {
  [topicId: string]: ResumeEntry;
}

/** Entries older than 24 hours are pruned */
const MAX_AGE_MS = 24 * 60 * 60 * 1000;

export class TopicResumeMap {
  private filePath: string;
  private projectDir: string;

  constructor(stateDir: string, projectDir: string) {
    this.filePath = path.join(stateDir, 'topic-resume-map.json');
    this.projectDir = projectDir;
  }

  /**
   * Discover the Claude session UUID from the most recent JSONL file
   * in the project's .claude/projects/ directory.
   */
  findClaudeSessionUuid(): string | null {
    const homeDir = os.homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

    if (!fs.existsSync(claudeProjectsDir)) return null;

    // Claude Code hashes the project path to create the project directory name.
    // We need to find the right project directory.
    try {
      const projectDirs = fs.readdirSync(claudeProjectsDir);
      let latestFile: { path: string; mtime: number } | null = null;

      for (const dir of projectDirs) {
        const fullDir = path.join(claudeProjectsDir, dir);
        const stat = fs.statSync(fullDir);
        if (!stat.isDirectory()) continue;

        // Look for JSONL files in this project dir
        const files = fs.readdirSync(fullDir);
        for (const file of files) {
          if (!file.endsWith('.jsonl')) continue;
          const filePath = path.join(fullDir, file);
          try {
            const fileStat = fs.statSync(filePath);
            if (!latestFile || fileStat.mtimeMs > latestFile.mtime) {
              latestFile = { path: filePath, mtime: fileStat.mtimeMs };
            }
          } catch {
            // Skip inaccessible files
          }
        }
      }

      if (!latestFile) return null;

      // Extract UUID from filename (format: {uuid}.jsonl)
      const basename = path.basename(latestFile.path, '.jsonl');
      // Validate UUID format (8-4-4-4-12)
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(basename)) {
        return basename;
      }
    } catch {
      // Silent failure — can't read Claude projects dir
    }

    return null;
  }

  /**
   * Find the Claude session UUID for a specific tmux session by checking
   * which JSONL file was most recently modified while that session was active.
   *
   * Uses a heuristic: the most recently modified JSONL in the project's
   * Claude directory is likely the one belonging to the active session.
   * For more accuracy, we could parse JSONL content, but mtime is sufficient.
   */
  findUuidForSession(tmuxSession: string): string | null {
    // The session's project dir is this.projectDir.
    // Claude Code creates project dirs by hashing the absolute path.
    return this.findClaudeSessionUuid();
  }

  /**
   * Persist a resume mapping before killing an idle session.
   */
  save(topicId: number, uuid: string, sessionName: string): void {
    const map = this.load();

    map[String(topicId)] = {
      uuid,
      savedAt: new Date().toISOString(),
      sessionName,
    };

    // Prune old entries
    const now = Date.now();
    for (const key of Object.keys(map)) {
      const entry = map[key];
      if (now - new Date(entry.savedAt).getTime() > MAX_AGE_MS) {
        delete map[key];
      }
    }

    try {
      fs.writeFileSync(this.filePath, JSON.stringify(map, null, 2));
    } catch (err) {
      console.error(`[TopicResumeMap] Failed to save: ${err}`);
    }
  }

  /**
   * Look up a resume UUID for a topic. Returns null if not found,
   * expired, or the JSONL file no longer exists.
   */
  get(topicId: number): string | null {
    const map = this.load();
    const entry = map[String(topicId)];
    if (!entry) return null;

    // Check age
    if (Date.now() - new Date(entry.savedAt).getTime() > MAX_AGE_MS) {
      return null;
    }

    // Verify the JSONL file still exists
    if (!this.jsonlExists(entry.uuid)) {
      return null;
    }

    return entry.uuid;
  }

  /**
   * Remove an entry after successful resume (prevents stale reuse).
   */
  remove(topicId: number): void {
    const map = this.load();
    delete map[String(topicId)];
    try {
      fs.writeFileSync(this.filePath, JSON.stringify(map, null, 2));
    } catch {
      // Best effort
    }
  }

  private load(): ResumeMap {
    try {
      if (fs.existsSync(this.filePath)) {
        return JSON.parse(fs.readFileSync(this.filePath, 'utf-8'));
      }
    } catch {
      // Corrupted file — start fresh
    }
    return {};
  }

  /**
   * Check if a JSONL file exists for the given UUID.
   */
  private jsonlExists(uuid: string): boolean {
    const homeDir = os.homedir();
    const claudeProjectsDir = path.join(homeDir, '.claude', 'projects');

    if (!fs.existsSync(claudeProjectsDir)) return false;

    try {
      const projectDirs = fs.readdirSync(claudeProjectsDir);
      for (const dir of projectDirs) {
        const jsonlPath = path.join(claudeProjectsDir, dir, `${uuid}.jsonl`);
        if (fs.existsSync(jsonlPath)) return true;
      }
    } catch {
      // Can't check — assume not found
    }

    return false;
  }
}
