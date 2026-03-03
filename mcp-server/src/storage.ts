import Database from "better-sqlite3";
import { mkdirSync, copyFileSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { homedir } from "node:os";

const DATA_DIR = path.join(homedir(), ".eyecheck");
const DB_PATH = path.join(DATA_DIR, "eyecheck.db");
const IMAGES_DIR = path.join(DATA_DIR, "images");

let db: Database.Database | null = null;

// Baseline row type
export interface BaselineRow {
  id: number;
  name: string;
  url: string | null;
  selector: string | null;
  viewport_width: number;
  viewport_height: number;
  image_path: string;
  image_hash: string;
  created_at: string;
  updated_at: string;
}

// Comparison row type
export interface ComparisonRow {
  id: number;
  baseline_id: number;
  test_image_path: string;
  diff_image_path: string | null;
  ssim_score: number | null;
  diff_pixels: number | null;
  diff_percentage: number | null;
  passed: number | null;
  issues_json: string | null;
  created_at: string;
}

export function initDb(): Database.Database {
  mkdirSync(DATA_DIR, { recursive: true });
  mkdirSync(IMAGES_DIR, { recursive: true });

  db = new Database(DB_PATH);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

  db.exec(`
    CREATE TABLE IF NOT EXISTS baselines (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      url TEXT,
      selector TEXT,
      viewport_width INTEGER NOT NULL,
      viewport_height INTEGER NOT NULL,
      image_path TEXT NOT NULL,
      image_hash TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE(name, viewport_width, viewport_height)
    );

    CREATE TABLE IF NOT EXISTS comparisons (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      baseline_id INTEGER REFERENCES baselines(id),
      test_image_path TEXT NOT NULL,
      diff_image_path TEXT,
      ssim_score REAL,
      diff_pixels INTEGER,
      diff_percentage REAL,
      passed INTEGER,
      issues_json TEXT,
      created_at TEXT NOT NULL
    );
  `);

  return db;
}

export function getDb(): Database.Database {
  if (!db) throw new Error("Database not initialized. Call initDb() first.");
  return db;
}

function hashFile(filePath: string): string {
  const data = readFileSync(filePath);
  return createHash("sha256").update(data).digest("hex");
}

export function saveBaseline(
  name: string,
  url: string | null,
  selector: string | null,
  viewport: { width: number; height: number },
  sourcePath: string,
): BaselineRow {
  const d = getDb();
  const now = new Date().toISOString();

  // Copy image to persistent storage
  const baselineDir = path.join(IMAGES_DIR, name);
  mkdirSync(baselineDir, { recursive: true });
  const imagePath = path.join(baselineDir, `${viewport.width}x${viewport.height}.png`);
  copyFileSync(sourcePath, imagePath);

  const imageHash = hashFile(imagePath);

  const stmt = d.prepare(`
    INSERT INTO baselines (name, url, selector, viewport_width, viewport_height, image_path, image_hash, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(name, viewport_width, viewport_height) DO UPDATE SET
      url = excluded.url,
      selector = excluded.selector,
      image_path = excluded.image_path,
      image_hash = excluded.image_hash,
      updated_at = excluded.updated_at
  `);

  stmt.run(name, url, selector, viewport.width, viewport.height, imagePath, imageHash, now, now);

  return d.prepare(
    "SELECT * FROM baselines WHERE name = ? AND viewport_width = ? AND viewport_height = ?"
  ).get(name, viewport.width, viewport.height) as BaselineRow;
}

export function getBaseline(
  name: string,
  viewport?: { width: number; height: number },
): BaselineRow | undefined {
  const d = getDb();
  if (viewport) {
    return d.prepare(
      "SELECT * FROM baselines WHERE name = ? AND viewport_width = ? AND viewport_height = ?"
    ).get(name, viewport.width, viewport.height) as BaselineRow | undefined;
  }
  return d.prepare(
    "SELECT * FROM baselines WHERE name = ? ORDER BY updated_at DESC LIMIT 1"
  ).get(name) as BaselineRow | undefined;
}

export function listBaselines(): BaselineRow[] {
  return getDb().prepare("SELECT * FROM baselines ORDER BY updated_at DESC").all() as BaselineRow[];
}

export function getLatestBaseline(): BaselineRow | undefined {
  return getDb().prepare(
    "SELECT * FROM baselines ORDER BY updated_at DESC LIMIT 1"
  ).get() as BaselineRow | undefined;
}

export function saveComparison(
  baselineId: number,
  testImagePath: string,
  diffImagePath: string | null,
  result: {
    ssim_score: number;
    diff_pixels: number;
    diff_percentage: number;
    passed: boolean;
  },
  issuesJson?: string,
): ComparisonRow {
  const d = getDb();
  const now = new Date().toISOString();
  const stmt = d.prepare(`
    INSERT INTO comparisons (baseline_id, test_image_path, diff_image_path, ssim_score, diff_pixels, diff_percentage, passed, issues_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const info = stmt.run(
    baselineId,
    testImagePath,
    diffImagePath,
    result.ssim_score,
    result.diff_pixels,
    result.diff_percentage,
    result.passed ? 1 : 0,
    issuesJson ?? null,
    now,
  );
  return d.prepare("SELECT * FROM comparisons WHERE id = ?").get(info.lastInsertRowid) as ComparisonRow;
}

export function getHistory(baselineId: number, limit = 20): ComparisonRow[] {
  return getDb().prepare(
    "SELECT * FROM comparisons WHERE baseline_id = ? ORDER BY created_at DESC LIMIT ?"
  ).all(baselineId, limit) as ComparisonRow[];
}

export function getLatestComparison(): ComparisonRow | undefined {
  return getDb().prepare(
    "SELECT * FROM comparisons ORDER BY created_at DESC LIMIT 1"
  ).get() as ComparisonRow | undefined;
}
