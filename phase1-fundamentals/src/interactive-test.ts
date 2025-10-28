#!/usr/bin/env node

/**
 * Interactive MCP Server Test
 * 
 * This script lets you interact with your running MCP server
 * by sending JSON-RPC requests and seeing the responses.
 */

import { spawn } from 'child_process';
import readline from 'readline';

console.log('🧪 Interactive MCP Server Test\n');

// Start the MCP server
console.log('Starting MCP server...');
const server = spawn('node', ['dist/index.js'], {
  cwd: '/home/jasondennis/code/mcp_sandbox/phase1-fundamentals',
  stdio: ['pipe', 'pipe', 'pipe']
});

let requestId = 1;

// Handle server output
server.stdout.on('data', (data) => {
  try {
    const response = JSON.parse(data.toString().trim());
    console.log('\n📨 Server Response:');
    console.log(JSON.stringify(response, null, 2));
    console.log('\n' + '='.repeat(50));
    showMenu();
  } catch (error) {
    console.log('Raw server output:', data.toString());
  }
});

server.stderr.on('data', (data) => {
  console.log('Server log:', data.toString());
});

// Create readline interface for user input
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function showMenu() {
  console.log('\nChoose an action:');
  console.log('1. List available tools');
  console.log('2. Say hello to someone');
  console.log('3. Get server info');
  console.log('4. Send custom JSON request');
  console.log('5. Exit');
  console.log('\nEnter your choice (1-5): ');
}

function sendRequest(request: any) {
  console.log('\n📤 Sending request:');
  console.log(JSON.stringify(request, null, 2));
  server.stdin.write(JSON.stringify(request) + '\n');
}

function handleUserInput(choice: string) {
  switch (choice.trim()) {
    case '1':
      sendRequest({
        jsonrpc: "2.0",
        id: requestId++,
        method: "tools/list",
        params: {}
      });
      break;
      
    case '2':
      rl.question('Enter a name to greet: ', (name) => {
        sendRequest({
          jsonrpc: "2.0",
          id: requestId++,
          method: "tools/call",
          params: {
            name: "say_hello",
            arguments: { name: name || "World" }
          }
        });
      });
      return;
      
    case '3':
      sendRequest({
        jsonrpc: "2.0",
        id: requestId++,
        method: "tools/call",
        params: {
          name: "get_server_info",
          arguments: {}
        }
      });
      break;
      
    case '4':
      console.log('Enter your JSON request (press Enter twice when done):');
      let jsonInput = '';
      const jsonRl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
      });
      
      jsonRl.on('line', (line) => {
        if (line.trim() === '' && jsonInput.trim() !== '') {
          try {
            const request = JSON.parse(jsonInput);
            sendRequest(request);
          } catch (error) {
            console.log('Invalid JSON:', error instanceof Error ? error.message : String(error));
            showMenu();
          }
          jsonRl.close();
        } else {
          jsonInput += line + '\n';
        }
      });
      return;
      
    case '5':
      console.log('\nShutting down...');
      server.kill();
      rl.close();
      process.exit(0);
      break;
      
    default:
      console.log('Invalid choice. Please enter 1-5.');
      showMenu();
      return;
  }
  
  // Listen for next input
  rl.question('', handleUserInput);
}

// Start the interactive session
console.log('✅ Server started! Ready for interaction.\n');
showMenu();
rl.question('', handleUserInput);

// Cleanup on exit
process.on('SIGINT', () => {
  console.log('\nShutting down...');
  server.kill();
  rl.close();
  process.exit(0);
});