#!/usr/bin/env node

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { access } from 'node:fs/promises';

const execFileAsync = promisify(execFile);

type CollectContextArgs = {
  workingDirectory?: string;
  includeGitStatus: boolean;
  includeRecentCommits: boolean;
  recentCommitLimit: number;
};

type DiffSource = 'staged' | 'working';

type DiffInsightsArgs = {
  workingDirectory?: string;
  source: DiffSource;
  paths?: string[];
  includePatch: boolean;
  maxPatchLines: number;
};

type HeuristicArgs = {
  workingDirectory?: string;
  source: DiffSource;
  paths?: string[];
  largeFileThreshold: number;
  requireTestsForCode: boolean;
  includePatchContextLines: number;
  warnOnConfigChanges: boolean;
};

type RepoStatus = {
  branch?: string;
  upstream?: string;
  ahead?: number;
  behind?: number;
  staged: Array<{ status: string; path: string }>;
  unstaged: Array<{ status: string; path: string }>;
  untracked: string[];
  conflicts: Array<{ path: string; detail: string }>;
};

type RepoContext = {
  repositoryRoot: string;
  status?: RepoStatus;
  recentCommits?: Array<{ hash: string; author: string; relativeDate: string; summary: string }>;
};

type DiffFileChange = {
  path: string;
  changeType: string;
  additions: number | null;
  deletions: number | null;
  isBinary: boolean;
  previousPath?: string;
  patch?: string;
};

type DiffInsights = {
  repositoryRoot: string;
  source: DiffSource;
  fileCount: number;
  totalAdditions: number;
  totalDeletions: number;
  files: DiffFileChange[];
};

type FindingSeverity = 'info' | 'warn' | 'critical';
type FindingCategory = 'testing' | 'risk' | 'dependencies' | 'maintenance' | 'general';

type ReviewFinding = {
  id: string;
  category: FindingCategory;
  severity: FindingSeverity;
  summary: string;
  details: string;
  affectedFiles: string[];
  recommendation?: string;
};

type HeuristicReport = {
  repositoryRoot: string;
  source: DiffSource;
  metrics: {
    fileCount: number;
    totalAdditions: number;
    totalDeletions: number;
    largeFiles: number;
    binaryFiles: number;
    codeFiles: number;
    testFiles: number;
  };
  findings: ReviewFinding[];
  suggestions: string[];
  diff: DiffInsights;
};

const collectContextInputSchema = {
  workingDirectory: z
    .string()
    .min(1)
    .describe('Absolute or relative path whose repository context should be analysed.')
    .optional(),
  includeGitStatus: z
    .boolean()
    .default(true)
    .describe('Include branch summary and staged/unstaged file breakdown.'),
  includeRecentCommits: z
    .boolean()
    .default(false)
    .describe('Attach a compact list of recent commits.'),
  recentCommitLimit: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(5)
    .describe('Number of commits to include when includeRecentCommits is true.'),
};

const diffInsightsInputSchema = {
  workingDirectory: z
    .string()
    .min(1)
    .describe('Absolute or relative path whose repository diff should be analysed.')
    .optional(),
  source: z
    .enum(['staged', 'working'] as const)
    .default('staged')
    .describe("Select staged (index) or working tree diff against HEAD."),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .describe('Optional subset of paths to diff. Defaults to all changed files.')
    .optional(),
  includePatch: z
    .boolean()
    .default(false)
    .describe('Include a truncated patch excerpt per file.'),
  maxPatchLines: z
    .number()
    .int()
    .min(10)
    .max(2000)
    .default(400)
    .describe('Maximum number of patch lines retained when includePatch is true.'),
};

