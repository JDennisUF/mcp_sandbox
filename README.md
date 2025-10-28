# Hello World MCP Server 👋

Your first MCP (Model Context Protocol) server! This server demonstrates the fundamental concepts you need to understand.

## What You're Learning

### 🏗️ **MCP Server Architecture**
- Server initialization and configuration
- Client-server handshake process
- Tool registration and execution
- Error handling and lifecycle management

### 🔧 **Tools Implementation**
This server provides two simple tools:

1. **`say_hello`** - Greets someone by name
   - Parameters: `name` (string, required)
   - Returns: Personalized greeting with timestamp

2. **`get_server_info`** - Returns server metadata
   - Parameters: None
   - Returns: Server details and runtime information

## Building and Running

```bash
# Build the TypeScript
npm run build

# Run the server
npm start

# Or build and run in one command
npm run dev
```

## Key MCP Concepts Demonstrated

### 1. **Server Setup**
```typescript
const server = new Server(serverInfo, capabilities);
```

### 2. **Tool Registration**
```typescript
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return { tools: [...] };
});
```

### 3. **Tool Execution**
```typescript
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  // Handle tool calls
});
```

### 4. **Transport Layer**
```typescript
const transport = new StdioServerTransport();
await server.connect(transport);
```

## What's Next?

After running this server, you'll understand:
- ✅ How MCP servers are structured
- ✅ How to define and implement tools
- ✅ How client-server communication works
- ✅ Basic error handling patterns

Ready for **Phase 2: Tools Deep Dive**? We'll build more complex tools with validation, async operations, and real-world integrations!