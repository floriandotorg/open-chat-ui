import { kagiSearch } from './kagi-search'
import { redditQuery } from './reddit'
import type { ToolContext, ToolDefinition } from './types'

const tools: ToolDefinition[] = [kagiSearch, redditQuery]

export const getAllTools = (): ToolDefinition[] => tools

export const getToolSchemas = () => tools.map(({ name, description, parameters }) => ({ name, description, parameters }))

export const executeTool = async (name: string, args: Record<string, unknown>, context: ToolContext): Promise<string> => {
  const tool = tools.find(t => t.name === name)
  if (!tool) return `Error: Unknown tool "${name}"`
  return tool.execute(args, context)
}

export type { ToolContext, ToolDefinition }
