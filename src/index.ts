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

  const transport = new StdioServerTransport();
  console.error('Code Review MCP server starting...');
  await server.connect(transport);
  console.error('Code Review MCP server ready. Registered tools: code-review.collect-context');
}

function normalizeCollectContextArgs(raw: Partial<CollectContextArgs> | undefined): CollectContextArgs {
  return {
    workingDirectory: raw?.workingDirectory,
    includeGitStatus: raw?.includeGitStatus ?? true,
    includeRecentCommits: raw?.includeRecentCommits ?? false,
    recentCommitLimit: raw?.recentCommitLimit ?? 5,
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

main().catch((error) => {
  console.error('Failed to start Code Review MCP server:', error);
  process.exit(1);
});
