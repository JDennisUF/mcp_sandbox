#!/usr/bin/env node

/**
 * Simple MCP Server Test
 * 
 * This script provides a simple way to test our MCP server by running it
 * and demonstrating how to interact with it manually.
 */

import { spawn } from 'child_process';
import { writeFileSync, readFileSync } from 'fs';

console.log('🧪 MCP Hello World Server Test\n');

console.log('This test will:');
console.log('  1. Start the MCP server');
console.log('  2. Show you how to interact with it');
console.log('  3. Provide example MCP requests\n');

console.log('🚀 Starting MCP server...\n');

// Start our server
const serverProcess = spawn('node', ['dist/index.js'], {
  cwd: '/home/jasondennis/code/mcp_sandbox/phase1-fundamentals',
  stdio: ['pipe', 'pipe', 'inherit'],
});

console.log('✅ MCP server is running!\n');

console.log('📋 Example MCP Requests:\n');

// Example 1: List tools
console.log('1. List available tools:');
console.log('   Request: {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}');
console.log('');

// Example 2: Call say_hello tool
console.log('2. Call say_hello tool:');
console.log('   Request: {"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "say_hello", "arguments": {"name": "World"}}}');
console.log('');

// Example 3: Call get_server_info tool
console.log('3. Call get_server_info tool:');
console.log('   Request: {"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_server_info", "arguments": {}}}');
console.log('');

console.log('💡 How to test:');
console.log('   1. The server is listening on stdin/stdout');
console.log('   2. You can send JSON-RPC requests to test it');
console.log('   3. Or integrate it with an MCP client like Claude Desktop');
console.log('');

console.log('🔧 Integration Example (for MCP clients):');
console.log('   Add this to your MCP client configuration:');
console.log('   {');
console.log('     "mcpServers": {');
console.log('       "hello-world": {');
console.log('         "command": "node",');
console.log(`         "args": ["${process.cwd()}/dist/index.js"]`);
console.log('       }');
console.log('     }');
console.log('   }');
console.log('');

// Create a configuration file for easy use
const configExample = {
  mcpServers: {
    "hello-world": {
      command: "node",
      args: [`${process.cwd()}/dist/index.js`]
    }
  }
};

writeFileSync(
  '/home/jasondennis/code/mcp_sandbox/phase1-fundamentals/mcp-config-example.json',
  JSON.stringify(configExample, null, 2)
);

console.log('📝 Created mcp-config-example.json for easy integration!');
console.log('');

console.log('Press Ctrl+C to stop the server...\n');

// Handle cleanup
process.on('SIGINT', () => {
  console.log('\n🔌 Shutting down server...');
  serverProcess.kill();
  console.log('✅ Server stopped. Goodbye!');
  process.exit(0);
});

// Keep the process alive
setInterval(() => {}, 1000);