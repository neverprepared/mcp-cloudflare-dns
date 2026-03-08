import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CloudflareApi } from './api.js';
import { CreateDnsRecordRequest, DnsRecordType, UpdateDnsRecordRequest } from './types.js';

// Zod schemas for validating incoming tool arguments
const ListDnsRecordsArgs = z.object({
  name: z.string().optional(),
  type: DnsRecordType.optional(),
});

const GetDnsRecordArgs = z.object({
  recordId: z.string().min(1),
});

const CreateDnsRecordArgs = CreateDnsRecordRequest;

const UpdateDnsRecordArgs = UpdateDnsRecordRequest.extend({
  recordId: z.string().min(1),
});

const DeleteDnsRecordArgs = z.object({
  recordId: z.string().min(1),
});

// Wrap external DNS record data to prevent prompt injection.
// DNS record content is untrusted user-controlled data that could contain
// instructions targeting the LLM consuming this tool's output.
const safeRecord = (value: string) => `[EXTERNAL DATA: ${value}]`;

export default function createServer() {
  const server = new Server(
    {
      name: 'mcp-cloudflare',
      version: '1.6.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // Register available tools
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
      tools: [
        {
          name: 'list_dns_records',
          description: 'List all DNS records for the configured zone',
          inputSchema: {
            type: 'object',
            properties: {
              name: {
                type: 'string',
                description: 'Filter by record name (optional)',
              },
              type: {
                type: 'string',
                enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'],
                description: 'Filter by record type (optional)',
              },
            },
          },
        },
        {
          name: 'get_dns_record',
          description: 'Get a specific DNS record by ID',
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'The DNS record ID',
              },
            },
            required: ['recordId'],
          },
        },
        {
          name: 'create_dns_record',
          description: 'Create a new DNS record',
          inputSchema: {
            type: 'object',
            properties: {
              type: {
                type: 'string',
                enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'],
                description: 'DNS record type',
              },
              name: {
                type: 'string',
                description: 'DNS record name',
              },
              content: {
                type: 'string',
                description: 'DNS record content',
              },
              ttl: {
                type: 'number',
                description: 'Time to live (TTL) in seconds (default: 1 for auto)',
                minimum: 1,
              },
              priority: {
                type: 'number',
                description: 'Priority (for MX records)',
              },
              proxied: {
                type: 'boolean',
                description: 'Whether the record should be proxied through Cloudflare',
              },
            },
            required: ['type', 'name', 'content'],
          },
        },
        {
          name: 'update_dns_record',
          description: 'Update an existing DNS record',
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'The DNS record ID to update',
              },
              type: {
                type: 'string',
                enum: ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'],
                description: 'DNS record type',
              },
              name: {
                type: 'string',
                description: 'DNS record name',
              },
              content: {
                type: 'string',
                description: 'DNS record content',
              },
              ttl: {
                type: 'number',
                description: 'Time to live (TTL) in seconds',
                minimum: 1,
              },
              priority: {
                type: 'number',
                description: 'Priority (for MX records)',
              },
              proxied: {
                type: 'boolean',
                description: 'Whether the record should be proxied through Cloudflare',
              },
            },
            required: ['recordId'],
          },
        },
        {
          name: 'delete_dns_record',
          description: 'Delete a DNS record',
          inputSchema: {
            type: 'object',
            properties: {
              recordId: {
                type: 'string',
                description: 'The DNS record ID to delete',
              },
            },
            required: ['recordId'],
          },
        },
      ],
    };
  });

  // Handle tool calls
  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    if (name === 'list_dns_records') {
      return await handleListDnsRecords(ListDnsRecordsArgs.parse(args ?? {}));
    }

    if (name === 'get_dns_record') {
      return await handleGetDnsRecord(GetDnsRecordArgs.parse(args));
    }

    if (name === 'create_dns_record') {
      return await handleCreateDnsRecord(CreateDnsRecordArgs.parse(args));
    }

    if (name === 'update_dns_record') {
      return await handleUpdateDnsRecord(UpdateDnsRecordArgs.parse(args));
    }

    if (name === 'delete_dns_record') {
      return await handleDeleteDnsRecord(DeleteDnsRecordArgs.parse(args));
    }

    throw new Error('Unknown tool');
  });

  // Tool handlers
  const handleListDnsRecords = async (args: z.infer<typeof ListDnsRecordsArgs>) => {
    try {
      const records = await CloudflareApi.findDnsRecords(args.name, args.type);

      if (records.length === 0) {
        return {
          content: [{ type: 'text', text: 'No DNS records found matching the criteria.' }],
        };
      }

      const recordsText = records
        .map(
          (record) =>
            `- ${safeRecord(record.name)} (${record.type}) -> ${safeRecord(record.content)} [ID: ${record.id}]${record.proxied ? ' (Proxied)' : ''}`,
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Found ${records.length} DNS record(s):\n\n${recordsText}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error listing DNS records: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  const handleGetDnsRecord = async (args: z.infer<typeof GetDnsRecordArgs>) => {
    try {
      const record = await CloudflareApi.getDnsRecord(args.recordId);

      return {
        content: [
          {
            type: 'text',
            text: `DNS Record Details:
- Name: ${safeRecord(record.name)}
- Type: ${record.type}
- Content: ${safeRecord(record.content)}
- TTL: ${record.ttl}
- Proxied: ${record.proxied ? 'Yes' : 'No'}
${record.priority !== undefined ? `- Priority: ${record.priority}` : ''}
- ID: ${record.id}
- Created: ${new Date(record.created_on).toLocaleString()}
- Modified: ${new Date(record.modified_on).toLocaleString()}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error getting DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  const handleCreateDnsRecord = async (args: z.infer<typeof CreateDnsRecordArgs>) => {
    try {
      const record = await CloudflareApi.createDnsRecord(args);

      return {
        content: [
          {
            type: 'text',
            text: `DNS record created successfully.
- Name: ${safeRecord(record.name)}
- Type: ${record.type}
- Content: ${safeRecord(record.content)}
- ID: ${record.id}
${record.proxied ? '- Proxied through Cloudflare' : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error creating DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  const handleUpdateDnsRecord = async (args: z.infer<typeof UpdateDnsRecordArgs>) => {
    try {
      const { recordId, ...updates } = args;
      const record = await CloudflareApi.updateDnsRecord(recordId, updates);

      return {
        content: [
          {
            type: 'text',
            text: `DNS record updated successfully.
- Name: ${safeRecord(record.name)}
- Type: ${record.type}
- Content: ${safeRecord(record.content)}
- ID: ${record.id}
${record.proxied ? '- Proxied through Cloudflare' : ''}`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error updating DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  const handleDeleteDnsRecord = async (args: z.infer<typeof DeleteDnsRecordArgs>) => {
    try {
      await CloudflareApi.deleteDnsRecord(args.recordId);

      return {
        content: [
          {
            type: 'text',
            text: `DNS record deleted successfully. (ID: ${args.recordId})`,
          },
        ],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error deleting DNS record: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  return server;
}