const runHeuristicsInputSchema = {
  workingDirectory: z
    .string()
    .min(1)
    .describe('Absolute or relative path whose repository heuristics should run against.')
    .optional(),
  source: z
    .enum(['staged', 'working'] as const)
    .default('staged')
    .describe('Analyse staged/index diff or working tree vs HEAD.'),
  paths: z
    .array(z.string().min(1))
    .min(1)
    .describe('Optional subset of paths to focus on. Defaults to all changed files.')
    .optional(),
  largeFileThreshold: z
    .number()
    .int()
    .min(50)
    .max(5000)
    .default(400)
    .describe('Total added+deleted line count per file above which a warning is emitted.'),
  requireTestsForCode: z
    .boolean()
    .default(true)
    .describe('Warn when code changes lack accompanying test modifications.'),
  includePatchContextLines: z
    .number()
    .int()
    .min(50)
    .max(2000)
    .default(400)
    .describe('Patch context retained for heuristic inspection and output.'),
  warnOnConfigChanges: z
    .boolean()
    .default(true)
    .describe('Elevate configuration / dependency file edits to explicit findings.'),
};

async function main() {
  const server = new McpServer(
    {
      name: 'code-review-mcp-server',
      version: '0.2.0',
      description: 'VS Code-oriented MCP server providing code review diagnostics.',
    },
    {
      instructions:
        'Use code-review.collect-context first to gather git details, then follow-up tools for heuristics and guidance as they are introduced.',
    }
  );

  server.registerTool(
    'code-review.collect-context',
    {
      title: 'Collect repository review context',
      description: 'Gather branch, status, and recent history for the active Git repository.',
      inputSchema: collectContextInputSchema,
    },
    async (rawArgs) => {
      const args = normalizeCollectContextArgs(rawArgs);

      try {
        const cwd = await resolveWorkingDirectory(args.workingDirectory);
        const repoRoot = await detectRepositoryRoot(cwd);

        const context: RepoContext = {
          repositoryRoot: repoRoot,
        };

        if (args.includeGitStatus) {
          context.status = await gatherGitStatus(repoRoot);
        }

        if (args.includeRecentCommits) {
          context.recentCommits = await gatherRecentCommits(repoRoot, args.recentCommitLimit);
        }

        const summary = formatSummary(context, args);

        return {
          content: [
            {
              type: 'text',
              text: summary,
            },
            {
              type: 'text',
              text: JSON.stringify(context, null, 2),
            },
          ],
          structuredContent: context,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text',
              text: `code-review.collect-context failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'code-review.diff-insights',
    {
      title: 'Summarise repository diffs',
      description: 'Summarise file changes, churn, and optional patch excerpts for staged or working tree diffs.',
      inputSchema: diffInsightsInputSchema,
    },
    async (rawArgs) => {
      const args = normalizeDiffInsightsArgs(rawArgs);

      try {
        const cwd = await resolveWorkingDirectory(args.workingDirectory);
        const repoRoot = await detectRepositoryRoot(cwd);
        const insights = await gatherDiffInsights(repoRoot, args);
        const summary = formatDiffSummary(insights);

        const content = [
          {
            type: 'text' as const,
            text: summary,
          },
        ];

        if (args.includePatch) {
          const patchText = buildPatchAppendix(insights);
          if (patchText) {
            content.push({ type: 'text' as const, text: patchText });
          }
        }

        return {
          content,
          structuredContent: insights,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `code-review.diff-insights failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  server.registerTool(
    'code-review.run-heuristics',
    {
      title: 'Evaluate review heuristics',
      description:
        'Apply opinionated checks (missing tests, large changes, config edits) on the current diff to guide human reviewers.',
      inputSchema: runHeuristicsInputSchema,
    },
    async (rawArgs) => {
      const args = normalizeHeuristicArgs(rawArgs);

      try {
        const cwd = await resolveWorkingDirectory(args.workingDirectory);
        const repoRoot = await detectRepositoryRoot(cwd);
        const diffArgs: DiffInsightsArgs = {
          workingDirectory: repoRoot,
          source: args.source,
          paths: args.paths,
          includePatch: true,
          maxPatchLines: args.includePatchContextLines,
        };

        const diff = await gatherDiffInsights(repoRoot, diffArgs);
        const report = evaluateHeuristics(diff, args);
        const summary = formatHeuristicSummary(report);

        return {
          content: [
            {
              type: 'text' as const,
              text: summary,
            },
            {
              type: 'text' as const,
              text: JSON.stringify(report, null, 2),
            },
          ],
          structuredContent: report,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return {
          content: [
            {
              type: 'text' as const,
              text: `code-review.run-heuristics failed: ${message}`,
            },
          ],
          isError: true,
        };
      }
    }
  );

  const transport = new StdioServerTransport();
  console.error('Code Review MCP server starting...');
  await server.connect(transport);
  console.error(
    'Code Review MCP server ready. Registered tools: code-review.collect-context, code-review.diff-insights, code-review.run-heuristics'
  );
}

function normalizeCollectContextArgs(raw: Partial<CollectContextArgs> | undefined): CollectContextArgs {
  return {
    workingDirectory: raw?.workingDirectory,
    includeGitStatus: raw?.includeGitStatus ?? true,
    includeRecentCommits: raw?.includeRecentCommits ?? false,
    recentCommitLimit: raw?.recentCommitLimit ?? 5,
  };
}

function normalizeDiffInsightsArgs(raw: Partial<DiffInsightsArgs> | undefined): DiffInsightsArgs {
  return {
    workingDirectory: raw?.workingDirectory,
    source: raw?.source ?? 'staged',
    paths: raw?.paths,
    includePatch: raw?.includePatch ?? false,
    maxPatchLines: raw?.maxPatchLines ?? 400,
  };
}

function normalizeHeuristicArgs(raw: Partial<HeuristicArgs> | undefined): HeuristicArgs {
  return {
    workingDirectory: raw?.workingDirectory,
    source: raw?.source ?? 'staged',
    paths: raw?.paths,
    largeFileThreshold: raw?.largeFileThreshold ?? 400,
    requireTestsForCode: raw?.requireTestsForCode ?? true,
    includePatchContextLines: raw?.includePatchContextLines ?? 400,
    warnOnConfigChanges: raw?.warnOnConfigChanges ?? true,
  };
}

async function resolveWorkingDirectory(requested?: string): Promise<string> {
  if (!requested) {
    return process.cwd();
  }

  const candidate = path.isAbsolute(requested)
    ? requested
    : path.resolve(process.cwd(), requested);

  await access(candidate);
  return candidate;
}

async function detectRepositoryRoot(cwd: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { cwd });
  return stdout.trim();
}

async function gatherGitStatus(cwd: string): Promise<RepoStatus> {
  const { stdout } = await execFileAsync('git', ['status', '--short', '--branch'], { cwd });
  const lines = stdout.split('\n').map((line) => line.trimEnd()).filter(Boolean);

  const status: RepoStatus = {
    staged: [],
    unstaged: [],
    untracked: [],
    conflicts: [],
  };

  for (const line of lines) {
    if (line.startsWith('## ')) {
      parseBranchHeader(line.slice(3), status);
      continue;
    }

    if (line.startsWith('??')) {
      status.untracked.push(line.slice(3).trim());
      continue;
    }

    const changeCode = line.slice(0, 2);
    const filePath = line.slice(3).trim();
    const [stageStatus, worktreeStatus] = changeCode.split('');

    if (stageStatus === 'U' || worktreeStatus === 'U') {
      status.conflicts.push({ path: filePath, detail: changeCode });
      continue;
    }

    if (stageStatus !== ' ' && stageStatus !== '?') {
      status.staged.push({ status: stageStatus, path: filePath });
    }

    if (worktreeStatus !== ' ') {
      status.unstaged.push({ status: worktreeStatus, path: filePath });
    }
  }

  return status;
}

function parseBranchHeader(header: string, status: RepoStatus) {
  const [headAndUpstream, aheadBehind] = header.split(' [');
  const [head, upstream] = headAndUpstream.split('...');

  if (head && head !== '(no branch)') {
    status.branch = head;
  }

  if (upstream) {
    status.upstream = upstream;
  }

  if (aheadBehind) {
    const cleaned = aheadBehind.replace(']', '');
    for (const token of cleaned.split(', ')) {
      if (token.startsWith('ahead ')) {
        status.ahead = Number.parseInt(token.slice('ahead '.length), 10);
      }
      if (token.startsWith('behind ')) {
        status.behind = Number.parseInt(token.slice('behind '.length), 10);
      }
    }
  }
}

async function gatherRecentCommits(cwd: string, limit: number) {
  const format = '%H\t%an\t%ar\t%s';
  const { stdout } = await execFileAsync('git', ['log', `-n${limit}`, `--pretty=format:${format}`], { cwd });
  return stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hash, author, relativeDate, summary] = line.split('\t');
      return {
        hash,
        author,
        relativeDate,
        summary,
      };
    });
}

function formatSummary(context: RepoContext, args: CollectContextArgs): string {
  const parts: string[] = [];
  parts.push(`Repository root: ${context.repositoryRoot}`);

  if (args.includeGitStatus && context.status) {
    const status = context.status;
    parts.push(
      `Branch: ${status.branch ?? 'detached'}${
        status.upstream ? ` (tracking ${status.upstream})` : ''
      }`
    );

    if (status.ahead || status.behind) {
      parts.push(
        `Sync: ${status.ahead ?? 0} ahead / ${status.behind ?? 0} behind relative to upstream.`
      );
    }

    parts.push(`Staged: ${formatChangeList(status.staged)}`);
    parts.push(`Unstaged: ${formatChangeList(status.unstaged)}`);
    parts.push(`Untracked: ${status.untracked.length ? status.untracked.join(', ') : 'none'}`);

    if (status.conflicts.length) {
      parts.push(
        `Conflicts: ${status.conflicts
          .map((conflict) => `${conflict.detail} ${conflict.path}`)
          .join(', ')}`
      );
    }
  }

  if (args.includeRecentCommits && context.recentCommits?.length) {
    parts.push('Recent commits:');
    for (const commit of context.recentCommits) {
      parts.push(`- ${commit.relativeDate} · ${commit.author}: ${commit.summary} (${commit.hash.slice(0, 8)})`);
    }
  }

  return parts.join('\n');
}

function formatChangeList(entries: Array<{ status: string; path: string }>): string {
  if (!entries.length) {
    return 'none';
  }

  return entries.map((entry) => `${entry.status} ${entry.path}`).join(', ');
}

async function gatherDiffInsights(repoRoot: string, args: DiffInsightsArgs): Promise<DiffInsights> {
  const nameStatus = await runGitDiff(repoRoot, args, ['--name-status']);
  const numstat = await runGitDiff(repoRoot, args, ['--numstat']);

  const changeTypeMap = parseNameStatus(nameStatus);
  const numstatEntries = parseNumstat(numstat);

  const files = mergeDiffData(changeTypeMap, numstatEntries, args);
  const totals = files.reduce(
    (acc, file) => {
      if (typeof file.additions === 'number') {
        acc.additions += file.additions;
      }
      if (typeof file.deletions === 'number') {
        acc.deletions += file.deletions;
      }
      return acc;
    },
    { additions: 0, deletions: 0 }
  );

  if (args.includePatch) {
    const patchText = await runGitDiff(repoRoot, args, ['--patch', '--unified=3']);
    attachPatchSnippets(files, patchText, args.maxPatchLines);
  }

  return {
    repositoryRoot: repoRoot,
    source: args.source,
    fileCount: files.length,
    totalAdditions: totals.additions,
    totalDeletions: totals.deletions,
    files,
  };
}

async function runGitDiff(repoRoot: string, args: DiffInsightsArgs, extraFlags: string[]): Promise<string> {
  const base = ['diff'];
  if (args.source === 'staged') {
    base.push('--cached');
  }

  base.push('--no-color', '--no-ext-diff', ...extraFlags);

  if (args.paths?.length) {
    base.push('--', ...args.paths);
  }

  const { stdout } = await execFileAsync('git', base, { cwd: repoRoot, maxBuffer: 10 * 1024 * 1024 });
  return stdout;
}

function parseNameStatus(raw: string): Map<string, { changeType: string; previousPath?: string }> {
  const map = new Map<string, { changeType: string; previousPath?: string }>();
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const [type, ...pathParts] = line.trim().split('\t');
    if (!type) {
      continue;
    }

    if (type.startsWith('R') || type.startsWith('C')) {
      const previousPath = pathParts[0];
      const newPath = pathParts[1] ?? previousPath;
      if (!newPath) {
        continue;
      }
      map.set(newPath, { changeType: type, previousPath });
    } else {
      const targetPath = pathParts[0];
      if (!targetPath) {
        continue;
      }
      map.set(targetPath, { changeType: type });
    }
  }
  return map;
}

