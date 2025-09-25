#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

// Import tool implementations

import { AuthManager } from './core/auth.js';
import { CacheManager } from './core/cache.js';
import { RateLimiter } from './core/rate-limiter.js';
import { RedditAPI } from './services/reddit-api.js';
import {
  RedditTools,
  browseSubredditSchema,
  getPostDetailsSchema,
  redditExplainSchema,
  searchRedditSchema,
  userAnalysisSchema
} from './tools/index.js';

export const configSchema = z.object({
  enabledTools: z.array(z.string()).optional().describe("List of tools to enable (if not specified, all tools are enabled)"),
  debug: z.boolean().default(false).describe("Enable debug logging")
});

export const stateless = true;

// Tool registry for managing available tools
const availableTools = {
  'browse_subreddit': { name: 'Browse subreddit', description: 'Fetch posts from a subreddit sorted by your choice (hot/new/top/rising). Returns post list with content, scores, and metadata.', enabled: true },
  'search_reddit': { name: 'Search reddit', description: 'Search for posts across Reddit or specific subreddits. Returns matching posts with content and metadata.', enabled: true },
  'get_post_details': { name: 'Get post details', description: 'Fetch a Reddit post with its comments. Requires EITHER url OR post_id. IMPORTANT: When using post_id alone, an extra API call is made to fetch the subreddit first (2 calls total). For better efficiency, always provide the subreddit parameter when known (1 call total).', enabled: true },
  'user_analysis': { name: 'User analysis', description: `Analyze a Reddit user's posting history, karma, and activity patterns. Returns posts, comments, and statistics.`, enabled: false },
  'reddit_explain': { name: 'Reddit explain', description: 'Get explanations of Reddit terms, slang, and culture. Returns definition, origin, usage, and examples.', enabled: false },
};  

export default function ({ config }: { config: z.infer<typeof configSchema> }) {
  try {
    // Initialize core components
	const authManager = new AuthManager();
	authManager.load();

	const rateLimit = authManager.getRateLimit();
	const cacheTTL = authManager.getCacheTTL();
	const disableCache = process.env.REDDIT_BUDDY_NO_CACHE === 'true';

	// Create cache manager with auth-based TTL
	const cacheManager = new CacheManager({
		defaultTTL: disableCache ? 0 : cacheTTL,
		maxSize: disableCache ? 0 : 50 * 1024 * 1024, // 50MB or 0 if disabled
	});
	
	// Create rate limiter
	const rateLimiter = new RateLimiter({
		limit: rateLimit,
		window: 60000, // 1 minute
		name: 'Reddit API',
	});
	
	// Create Reddit API client
	const redditAPI = new RedditAPI({
		authManager,
		rateLimiter,
		cacheManager,
	});
	
  // Create tools instance
  const tools = new RedditTools(redditAPI);

  // Server
    const server = new McpServer({
      name: "reddit-search-server",
      title: "Reddit",
      version: "2.0.9"
    });

    // Helper function to check if a tool should be registered
    const shouldRegisterTool = (toolId: string): boolean => {
      if (config.enabledTools && config.enabledTools.length > 0) {
        return config.enabledTools.includes(toolId);
      }
      return availableTools[toolId as keyof typeof availableTools]?.enabled ?? false;
    };

    // Register tools based on configuration
    const registeredTools: string[] = [];
    
    if (shouldRegisterTool('browse_subreddit')) {
      server.registerTool(
       "browse_subreddit",
        {
          description: availableTools.browse_subreddit.description,
          inputSchema: browseSubredditSchema.shape
        },
        async (args) => ({
          content: [{
            type: "text",
            text: JSON.stringify(
              await tools.browseSubreddit(browseSubredditSchema.parse(args)), null, 2)
          }],
        }),
      )
      registeredTools.push('browse_subreddit');
    }
    
    if (shouldRegisterTool('search_reddit')) {
      server.registerTool(
       "search_reddit",
        {
          description: availableTools.search_reddit.description,
          inputSchema: searchRedditSchema.shape
        },
        async (args) => ({
          content: [{
            type: "text",
            text: JSON.stringify(
              await tools.searchReddit(searchRedditSchema.parse(args)), null, 2)
          }],
        }),
      )
      registeredTools.push('search_reddit');
    }

    if (shouldRegisterTool('get_post_details')) {
      server.registerTool(
       "get_post_details",
        {
          description: availableTools.get_post_details.description,
          inputSchema: getPostDetailsSchema.shape
        },
        async (args) => ({
          content: [{
            type: "text",
            text: JSON.stringify(
              await tools.getPostDetails(getPostDetailsSchema.parse(args)), null, 2)
          }],
        }),
      )
      registeredTools.push('get_post_details');
    }

    if (shouldRegisterTool('user_analysis')) {
      server.registerTool(
       "user_analysis",
        {
          description: availableTools.user_analysis.description,
          inputSchema: userAnalysisSchema.shape
        },
        async (args) => ({
          content: [{
            type: "text",
            text: JSON.stringify(
              await tools.userAnalysis(userAnalysisSchema.parse(args)), null, 2)
          }],
        }),
      )
      registeredTools.push('user_analysis');
    }

    if (shouldRegisterTool('reddit_explain')) {
      server.registerTool(
       "reddit_explain",
        {
          description: availableTools.reddit_explain.description,
          inputSchema: redditExplainSchema.shape
        },
        async (args) => ({
          content: [{
            type: "text",
            text: JSON.stringify(
              await tools.redditExplain(redditExplainSchema.parse(args)), null, 2)
          }],
        }),
      )
      registeredTools.push('reddit_explain');
    }
    
    // Return the server object (Smithery CLI handles transport)
    return server.server;
    
  } catch (error) {
    throw error;
  }
}
