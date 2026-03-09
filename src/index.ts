import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';
import { CloudflareApi } from './api.js';
import { CaaData, CreateDnsRecordRequest, DnsRecordType, SrvData, UpdateDnsRecordRequest } from './types.js';

// Zod schemas for validating incoming tool arguments
const ZoneIdArg = z.object({ zone_id: z.string().optional() });

const ListDnsRecordsArgs = ZoneIdArg.extend({
  name: z.string().optional(),
  type: DnsRecordType.optional(),
});

const GetDnsRecordArgs = ZoneIdArg.extend({
  recordId: z.string().min(1),
});

const CreateDnsRecordArgs = CreateDnsRecordRequest.merge(ZoneIdArg).superRefine((val, ctx) => {
  if (val.type !== 'SRV' && val.type !== 'CAA' && !val.content) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: 'content is required for non-SRV/CAA records',
      path: ['content'],
    });
  }
  if (val.type === 'SRV') {
    const result = SrvData.safeParse(val.data);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data with valid SRV fields (priority 0-65535, weight 0-65535, port 1-65535, target non-empty) required for SRV records',
        path: ['data'],
      });
    }
  }
  if (val.type === 'CAA') {
    const result = CaaData.safeParse(val.data);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data with valid CAA fields (flags 0-255, tag: issue/issuewild/iodef, value non-empty) required for CAA records',
        path: ['data'],
      });
    }
  }
});

const UpdateDnsRecordArgs = UpdateDnsRecordRequest.merge(ZoneIdArg).extend({
  recordId: z.string().min(1),
}).superRefine((val, ctx) => {
  if (val.type === 'SRV' && val.data !== undefined) {
    const result = SrvData.safeParse(val.data);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data with valid SRV fields (priority 0-65535, weight 0-65535, port 1-65535, target non-empty) required for SRV records',
        path: ['data'],
      });
    }
  }
  if (val.type === 'CAA' && val.data !== undefined) {
    const result = CaaData.safeParse(val.data);
    if (!result.success) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'data with valid CAA fields (flags 0-255, tag: issue/issuewild/iodef, value non-empty) required for CAA records',
        path: ['data'],
      });
    }
  }
});

const DeleteDnsRecordArgs = ZoneIdArg.extend({
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
          name: 'list_zones',
          description:
            'List all Cloudflare zones (domains) on the account. Use this to discover zone IDs when the user refers to a domain by name.',
          inputSchema: {
            type: 'object',
            properties: {},
          },
        },
        {
          name: 'list_dns_records',
          description:
            'List all DNS records for a zone. Call list_zones first to resolve a domain name to a zone_id if needed.',
          inputSchema: {
            type: 'object',
            properties: {
              zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Omit to use CLOUDFLARE_ZONE_ID env var.',
              },
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
              zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Omit to use CLOUDFLARE_ZONE_ID env var.',
              },
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
          description:
            'Create a new DNS record. Call list_zones first to resolve a domain name to a zone_id if needed.',
          inputSchema: {
            type: 'object',
            properties: {
              zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Omit to use CLOUDFLARE_ZONE_ID env var.',
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
                description: 'DNS record content. Required for non-SRV/CAA records.',
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
              data: {
                type: 'object',
                description: 'Structured data for SRV or CAA records. Required when type is SRV or CAA.',
                properties: {
                  priority: {
                    type: 'number',
                    description: 'SRV priority (0-65535)',
                    minimum: 0,
                    maximum: 65535,
                  },
                  weight: {
                    type: 'number',
                    description: 'SRV weight (0-65535)',
                    minimum: 0,
                    maximum: 65535,
                  },
                  port: {
                    type: 'number',
                    description: 'SRV port (1-65535)',
                    minimum: 1,
                    maximum: 65535,
                  },
                  target: {
                    type: 'string',
                    description: 'SRV target hostname (non-empty)',
                  },
                  flags: {
                    type: 'number',
                    description: 'CAA flags (0-255)',
                    minimum: 0,
                    maximum: 255,
                  },
                  tag: {
                    type: 'string',
                    enum: ['issue', 'issuewild', 'iodef'],
                    description: 'CAA tag',
                  },
                  value: {
                    type: 'string',
                    description: 'CAA value (non-empty)',
                  },
                },
              },
            },
            required: ['type', 'name'],
          },
        },
        {
          name: 'update_dns_record',
          description: 'Update an existing DNS record',
          inputSchema: {
            type: 'object',
            properties: {
              zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Omit to use CLOUDFLARE_ZONE_ID env var.',
              },
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
              data: {
                type: 'object',
                description: 'Structured data for SRV or CAA records.',
                properties: {
                  priority: {
                    type: 'number',
                    description: 'SRV priority (0-65535)',
                    minimum: 0,
                    maximum: 65535,
                  },
                  weight: {
                    type: 'number',
                    description: 'SRV weight (0-65535)',
                    minimum: 0,
                    maximum: 65535,
                  },
                  port: {
                    type: 'number',
                    description: 'SRV port (1-65535)',
                    minimum: 1,
                    maximum: 65535,
                  },
                  target: {
                    type: 'string',
                    description: 'SRV target hostname (non-empty)',
                  },
                  flags: {
                    type: 'number',
                    description: 'CAA flags (0-255)',
                    minimum: 0,
                    maximum: 255,
                  },
                  tag: {
                    type: 'string',
                    enum: ['issue', 'issuewild', 'iodef'],
                    description: 'CAA tag',
                  },
                  value: {
                    type: 'string',
                    description: 'CAA value (non-empty)',
                  },
                },
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
              zone_id: {
                type: 'string',
                description: 'Cloudflare zone ID. Omit to use CLOUDFLARE_ZONE_ID env var.',
              },
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

    if (name === 'list_zones') {
      return await handleListZones();
    }

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
  const handleListZones = async () => {
    try {
      const zones = await CloudflareApi.listZones();

      if (zones.length === 0) {
        return { content: [{ type: 'text', text: 'No zones found on this account.' }] };
      }

      const zonesText = zones
        .map(
          (z) => `- ${safeRecord(z.name)} [ID: ${z.id}] (${z.status}${z.paused ? ', paused' : ''})`,
        )
        .join('\n');

      return {
        content: [{ type: 'text', text: `Found ${zones.length} zone(s):\n\n${zonesText}` }],
      };
    } catch (error) {
      return {
        isError: true,
        content: [
          {
            type: 'text',
            text: `Error listing zones: ${error instanceof Error ? error.message : 'Unknown error'}`,
          },
        ],
      };
    }
  };

  const handleListDnsRecords = async (args: z.infer<typeof ListDnsRecordsArgs>) => {
    try {
      const records = await CloudflareApi.findDnsRecords(args.name, args.type, args.zone_id);

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
      const record = await CloudflareApi.getDnsRecord(args.recordId, args.zone_id);

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
      const { zone_id, ...record } = args;
      const createdRecord = await CloudflareApi.createDnsRecord(record, zone_id);

      return {
        content: [
          {
            type: 'text',
            text: `DNS record created successfully.
- Name: ${safeRecord(createdRecord.name)}
- Type: ${createdRecord.type}
- Content: ${safeRecord(createdRecord.content)}
- ID: ${createdRecord.id}
${createdRecord.proxied ? '- Proxied through Cloudflare' : ''}`,
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
      const { recordId, zone_id, ...updates } = args;
      const record = await CloudflareApi.updateDnsRecord(recordId, updates, zone_id);

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
      await CloudflareApi.deleteDnsRecord(args.recordId, args.zone_id);

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
