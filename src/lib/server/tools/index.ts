import { academicSearch } from './academic-search'
import { braveNewsSearch } from './brave-news-search'
import { braveSearch } from './brave-search'
import { exaSearch } from './exa-search'
import { fetchUrl } from './fetch-url'
import { searchFlightDates, searchFlights } from './flights'
import { hackerNewsSearch } from './hacker-news-search'
import { redditQuery } from './reddit'
import { withSearchSummarization } from './summarize'
import type { ToolContext, ToolDefinition } from './types'
import { wikipediaSearch } from './wikipedia-search'

const SUMMARIZED_TOOL_NAMES = new Set(['web_search', 'news_search', 'semantic_web_search', 'reddit_query', 'academic_search', 'wikipedia_search', 'hacker_news_search'])

const rawTools: ToolDefinition[] = [braveSearch, braveNewsSearch, exaSearch, redditQuery, academicSearch, wikipediaSearch, hackerNewsSearch, fetchUrl, searchFlights, searchFlightDates]
const tools: ToolDefinition[] = rawTools.map(tool => (SUMMARIZED_TOOL_NAMES.has(tool.name) ? withSearchSummarization(tool) : tool))

export const getAllTools = (): ToolDefinition[] => tools

export const getToolSchemas = () => tools.map(({ name, description, parameters }) => ({ name, description, parameters }))

export const executeTool = async (name: string, args: Record<string, unknown>, context: ToolContext): Promise<{ result: string; rawResult?: string }> => {
  const tool = tools.find(t => t.name === name)
  if (!tool) return { result: `Error: Unknown tool "${name}"` }
  const out = await tool.execute(args, context)
  return typeof out === 'string' ? { result: out } : out
}

export type { ToolContext, ToolDefinition }
