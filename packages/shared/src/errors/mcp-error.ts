import { FabricError } from './fabric-error.js'

export abstract class MCPError extends FabricError {
  abstract readonly httpStatus: number
}

export class McpToolError extends MCPError {
  readonly code = 'mcp_tool_error'
  readonly httpStatus = 500
}