function parseNumstat(raw: string) {
  const entries: Array<{
    additions: number | null;
    deletions: number | null;
    path: string;
    previousPath?: string;
  }> = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) {
      continue;
    }
    const parts = line.trim().split('\t');
    const additionsRaw = parts[0];
    const deletionsRaw = parts[1];
    const rest = parts.slice(2);
    const path = rest.pop();
    const previousPath = rest.length ? rest.join('\t') : undefined;
    if (!path) {
      continue;
    }
    const additions = additionsRaw === '-' ? null : Number.parseInt(additionsRaw, 10) || 0;
    const deletions = deletionsRaw === '-' ? null : Number.parseInt(deletionsRaw, 10) || 0;
    entries.push({ additions, deletions, path, previousPath });
  }
  return entries;
}

function mergeDiffData(
  changeTypeMap: Map<string, { changeType: string; previousPath?: string }>,
  numstatEntries: Array<{
    additions: number | null;
    deletions: number | null;
    path: string;
    previousPath?: string;
  }>,
  args: DiffInsightsArgs
): DiffFileChange[] {
  const fileMap = new Map<string, DiffFileChange>();

  for (const { path, additions, deletions, previousPath } of numstatEntries) {
    const changeInfo = changeTypeMap.get(path);
    fileMap.set(path, {
      path,
      changeType: changeInfo?.changeType ?? inferChangeType(additions, deletions),
      additions,
      deletions,
      isBinary: additions === null || deletions === null,
      previousPath: changeInfo?.previousPath ?? previousPath,
    });
  }

  for (const [path, info] of changeTypeMap.entries()) {
    if (fileMap.has(path)) {
      continue;
    }
    fileMap.set(path, {
      path,
      changeType: info.changeType,
      additions: 0,
      deletions: 0,
      isBinary: true,
      previousPath: info.previousPath,
    });
  }

  const files = [...fileMap.values()].sort((a, b) => a.path.localeCompare(b.path));

  if (args.paths?.length) {
    const filter = new Set(args.paths.map((p) => normalizePathForComparison(p)));
    return files.filter((file) => filter.has(normalizePathForComparison(file.path)));
  }

  return files;
}

