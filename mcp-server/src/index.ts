
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  RequestSchema,
  Resource,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import * as fs from "fs/promises";
import * as path from "path";

const serverInfo = {
  name: "documentation-resource-server",
  version: "1.0.0",
  description: "A server that provides documentation as MCP resources.",
};

const BaseParamsSchema = (RequestSchema.shape.params as z.ZodOptional<z.ZodObject<any>>).unwrap();

const ListResourcesRequestSchema = RequestSchema.extend({
  method: z.literal("resources/list"),
  params: BaseParamsSchema.extend({
    cursor: z.string().optional(),
    limit: z.number().optional(),
  }).optional(),
});

const GetResourceRequestSchema = RequestSchema.extend({
  method: z.literal("resources/read"),
  params: BaseParamsSchema.extend({
    uri: z.string(),
  }),
});

const docsDir = path.join(process.cwd(), "docs");

async function getMarkdownFiles(): Promise<string[]> {
  try {
    const files = await fs.readdir(docsDir);
    return files.filter((file) => file.endsWith(".md"));
  } catch (error) {
    console.error("Error reading docs directory:", error);
    return [];
  }
}

async function run() {
  const server = new Server(serverInfo, {
    capabilities: {
      resources: {},
    },
  });

  server.setRequestHandler(ListResourcesRequestSchema, async () => {
    const files = await getMarkdownFiles();
    const resources: Resource[] = files.map((file) => ({
      uri: `docs:/${file}`,
      name: file,
      description: `The content of the ${file} documentation file.`,
    }));
    return { resources };
  });

  server.setRequestHandler(GetResourceRequestSchema, async (request) => {
    const uri = request.params.uri as string;
    if (!uri.startsWith("docs:/")) {
      return {
        error: {
          code: -32602,
          message: "Invalid resource URI",
        },
      };
    }

    const fileName = uri.substring("docs:/".length);
    const filePath = path.join(docsDir, fileName);

    try {
      const content = await fs.readFile(filePath, "utf-8");
      return {
        content: [
          {
            type: "text",
            text: content,
          },
        ],
      };
    } catch (error) {
      return {
        error: {
          code: -32000,
          message: `Resource not found: ${uri}`,
        },
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.log("Documentation resource server started.");
}

run();
