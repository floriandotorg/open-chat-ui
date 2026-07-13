import { academicSearch } from './academic-search'
import { braveNewsSearch } from './brave-news-search'
import { braveSearch } from './brave-search'
import { exaSearch } from './exa-search'
import { fetchUrl } from './fetch-url'
import { searchFlightDates, searchFlights } from './flights'
import { hackerNewsSearch } from './hacker-news-search'
import { redditQuery } from './reddit'
import type { ToolContext, ToolDefinition } from './types'
import { wikipediaSearch } from './wikipedia-search'

const tools: ToolDefinition[] = [braveSearch, braveNewsSearch, exaSearch, redditQuery, academicSearch, wikipediaSearch, hackerNewsSearch, fetchUrl, searchFlights, searchFlightDates]

export const getAllTools = (): ToolDefinition[] => tools

export const getToolSchemas = () => tools.map(({ name, description, parameters }) => ({ name, description, parameters }))

export const executeTool = async (name: string, args: Record<string, unknown>, context: ToolContext): Promise<string> => {
  const tool = tools.find(t => t.name === name)
  if (!tool) return `Error: Unknown tool "${name}"`
  return tool.execute(args, context)
}

export type { ToolContext, ToolDefinition }
