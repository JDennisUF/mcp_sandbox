# How to Use Your MCP Server

Your MCP server is now running! Here are the different ways you can interact with it:

## 🔧 **Method 1: Direct JSON-RPC Testing**

Your server accepts JSON-RPC requests via stdin/stdout. Here are example requests:

### List Available Tools
```json
{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
```

### Call the `say_hello` Tool
```json
{"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "say_hello", "arguments": {"name": "Alice"}}}
```

### Call the `get_server_info` Tool
```json
{"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "get_server_info", "arguments": {}}}
```

## 🤖 **Method 2: Integrate with AI Assistants**

### **Claude Desktop Integration**
1. Add this to your Claude Desktop MCP configuration:
```json
{
  "mcpServers": {
    "hello-world": {
      "command": "node",
      "args": ["/home/jasondennis/code/mcp_sandbox/phase1-fundamentals/dist/index.js"]
    }
  }
}
```

### **Other MCP Clients**
- Your server works with any MCP-compatible client
- Use the same configuration format with the path to your compiled server

## 🧪 **Method 3: Test with Our Built-in Test Script**

Run the test script that demonstrates all functionality:
```bash
npm test
```

## 🔌 **Method 4: Build Your Own Client**

Create a simple Node.js script to interact with your server:

```javascript
import { spawn } from 'child_process';

// Start the server
const server = spawn('node', ['dist/index.js'], { 
  stdio: ['pipe', 'pipe', 'pipe'] 
});

// Send a request
const request = {
  jsonrpc: "2.0", 
  id: 1, 
  method: "tools/list", 
  params: {}
};

server.stdin.write(JSON.stringify(request) + '\n');

// Listen for response
server.stdout.on('data', (data) => {
  console.log('Response:', JSON.parse(data.toString()));
});
```

## 🚀 **What Your Server Can Do Right Now**

### Available Tools:
1. **`say_hello`**
   - Takes a `name` parameter
   - Returns a personalized greeting with timestamp
   - Example: "Hello, Alice! 👋 Welcome to your first MCP server!"

2. **`get_server_info`**
   - No parameters needed
   - Returns server metadata and runtime info
   - Shows uptime, version, capabilities

### Example Responses:
Your server returns structured responses like:
```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      {
        "type": "text",
        "text": "Hello, World! 👋 Welcome to your first MCP server!\n\nGreeting sent at: 10/27/2025, 10:30:00 AM"
      }
    ]
  }
}
```

## 🎯 **Real-World Usage Scenarios**

### **Development Assistant**
- Integrate with your IDE or AI assistant
- Use tools for code generation, file operations, etc.

### **Automation Hub**
- Connect multiple services through MCP tools
- Build workflows that leverage different capabilities

### **AI Enhancement**
- Give AI assistants access to your custom tools
- Extend AI capabilities with your domain-specific knowledge

## ⚡ **Quick Test Right Now**

Want to see it in action immediately? Open another terminal and try:

```bash
# In a new terminal, send a request to your running server
echo '{"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}' | nc localhost 8080
```

Or use our test script:
```bash
npm test
```

Your MCP server is live and ready to enhance AI assistants with your custom tools! 🎉