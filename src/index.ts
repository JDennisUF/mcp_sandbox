#!/usr/bin/env node

/**
 * Phase 4: Prompt Templates MCP Server
 *
 * Provides rich prompt definitions with argument validation and context-aware rendering.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { RequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

/**
 * Prompt modelling
 */
type PromptMessage = {
  role: 'system' | 'user' | 'assistant';
  content: Array<{ type: 'text'; text: string }>;
};

type PromptArgument = {
  name: string;
  description: string;
  required?: boolean;
  defaultValue?: string;
  enumValues?: string[];
};

type PromptContext = {
  project?: {
    name?: string;
    description?: string;
    techStack?: string[];
    recentChanges?: string[];
  };
  user?: {
    name?: string;
    email?: string;
    role?: string;
  };
};

type PromptDefinition = {
  name: string;
  description: string;
  tags: string[];
  arguments: PromptArgument[];
  build: (args: Record<string, string>, context?: PromptContext) => PromptMessage[];
};

/**
 * Schema helpers derived from the base Request schema exported by the SDK.
 */
const BaseParamsSchema = (RequestSchema.shape.params as z.ZodOptional<z.ZodObject<any>>).unwrap();

const PromptContextSchema = z
  .object({
    project: z
      .object({
        name: z.string().optional(),
        description: z.string().optional(),
        techStack: z.array(z.string()).optional(),
        recentChanges: z.array(z.string()).optional(),
      })
      .optional(),
    user: z
      .object({
        name: z.string().optional(),
        email: z.string().optional(),
        role: z.string().optional(),
      })
      .optional(),
  })
  .optional();

const ListPromptsParamsSchema = BaseParamsSchema.extend({
  tags: z.array(z.string()).optional(),
  search: z.string().optional(),
});

const GetPromptParamsSchema = BaseParamsSchema.extend({
  name: z.string(),
  arguments: z.record(z.string(), z.any()).optional(),
  context: PromptContextSchema,
});

type ListPromptsParams = {
  tags?: string[];
  search?: string;
};

type GetPromptParams = {
  name: string;
  arguments?: Record<string, unknown>;
  context?: PromptContext;
};

const ListPromptsRequestSchema = RequestSchema.extend({
  method: z.literal('prompts/list'),
  params: ListPromptsParamsSchema.optional(),
});

const GetPromptRequestSchema = RequestSchema.extend({
  method: z.literal('prompts/get'),
  params: GetPromptParamsSchema,
});

/**
 * Prompt catalogue
 */