function inferChangeType(additions: number | null, deletions: number | null): string {
  if (additions === 0 && deletions === 0) {
    return 'M';
  }
  if (additions !== null && deletions === null) {
    return 'A';
  }
  return 'M';
}

function attachPatchSnippets(files: DiffFileChange[], rawPatch: string, maxLines: number) {
  if (!rawPatch.trim()) {
    return;
  }

  const segments = splitUnifiedDiff(rawPatch);
  for (const segment of segments) {
    const key = normalizePathForComparison(segment.keyPath);
    const file = files.find((f) => {
      if (normalizePathForComparison(f.path) === key) {
        return true;
      }
      if (f.previousPath && normalizePathForComparison(f.previousPath) === key) {
        return true;
      }
      return false;
    });
    if (!file) {
      continue;
    }
    const lines = segment.patch.split('\n');
    if (lines.length > maxLines) {
      file.patch = `${lines.slice(0, maxLines).join('\n')}\n… (truncated)`;
    } else {
      file.patch = segment.patch;
    }
  }
}

function splitUnifiedDiff(rawPatch: string): Array<{ keyPath: string; label: string; patch: string }> {
  const results: Array<{ keyPath: string; label: string; patch: string }> = [];
  const diffRegex = /^diff --git a\/(.+?) b\/(.+?)\n([\s\S]*?)(?=^diff --git |\s*$)/gm;
  let match: RegExpExecArray | null;

  while ((match = diffRegex.exec(rawPatch)) !== null) {
    const [, oldPath, newPath, body] = match;
    const label = oldPath === newPath ? newPath : `${oldPath} -> ${newPath}`;
    results.push({
      keyPath: newPath,
      label,
      patch: `diff --git a/${oldPath} b/${newPath}\n${body.trimStart()}`,
    });
  }

  return results;
}

