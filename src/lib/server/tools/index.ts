import { fetchUrl } from './fetch-url'
import { kagiSearch } from './kagi-search'
import { academicSearch } from './openalex'
import { redditQuery } from './reddit'
import type { ToolContext, ToolDefinition } from './types'

const tools: ToolDefinition[] = [kagiSearch, redditQuery, academicSearch, fetchUrl]

export const getAllTools = (): ToolDefinition[] => tools

export const getToolSchemas = () => tools.map(({ name, description, parameters }) => ({ name, description, parameters }))

export const executeTool = async (name: string, args: Record<string, unknown>, context: ToolContext): Promise<string> => {
  const tool = tools.find(t => t.name === name)
  if (!tool) return `Error: Unknown tool "${name}"`
  return tool.execute(args, context)
}

export type { ToolContext, ToolDefinition }
