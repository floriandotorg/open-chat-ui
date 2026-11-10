import { redditQuery } from './reddit'
import type { ToolContext } from './types'
import { afterEach, describe, expect, it, vi } from 'vitest'

const decodoCtx: ToolContext = { userId: 'u1', getApiKey: async () => 'user:pass', getApiKeys: async () => [] }

const SEARCH_FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom" xmlns:media="http://search.yahoo.com/mrss/"><title>reddit.com: search results - browser automation</title><entry><author><name>/u/Drachenx</name><uri>https://www.reddit.com/user/Drachenx</uri></author><category term="ClaudeAI" label="r/ClaudeAI"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Hi guys, I&amp;#39;ve been using Kimi web bridge &amp;amp; friends.&lt;/p&gt; &lt;p&gt;What do you use?&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt; &amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/Drachenx&quot;&gt; /u/Drachenx &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/x/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt; &amp;#32; &lt;span&gt;&lt;a href=&quot;https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/x/&quot;&gt;[comments]&lt;/a&gt;&lt;/span&gt;</content><id>t3_1xfd8ak</id><link href="https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/what_are_you_the_current_setups_for_browser/" /><updated>2026-10-25T20:41:28+00:00</updated><published>2026-10-25T20:41:28+00:00</published><title>What are you the current setups for browser automation?</title></entry><entry><author><name>/u/cekrem</name><uri>https://www.reddit.com/user/cekrem</uri></author><category term="programming" label="r/programming"/><content type="html">&amp;#32; submitted by &amp;#32; &lt;a href=&quot;https://www.reddit.com/user/cekrem&quot;&gt; /u/cekrem &lt;/a&gt; &lt;br/&gt; &lt;span&gt;&lt;a href=&quot;https://cekrem.github.io/posts/csharp-15-union-types/&quot;&gt;[link]&lt;/a&gt;&lt;/span&gt;</content><id>t3_1xrrmk7</id><link href="https://www.reddit.com/r/programming/comments/1xrrmk7/c_15_union_types/" /><updated>2026-11-09T13:27:16+00:00</updated><published>2026-11-09T13:27:16+00:00</published><title>C# 15: Union Types &amp;amp; Closed Hierarchies</title></entry></feed>`

const THREAD_FEED = `<?xml version="1.0" encoding="UTF-8"?><feed xmlns="http://www.w3.org/2005/Atom"><entry><author><name>/u/Drachenx</name></author><category term="ClaudeAI" label="r/ClaudeAI"/><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;What do you use?&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;</content><id>t3_1xfd8ak</id><link href="https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/what_are_you/" /><updated>2026-10-25T20:41:28+00:00</updated><published>2026-10-25T20:41:28+00:00</published><title>What are you the current setups for browser automation?</title></entry><entry><author><name>/u/BenSimonDev</name></author><category term="ClaudeAI" label="r/ClaudeAI" /><content type="html">&lt;!-- SC_OFF --&gt;&lt;div class=&quot;md&quot;&gt;&lt;p&gt;Claude has a Chrome extension.&lt;/p&gt; &lt;p&gt;Try &lt;a href=&quot;https://docs.firecrawl.dev/mcp-server&quot;&gt;Firecrawl MCP&lt;/a&gt;, see &lt;a href=&quot;https://github.com/x/y&quot;&gt;https://github.com/x/y&lt;/a&gt;, ask &lt;a href=&quot;/r/webdev&quot;&gt;r/webdev&lt;/a&gt; or read &lt;a href=&quot;/r/ClaudeAI/wiki/faq&quot;&gt;the FAQ&lt;/a&gt;.&lt;/p&gt; &lt;/div&gt;&lt;!-- SC_ON --&gt;</content><id>t1_19rndz2vjbydc</id><link href="https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/what_are_you/19rndz2vjbydc/"/><updated>2026-10-25T20:45:31+00:00</updated><title>/u/BenSimonDev on What are you the current setups for browser automation?</title></entry></feed>`

const DECODO_FAILURE = {
  status: 'failed',
  status_code: 613,
  message: 'We were not able to scrape the target. You can try the following: 1) Switch between JS and non-JS rendering, 2) Retry the request, 3) Switch to a different geo-location.',
  task_id: '7525826512197569537',
}