const PROMPTS: PromptDefinition[] = [
  {
    name: 'code-review-checklist',
    description: 'Generate a focused code review checklist for a change set.',
    tags: ['code-review', 'quality'],
    arguments: [
      {
        name: 'changeSummary',
        description: 'One to two sentence summary of the change.',
        required: true,
      },
      {
        name: 'riskAreas',
        description: 'Comma-separated areas that are risky or complex.',
      },
      {
        name: 'testCoverage',
        description: 'Existing test coverage notes.',
      },
    ],
    build: (args, context) => {
      const projectLabel = context?.project?.name ? `Project: ${context.project.name}\n` : '';
      const tech = context?.project?.techStack?.length
        ? `Tech stack: ${context.project.techStack.join(', ')}\n`
        : '';
      const recent = context?.project?.recentChanges?.length
        ? `Recent changes:\n- ${context.project.recentChanges.join('\n- ')}\n\n`
        : '';

      return [
        createTextMessage(
          'system',
          'You are an experienced software reviewer. Produce concise, actionable review checkpoints.'
        ),
        createTextMessage(
          'user',
          `${projectLabel}${tech}${recent}` +
            `Change summary:\n${args.changeSummary}\n\n` +
            `${args.riskAreas ? `Areas of concern: ${args.riskAreas}\n\n` : ''}` +
            `${args.testCoverage ? `Test coverage notes: ${args.testCoverage}\n\n` : ''}` +
            'Provide a checklist of review questions grouped by theme. Highlight any missing tests or documentation.'
        ),
      ];
    },
  },
  {
    name: 'test-plan-writer',
    description: 'Create a pragmatic test plan for a new capability or bug fix.',
    tags: ['testing', 'planning'],
    arguments: [
      {
        name: 'featureName',
        description: 'Name of the feature or bug fix under test.',
        required: true,
      },
      {
        name: 'acceptanceCriteria',
        description: 'Acceptance criteria or expected outcomes.',
        required: true,
      },
      {
        name: 'constraints',
        description: 'Environment or data limitations to consider.',
      },
      {
        name: 'level',
        description: 'Primary testing level focus (unit, integration, e2e).',
        defaultValue: 'integration',
        enumValues: ['unit', 'integration', 'e2e'],
      },
    ],
    build: (args, context) => {
      const owner = context?.user?.name ? `Primary contact: ${context.user.name}\n\n` : '';
      const description = context?.project?.description
        ? `Project context: ${context.project.description}\n\n`
        : '';

      return [
        createTextMessage(
          'system',
          'You are a senior QA engineer. Produce a thorough yet lean test plan focusing on risk-based testing.'
        ),
        createTextMessage(
          'user',
          `${owner}${description}` +
            `Feature: ${args.featureName}\n` +
            `Testing level: ${args.level}\n\n` +
            `Acceptance criteria:\n${formatBullets(args.acceptanceCriteria)}\n\n` +
            `${args.constraints ? `Constraints to respect: ${args.constraints}\n\n` : ''}` +
            'Outline recommended test scenarios, data needs, and automation opportunities. Call out risks and open questions.'
        ),
      ];
    },
  },
  {
    name: 'pr-summary',
    description: 'Summarise a pull request for reviewers with key highlights and risks.',
    tags: ['communication', 'summaries'],
    arguments: [
      {
        name: 'diffSummary',
        description: 'High-level summary of code or behavior changes.',
        required: true,
      },
      {
        name: 'breakingChanges',
        description: 'List breaking changes, if any.',
      },
      {
        name: 'openQuestions',
        description: 'Open questions that reviewers should weigh in on.',
      },
    ],
    build: (args, context) => {
      const productName = context?.project?.name ?? 'this project';
      return [
        createTextMessage(
          'system',
          'You help engineers communicate updates clearly. Produce a crisp summary optimised for reviewers.'
        ),
        createTextMessage(
          'user',
          `Prepare a pull request summary for ${productName}.\n\n` +
            `Diff summary:\n${args.diffSummary}\n\n` +
            `${args.breakingChanges ? `Breaking changes: ${formatBullets(args.breakingChanges)}\n\n` : ''}` +
            `${args.openQuestions ? `Reviewer questions: ${formatBullets(args.openQuestions)}\n\n` : ''}` +
            'Structure the response with: Overview, Testing, Risks, and Review Requests sections.'
        ),
      ];
    },
  },
  {
    name: 'root-cause-investigator',
    description: 'Guide a debugging session by proposing hypotheses and next diagnostic steps.',
    tags: ['debugging', 'analysis'],
    arguments: [
      {
        name: 'symptoms',
        description: 'Observed symptoms or error messages.',
        required: true,
      },
      {
        name: 'recentChanges',
        description: 'Recent deployments or config changes.',
      },
      {
        name: 'logs',
        description: 'Pertinent log excerpts or metrics.',
      },
    ],
    build: (args, context) => {
      const environment = context?.project?.techStack?.length
        ? `Environment context: ${context.project.techStack.join(', ')}\n\n`
        : '';

      return [
        createTextMessage(
          'system',
          'You are a pragmatic incident commander. Identify likely root causes and propose the next investigative actions.'
        ),
        createTextMessage(
          'user',
          `${environment}` +
            `Symptoms observed:\n${formatBullets(args.symptoms)}\n\n` +
            `${args.recentChanges ? `Recent changes: ${formatBullets(args.recentChanges)}\n\n` : ''}` +
            `${args.logs ? `Log excerpts:\n${args.logs}\n\n` : ''}` +
            'Provide: 1) Leading hypotheses with rationale, 2) High-value diagnostics to run, 3) Mitigation ideas if the issue escalates.'
        ),
      ];
    },
  },
];

const PROMPTS_BY_NAME = new Map(PROMPTS.map((prompt) => [prompt.name, prompt]));

/**
 * Utilities
 */
function createTextMessage(role: PromptMessage['role'], text: string): PromptMessage {
  return {
    role,
    content: [
      {
        type: 'text',
        text,
      },
    ],
  };
}