function formatDiffSummary(insights: DiffInsights): string {
  const lines: string[] = [];
  lines.push(
    `Diff source: ${insights.source === 'staged' ? 'staged changes' : 'working tree'} at ${insights.repositoryRoot}`
  );
  lines.push(
    `Files changed: ${insights.fileCount}, total additions: ${insights.totalAdditions}, total deletions: ${insights.totalDeletions}`
  );

  for (const file of insights.files) {
    const displayPath = file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path;
    const churn = file.isBinary
      ? 'binary file'
      : `+${file.additions ?? 0} / -${file.deletions ?? 0}`;
    lines.push(`- ${file.changeType.padEnd(2)} ${displayPath} (${churn})`);
  }

  return lines.join('\n');
}

function buildPatchAppendix(insights: DiffInsights): string | undefined {
  const patches = insights.files
    .filter((file) => file.patch)
    .map((file) => {
      const label = file.previousPath ? `${file.previousPath} -> ${file.path}` : file.path;
      return `### ${label}\n${file.patch}`;
    });

  if (!patches.length) {
    return undefined;
  }

  return ['## Patch excerpts', ...patches].join('\n\n');
}

function normalizePathForComparison(p: string): string {
  return path.posix.normalize(p.replace(/\\/g, '/'));
}

function evaluateHeuristics(diff: DiffInsights, args: HeuristicArgs): HeuristicReport {
  const findings: ReviewFinding[] = [];
  const codeFiles = diff.files.filter(isCodeFileChange);
  const testFiles = diff.files.filter(isTestFileChange);
  const binaryFiles = diff.files.filter((file) => file.isBinary);
  const largeFiles = diff.files.filter((file) => !file.isBinary && totalChurn(file) >= args.largeFileThreshold);
  const configFiles = diff.files.filter(isConfigChange);

  if (largeFiles.length) {
    findings.push({
      id: 'large-files',
      category: 'risk',
      severity: 'warn',
      summary: `${largeFiles.length} file(s) exceed the ${args.largeFileThreshold} line churn threshold`,
      details: largeFiles
        .map(
          (file) =>
            `${file.path}: +${file.additions ?? 0} / -${file.deletions ?? 0} (${totalChurn(file)} lines total)`
        )
        .join('\n'),
      affectedFiles: largeFiles.map((file) => file.path),
      recommendation: 'Consider breaking up the change or highlighting key areas for reviewers.',
    });
  }

  if (args.requireTestsForCode && codeFiles.length && !testFiles.length) {
    findings.push({
      id: 'missing-tests',
      category: 'testing',
      severity: 'warn',
      summary: 'Code changes detected without corresponding test updates',
      details:
        'At least one source file changed, but no files matching common test naming patterns were modified.',
      affectedFiles: codeFiles.map((file) => file.path),
      recommendation: 'Add or update tests covering the changed behaviour, or document why tests are not required.',
    });
  }

  if (args.warnOnConfigChanges && configFiles.length) {
    findings.push({
      id: 'config-edits',
      category: 'dependencies',
      severity: 'info',
      summary: 'Configuration or dependency files were modified',
      details: configFiles.map((file) => file.path).join('\n'),
      affectedFiles: configFiles.map((file) => file.path),
      recommendation:
        'Ensure reviewers understand the impact of configuration changes and confirm lockfiles remain consistent.',
    });
  }

  if (binaryFiles.length) {
    findings.push({
      id: 'binary-files',
      category: 'maintenance',
      severity: 'info',
      summary: `${binaryFiles.length} binary file(s) changed`,
      details: binaryFiles.map((file) => file.path).join('\n'),
      affectedFiles: binaryFiles.map((file) => file.path),
      recommendation: 'Verify binary assets are intentional and document update rationale.',
    });
  }

  const suggestions = deriveSuggestions(findings, diff);

  return {
    repositoryRoot: diff.repositoryRoot,
    source: diff.source,
    metrics: {
      fileCount: diff.fileCount,
      totalAdditions: diff.totalAdditions,
      totalDeletions: diff.totalDeletions,
      largeFiles: largeFiles.length,
      binaryFiles: binaryFiles.length,
      codeFiles: codeFiles.length,
      testFiles: testFiles.length,
    },
    findings,
    suggestions,
    diff,
  };
}

