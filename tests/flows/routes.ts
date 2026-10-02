/**
 * Every route and page in the app, read from src/app at test time, so the
 * sweeps cover a new feature the day it's added.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const APP = join(__dirname, '..', '..', 'src', 'app');
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
export type Method = (typeof METHODS)[number];

export interface Route {
  /** e.g. /api/leads/[id]/notes */
  path: string;
  file: string;
  methods: Method[];
}

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

/** The URL path of a folder under src/app: route groups dropped, segments kept as written. */
function urlOf(dir: string): string {
  const parts = relative(APP, dir).split(sep).filter((s) => s && !/^\(.*\)$/.test(s));
  return '/' + parts.join('/');
}

const files = walk(APP);

export const ROUTES: Route[] = files
  .filter((f) => /[/\\]route\.tsx?$/.test(f))
  .map((file) => {
    const src = readFileSync(file, 'utf8');
    const methods = METHODS.filter((m) =>
      new RegExp(`export\\s+(async\\s+)?(function|const)\\s+${m}\\b`).test(src) ||
      new RegExp(`export\\s*\\{[^}]*\\b${m}\\b[^}]*\\}`).test(src),
    );
    return { path: urlOf(join(file, '..')), file: relative(join(APP, '..', '..'), file), methods };
  })
  .sort((a, b) => a.path.localeCompare(b.path));

export const PAGES: string[] = files
  .filter((f) => /[/\\]page\.tsx?$/.test(f))
  .map((f) => urlOf(join(f, '..')))
  .sort();

/** Fill dynamic segments: [id] → a value, [...slug] / [[...slug]] → one segment. */
export function fill(path: string, value = '00000000-0000-4000-8000-000000000000'): string {
  return path.replace(/\[\[?\.\.\.[^\]]+\]?\]/g, 'x').replace(/\[[^\]]+\]/g, value);
}
