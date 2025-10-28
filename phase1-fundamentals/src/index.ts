#!/usr/bin/env node

/**
 * Hello World MCP Server
 * 
 * This is your first MCP server! It demonstrates:
 * - Basic MCP server setup and configuration
 * - Server initialization and handshake
 * - Simple tool implementation
 * - Proper error handling
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  Tool,
} from '@modelcontextprotocol/sdk/types.js';

/**
 * Create and configure our MCP server
 */
class HelloWorldMCPServer {
  private server: Server;

  constructor() {
    // Initialize the MCP server with our server info
    this.server = new Server(
      {
        name: 'hello-world-mcp-server',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {}, // We support tools
        },
      }
    );

    this.setupToolHandlers();
    this.setupErrorHandling();
  }

  /**
   * Define the tools our server provides
   */
  private setupToolHandlers(): void {
    // Handle tool listing - tell clients what tools we have
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'say_hello',
            description: 'A simple greeting tool that says hello to someone',
            inputSchema: {
              type: 'object',
              properties: {
                name: {
                  type: 'string',
                  description: 'The name of the person to greet',
                },
              },
              required: ['name'],
            },
          } as Tool,
          {
            name: 'get_server_info',
            description: 'Get information about this MCP server',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          } as Tool,
        ],
      };
    });

    // Handle tool execution - actually run the tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        switch (name) {
          case 'say_hello':
            return await this.sayHello(args?.name as string);

          case 'get_server_info':
            return await this.getServerInfo();

          default:
            throw new Error(`Unknown tool: ${name}`);
        }
      } catch (error) {
        return {
          content: [
            {
              type: 'text',
              text: `Error executing tool ${name}: ${error instanceof Error ? error.message : String(error)}`,
            },
          ],
          isError: true,
        };
      }
    });
  }

  /**
   * Our first tool - say hello to someone
   */
  private async sayHello(name: string) {
    if (!name) {
      throw new Error('Name is required for greeting');
    }

    const greeting = `Hello, ${name}! 👋 Welcome to your first MCP server!`;
    const timestamp = new Date().toLocaleString();

    return {
      content: [
        {
          type: 'text',
          text: `${greeting}\n\nGreeting sent at: ${timestamp}`,
        },
      ],
    };
  }

  /**
   * Another tool - provide server information
   */
  private async getServerInfo() {
    const info = {
      serverName: 'hello-world-mcp-server',
      version: '1.0.0',
      capabilities: ['tools'],
      description: 'A simple Hello World MCP server for learning',
      toolsAvailable: ['say_hello', 'get_server_info'],
      uptime: process.uptime(),
    };

    return {
      content: [
        {
          type: 'text',
          text: `Server Information:\n${JSON.stringify(info, null, 2)}`,
        },
      ],
    };
  }

  /**
   * Set up error handling
   */
  private setupErrorHandling(): void {
    this.server.onerror = (error) => {
      console.error('[MCP Server Error]', error);
    };

    process.on('SIGINT', async () => {
      console.log('\nShutting down MCP server...');
      await this.server.close();
      process.exit(0);
    });
  }

  /**
   * Start the server
   */
  async start(): Promise<void> {
    // Use stdio transport (communication via stdin/stdout)
    const transport = new StdioServerTransport();
    
    console.error('Hello World MCP Server starting...');
    console.error('Server capabilities: tools');
    console.error('Available tools: say_hello, get_server_info');
    
    await this.server.connect(transport);
    console.error('MCP Server is running! 🚀');
  }
}

/**
 * Start the server if this file is run directly
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const server = new HelloWorldMCPServer();
  server.start().catch((error) => {
    console.error('Failed to start server:', error);
    process.exit(1);
  });
}