function formatBullets(input: string): string {
  const trimmed = input.trim();
  if (!trimmed.includes('\n') && !trimmed.includes('-') && !trimmed.includes('*') && !trimmed.includes(',')) {
    return `- ${trimmed}`;
  }

  if (trimmed.includes('\n')) {
    return trimmed
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => (line.startsWith('-') ? line : `- ${line}`))
      .join('\n');
  }

  return trimmed
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => `- ${part}`)
    .join('\n');
}

function resolveArguments(definition: PromptDefinition, provided?: Record<string, unknown>): Record<string, string> {
  const resolved: Record<string, string> = {};

  for (const arg of definition.arguments) {
    const raw = provided?.[arg.name];
    const effective = raw ?? arg.defaultValue;

    if (effective === undefined || effective === null || effective === '') {
      if (arg.required) {
        throw new Error(`Missing required argument: ${arg.name}`);
      }
      continue;
    }

    const stringValue = typeof effective === 'string' ? effective : JSON.stringify(effective);

    if (arg.enumValues && !arg.enumValues.includes(stringValue)) {
      throw new Error(
        `Invalid value for ${arg.name}. Allowed values: ${arg.enumValues.join(', ')}`
      );
    }

    resolved[arg.name] = stringValue;
  }

  return resolved;
}

function promptArgumentMetadata(arg: PromptArgument) {
  return {
    name: arg.name,
    description: arg.description,
    required: Boolean(arg.required),
    default: arg.defaultValue,
    enum: arg.enumValues,
  };
}

/**
 * Server bootstrap
 */
async function main() {
  const server = new Server(
    {
      name: 'prompt-mcp-server',
      version: '1.0.0',
      description: 'Provides curated prompt templates for software delivery workflows.',
    },
    {
      capabilities: {
        prompts: {},
      },
      instructions:
        'Use prompts/list to discover available templates. Use prompts/get with arguments to materialise a ready-to-send message sequence.',
    }
  );

  server.setRequestHandler(ListPromptsRequestSchema, async (request) => {
    const filters = request.params
      ? (ListPromptsParamsSchema.parse(request.params) as ListPromptsParams)
      : ({} as ListPromptsParams);
    const searchLower = filters.search?.toLowerCase();
    const tags = filters.tags;

    const prompts = PROMPTS.filter((prompt) => {
      const matchesTag = !tags || tags.every((tag) => prompt.tags.includes(tag));
      const matchesSearch = !searchLower
        ? true
        : prompt.name.toLowerCase().includes(searchLower) ||
          prompt.description.toLowerCase().includes(searchLower) ||
          prompt.tags.some((tag) => tag.toLowerCase().includes(searchLower));
      return matchesTag && matchesSearch;
    }).map((prompt) => ({
      name: prompt.name,
      description: prompt.description,
      arguments: prompt.arguments.map(promptArgumentMetadata),
      metadata: {
        tags: prompt.tags,
      },
    }));

    return { prompts };
  });

  server.setRequestHandler(GetPromptRequestSchema, async (request) => {
    const { name, arguments: providedArgs, context } = GetPromptParamsSchema.parse(
      request.params
    ) as GetPromptParams;
    const prompt = PROMPTS_BY_NAME.get(name);

    if (!prompt) {
      return {
        error: {
          code: -32602,
          message: `Prompt not found: ${name}`,
        },
      };
    }

    const resolvedArgs = resolveArguments(prompt, providedArgs);
    const validatedContext = context ? PromptContextSchema.parse(context) : undefined;
    const messages = prompt.build(resolvedArgs, validatedContext);

    return {
      prompt: {
        name: prompt.name,
        description: prompt.description,
        arguments: prompt.arguments.map(promptArgumentMetadata),
        messages,
        metadata: {
          tags: prompt.tags,
          providedArguments: resolvedArgs,
        },
      },
    };
  });

  server.onerror = (error) => {
    console.error('[Prompt MCP Server Error]', error);
  };

  const transport = new StdioServerTransport();
  console.error('Prompt MCP Server starting...');
  console.error('Available prompts:', PROMPTS.map((prompt) => prompt.name).join(', '));
  await server.connect(transport);
  console.error('Prompt MCP Server is running.');
}

main().catch((error) => {
  console.error('Failed to start Prompt MCP Server:', error);
  process.exit(1);
});
