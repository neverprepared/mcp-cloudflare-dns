#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import dotenv from 'dotenv';
import createServer from './index.js';

// Load environment variables
dotenv.config();

// Validate required config
if (!process.env.CLOUDFLARE_API_TOKEN) {
  console.error('Missing required environment variable: CLOUDFLARE_API_TOKEN');
  console.error('');
  console.error('Create a .env file with:');
  console.error('  CLOUDFLARE_API_TOKEN=your-api-token');
  console.error('  CLOUDFLARE_ZONE_ID=your-zone-id  # Optional: default zone for all tools');
  console.error('  CLOUDFLARE_EMAIL=your-email@example.com  # Optional');
  console.error('');
  console.error('Get your API token at: https://dash.cloudflare.com/profile/api-tokens');
  process.exit(1);
}

const server = createServer();

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Cloudflare MCP Server running');
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
