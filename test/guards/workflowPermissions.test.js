/**
 * Guard: GitHub Actions workflows declare explicit GITHUB_TOKEN permissions.
 *
 * Without an explicit `permissions:` block, GITHUB_TOKEN inherits the
 * repository/org default permissions, which triggers CodeQL's
 * `actions/missing-workflow-permissions` alert.
 *
 * Every workflow in `.github/workflows/` MUST either:
 * - declare a top-level `permissions:` block (least-privilege default), OR
 * - declare a `permissions:` block on every job under `jobs:`.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..', '..');
const WORKFLOWS_DIR = path.join(ROOT, '.github', 'workflows');

function stripYamlComment(line) {
  let inSingle = false;
  let inDouble = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (ch === "'" && !inDouble) inSingle = !inSingle;
    else if (ch === '"' && !inSingle) inDouble = !inDouble;
    else if (ch === '#' && !inSingle && !inDouble && (i === 0 || /\s/.test(line[i - 1]))) {
      return line.slice(0, i);
    }
  }
  return line;
}

/**
 * Find jobs in a workflow YAML that lack an explicit `permissions:` block
 * when the workflow itself has no top-level `permissions:` block.
 *
 * @param {string} yamlText
 * @param {string} file
 * @returns {Array<{file: string, job: string | null, reason: string}>}
 */
function checkWorkflowPermissions(yamlText, file) {
  const lines = yamlText
    .split(/\r?\n/)
    .map((raw) => stripYamlComment(raw).replace(/\s+$/, ''))
    .filter((line) => line.trim().length > 0);

  const hasTopLevelPermissions = lines.some((line) => /^permissions\s*:/.test(line));
  if (hasTopLevelPermissions) return [];

  const jobsIndex = lines.findIndex((line) => /^jobs\s*:/.test(line));
  if (jobsIndex === -1) {
    return [{ file, job: null, reason: 'missing top-level permissions block' }];
  }

  let jobIndent = null;
  let propIndent = null;
  let currentJob = null;
  const jobs = [];

  for (let i = jobsIndex + 1; i < lines.length; i += 1) {
    const line = lines[i];
    const indent = line.match(/^ */)[0].length;
    if (indent === 0) break; // Next top-level key

    if (jobIndent === null) jobIndent = indent;

    if (indent === jobIndent) {
      const match = line.trim().match(/^([a-zA-Z0-9_-]+)\s*:/);
      if (match) {
        currentJob = { name: match[1], hasPermissions: false };
        jobs.push(currentJob);
        propIndent = null;
      }
      continue;
    }

    if (currentJob && indent > jobIndent) {
      if (propIndent === null) propIndent = indent;
      if (indent === propIndent && /^permissions\s*:/.test(line.trim())) {
        currentJob.hasPermissions = true;
      }
    }
  }

  const missingJobs = jobs.filter((job) => !job.hasPermissions);
  if (jobs.length === 0) {
    return [{ file, job: null, reason: 'missing top-level permissions block' }];
  }

  return missingJobs.map((job) => ({
    file,
    job: job.name,
    reason: `job '${job.name}' is missing an explicit permissions block`,
  }));
}

function listWorkflowFiles() {
  return fs.readdirSync(WORKFLOWS_DIR)
    .filter((name) => name.endsWith('.yml') || name.endsWith('.yaml'))
    .map((name) => `.github/workflows/${name}`);
}

describe('guard: GitHub Actions workflows declare explicit permissions', () => {
  const workflowFiles = listWorkflowFiles();

  it('scans all workflow files in .github/workflows/', () => {
    expect(workflowFiles.length).toBeGreaterThan(0);
    expect(workflowFiles).toEqual(expect.arrayContaining([
      '.github/workflows/ci.yml',
      '.github/workflows/release.yml',
      '.github/workflows/dependabot-auto-merge.yml',
    ]));
  });

  it('has explicit permissions on every workflow or job', () => {
    const violations = workflowFiles.flatMap((file) => (
      checkWorkflowPermissions(fs.readFileSync(path.join(ROOT, file), 'utf8'), file)
    ));

    if (violations.length > 0) {
      const details = violations.map((v) => `  ${v.file}: ${v.reason}`).join('\n');
      throw new Error(
        'GitHub Actions workflows must declare explicit GITHUB_TOKEN permissions:\n' + details,
      );
    }
  });

  describe('the scanner', () => {
    it('passes when top-level permissions are declared', () => {
      const yaml = `
name: CI
on: [push]
permissions:
  contents: read
jobs:
  test:
    runs-on: ubuntu-latest
`;
      expect(checkWorkflowPermissions(yaml, 'ci.yml')).toEqual([]);
    });

    it('passes when every job declares permissions', () => {
      const yaml = `
name: CI
on: [push]
jobs:
  test:
    permissions:
      contents: read
    runs-on: ubuntu-latest
  release:
    permissions:
      contents: write
    runs-on: ubuntu-latest
`;
      expect(checkWorkflowPermissions(yaml, 'ci.yml')).toEqual([]);
    });

    it('reports jobs missing permissions when no top-level permissions exist', () => {
      const yaml = `
name: CI
on: [push]
jobs:
  test:
    runs-on: ubuntu-latest
  release:
    permissions:
      contents: write
    runs-on: ubuntu-latest
`;
      const findings = checkWorkflowPermissions(yaml, 'ci.yml');
      expect(findings).toHaveLength(1);
      expect(findings[0].job).toBe('test');
    });

    it('ignores commented-out permissions', () => {
      const yaml = `
name: CI
on: [push]
# permissions:
#   contents: read
jobs:
  test:
    runs-on: ubuntu-latest
`;
      const findings = checkWorkflowPermissions(yaml, 'ci.yml');
      expect(findings).toHaveLength(1);
      expect(findings[0].job).toBe('test');
    });
  });
});