function totalChurn(file: DiffFileChange): number {
  return (file.additions ?? 0) + (file.deletions ?? 0);
}

function isCodeFileChange(file: DiffFileChange): boolean {
  const ext = path.extname(file.path).toLowerCase();
  if (!ext) {
    return false;
  }
  const codeExtensions = new Set([
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.mjs',
    '.cjs',
    '.py',
    '.java',
    '.kt',
    '.go',
    '.rs',
    '.cpp',
    '.c',
    '.cs',
    '.rb',
    '.php',
    '.swift',
  ]);
  return codeExtensions.has(ext) && !isTestFileChange(file);
}

function isTestFileChange(file: DiffFileChange): boolean {
  const normalized = normalizePathForComparison(file.path);
  return (
    normalized.includes('/test/') ||
    normalized.includes('/tests/') ||
    normalized.includes('/__tests__/') ||
    /\.test\.[^.]+$/.test(normalized) ||
    /\.spec\.[^.]+$/.test(normalized) ||
    normalized.endsWith('-test.ts') ||
    normalized.endsWith('-spec.ts')
  );
}

function isConfigChange(file: DiffFileChange): boolean {
  const basename = path.basename(file.path);
  const configNames = new Set([
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
    'tsconfig.json',
    'pyproject.toml',
    'requirements.txt',
    'go.mod',
    'go.sum',
    'pom.xml',
    'build.gradle',
    'Dockerfile',
  ]);
  if (configNames.has(basename)) {
    return true;
  }
  if (basename.endsWith('.env') || basename.endsWith('.env.example')) {
    return true;
  }
  const normalized = normalizePathForComparison(file.path);
  return (
    normalized.startsWith('.github/workflows/') ||
    normalized.includes('/config/') ||
    normalized.includes('/configs/') ||
    normalized.includes('/infrastructure/')
  );
}

