import { FabricError } from './fabric-error'

export abstract class MCPError extends FabricError {
  readonly httpStatus = 500
}

export class McpToolError extends MCPError {
  readonly code = 'mcp_tool_error'
}