const decodoResult = (content: string) => ({ results: [{ content, status_code: 200, task_id: '1', created_at: '', updated_at: '' }] })

const mockDecodo = (respond: (targetUrl: string) => unknown) => {
  const targetUrls: string[] = []
  globalThis.fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body: unknown = JSON.parse(String(init?.body))
    if (!body || typeof body !== 'object' || !('url' in body) || typeof body.url !== 'string') {
      throw new Error('missing url in Decodo request')
    }
    targetUrls.push(body.url)
    return new Response(JSON.stringify(respond(body.url)), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as unknown as typeof fetch
  return targetUrls
}

const runWithTimers = async (args: Record<string, unknown>) => {
  vi.useFakeTimers()
  const pending = redditQuery.execute(args, decodoCtx)
  await vi.runAllTimersAsync()
  return pending
}

describe('reddit_query via Decodo', () => {
  afterEach(() => {
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('requests the RSS feed for searches, restricted to posts', async () => {
    const targetUrls = mockDecodo(() => decodoResult(SEARCH_FEED))
    await redditQuery.execute({ command: 'search', query: 'browser automation' }, decodoCtx)
    const url = new URL(targetUrls[0])
    expect(url.pathname).toBe('/search.rss')
    expect(url.searchParams.get('q')).toBe('browser automation')
    expect(url.searchParams.get('type')).toBe('link')
  })

  it('parses posts from the Atom feed', async () => {
    mockDecodo(() => decodoResult(SEARCH_FEED))
    const out = await redditQuery.execute({ command: 'search', query: 'browser automation' }, decodoCtx)
    expect(out).toContain('**What are you the current setups for browser automation?** — r/ClaudeAI')
    expect(out).toContain('created_at: 2026-10-25T20:41:28.000Z')
    expect(out).toContain('url: https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/what_are_you_the_current_setups_for_browser/')
    expect(out).toContain("Hi guys, I've been using Kimi web bridge & friends.")
    expect(out).toContain('What do you use?')
    expect(out).not.toContain('submitted by')
    expect(out).toContain('**C# 15: Union Types & Closed Hierarchies** — r/programming')
  })

  it('parses a thread feed into the post and its comments', async () => {
    const targetUrls = mockDecodo(() => decodoResult(THREAD_FEED))
    const out = await redditQuery.execute({ command: 'thread', post_id: '1xfd8ak' }, decodoCtx)
    expect(new URL(targetUrls[0]).pathname).toBe('/comments/1xfd8ak.rss')
    expect(out).toContain('**What are you the current setups for browser automation?** — r/ClaudeAI')
    expect(out).toContain('## Comments')
    expect(out).toContain('Claude has a Chrome extension.')
    expect(out).toContain('url: https://www.reddit.com/r/ClaudeAI/comments/1xfd8ak/what_are_you/19rndz2vjbydc/')
  })

  it('keeps links in bodies as markdown', async () => {
    mockDecodo(() => decodoResult(THREAD_FEED))
    const out = await redditQuery.execute({ command: 'thread', post_id: '1xfd8ak' }, decodoCtx)
    expect(out).toContain('Try [Firecrawl MCP](https://docs.firecrawl.dev/mcp-server), see https://github.com/x/y, ask r/webdev or read [the FAQ](https://www.reddit.com/r/ClaudeAI/wiki/faq).')
  })

  it('surfaces the Decodo failure message after retrying', async () => {
    const targetUrls = mockDecodo(() => DECODO_FAILURE)
    const out = await runWithTimers({ command: 'search', query: 'browser automation' })
    expect(out).toContain('status 613')
    expect(out).toContain('We were not able to scrape the target')
    expect(targetUrls.length).toBeGreaterThan(1)
  })

  it('recovers when a retry succeeds', async () => {
    let calls = 0
    mockDecodo(() => (++calls === 1 ? DECODO_FAILURE : decodoResult(SEARCH_FEED)))
    const out = await runWithTimers({ command: 'search', query: 'browser automation' })
    expect(out).toContain('What are you the current setups for browser automation?')
  })
})