function deriveSuggestions(findings: ReviewFinding[], diff: DiffInsights): string[] {
  const suggestions: string[] = [];
  if (!findings.length) {
    suggestions.push('No heuristic findings detected. Proceed with focused manual review.');
  }
  if (!diff.fileCount) {
    suggestions.push('Diff is empty. Confirm you staged or saved the desired changes.');
  }
  const hasLarge = findings.some((f) => f.id === 'large-files');
  if (hasLarge) {
    suggestions.push('Highlight the riskiest regions in review description or break up the PR.');
  }
  const missingTests = findings.some((f) => f.id === 'missing-tests');
  if (missingTests) {
    suggestions.push('Add regression tests or document why tests are not applicable.');
  }
  return suggestions;
}

function formatHeuristicSummary(report: HeuristicReport): string {
  const lines: string[] = [];
  lines.push(
    `Heuristic scan for ${
      report.source === 'staged' ? 'staged changes' : 'working tree'
    } at ${report.repositoryRoot}`
  );
  lines.push(
    `Files: ${report.metrics.fileCount}, churn +${report.metrics.totalAdditions} / -${report.metrics.totalDeletions}`
  );
  lines.push(
    `Code files: ${report.metrics.codeFiles}, tests: ${report.metrics.testFiles}, binary: ${report.metrics.binaryFiles}`
  );

  if (!report.findings.length) {
    lines.push('No heuristic findings.');
  } else {
    lines.push('Findings:');
    for (const finding of report.findings) {
      lines.push(`- [${finding.severity.toUpperCase()}] ${finding.summary}`);
    }
  }

  if (report.suggestions.length) {
    lines.push('\nNext steps:');
    for (const suggestion of report.suggestions) {
      lines.push(`- ${suggestion}`);
    }
  }

  return lines.join('\n');
}

main().catch((error) => {
  console.error('Failed to start Code Review MCP server:', error);
  process.exit(1);
});
