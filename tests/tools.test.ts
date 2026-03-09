import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock the api module before any imports that transitively load it
vi.mock('../src/api.js', () => ({
  CloudflareApi: {
    configure: vi.fn(),
    listZones: vi.fn(),
    listDnsRecords: vi.fn(),
    findDnsRecords: vi.fn(),
    getDnsRecord: vi.fn(),
    createDnsRecord: vi.fn(),
    updateDnsRecord: vi.fn(),
    deleteDnsRecord: vi.fn(),
  },
}));

import { CloudflareApi } from '../src/api.js';
import createServer from '../src/index.js';
import {
  recordToBind,
  recordsToBindZone,
  handleExportDnsZone,
  handleImportDnsZone,
} from '../src/tools.js';

// ── shared fixtures ────────────────────────────────────────────────────────

const VALID_ID = 'abcdef0123456789abcdef0123456789';

const makeRecord = (overrides: Partial<typeof baseRecord> = {}) => ({
  ...baseRecord,
  ...overrides,
});

const baseRecord = {
  id: VALID_ID,
  name: 'example.com',
  type: 'A' as const,
  content: '1.2.3.4',
  ttl: 300,
  proxied: false,
  priority: undefined as number | undefined,
  created_on: '2024-01-01T00:00:00Z',
  modified_on: '2024-01-01T00:00:00Z',
};

// Drive tool calls through the MCP server's registered request handler
const callTool = async (
  server: ReturnType<typeof createServer>,
  name: string,
  args: unknown,
) => {
  const handler = (
    server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    }
  )._requestHandlers.get('tools/call');
  if (!handler) throw new Error('tools/call handler not registered');
  return handler({ method: 'tools/call', params: { name, arguments: args } });
};

const listTools = async (server: ReturnType<typeof createServer>) => {
  const handler = (
    server as unknown as {
      _requestHandlers: Map<string, (req: unknown) => Promise<unknown>>;
    }
  )._requestHandlers.get('tools/list');
  if (!handler) throw new Error('tools/list handler not registered');
  return handler({ method: 'tools/list', params: {} }) as Promise<{
    tools: { name: string }[];
  }>;
};

const getText = (result: unknown) =>
  (result as { content: { text: string }[] }).content[0].text;

// ── recordToBind ───────────────────────────────────────────────────────────

describe('recordToBind', () => {
  it('formats an A record', () => {
    const line = recordToBind(makeRecord({ type: 'A', name: 'www.example.com', content: '1.2.3.4', ttl: 300 }));
    expect(line).toBe('www.example.com 300 IN A 1.2.3.4');
  });

  it('formats an AAAA record', () => {
    const line = recordToBind(makeRecord({ type: 'AAAA', name: 'www.example.com', content: '2001:db8::1', ttl: 300 }));
    expect(line).toBe('www.example.com 300 IN AAAA 2001:db8::1');
  });

  it('formats a CNAME record', () => {
    const line = recordToBind(makeRecord({ type: 'CNAME', name: 'mail', content: 'mailserver.example.com', ttl: 3600 }));
    expect(line).toBe('mail 3600 IN CNAME mailserver.example.com');
  });

  it('formats an MX record with explicit priority', () => {
    const line = recordToBind(makeRecord({ type: 'MX', name: 'example.com', content: 'mail.example.com', ttl: 300, priority: 10 }));
    expect(line).toBe('example.com 300 IN MX 10 mail.example.com');
  });

  it('falls back to priority 10 for MX when priority is undefined', () => {
    const line = recordToBind(makeRecord({ type: 'MX', name: 'example.com', content: 'mail.example.com', ttl: 300, priority: undefined }));
    expect(line).toBe('example.com 300 IN MX 10 mail.example.com');
  });

  it('formats a TXT record with quoted content', () => {
    const line = recordToBind(makeRecord({ type: 'TXT', name: 'example.com', content: 'v=spf1 ~all', ttl: 300 }));
    expect(line).toBe('example.com 300 IN TXT "v=spf1 ~all"');
  });

  it('escapes double quotes inside TXT content', () => {
    const line = recordToBind(makeRecord({ type: 'TXT', name: 'example.com', content: 'say "hello"', ttl: 300 }));
    expect(line).toContain('\\"hello\\"');
  });

  it('escapes backslashes inside TXT content', () => {
    const line = recordToBind(makeRecord({ type: 'TXT', name: 'example.com', content: 'back\\slash', ttl: 300 }));
    expect(line).toContain('back\\\\slash');
  });

  it('formats an NS record', () => {
    const line = recordToBind(makeRecord({ type: 'NS', name: 'example.com', content: 'ns1.example.com', ttl: 86400 }));
    expect(line).toBe('example.com 86400 IN NS ns1.example.com');
  });

  it('formats a CAA record', () => {
    const line = recordToBind(makeRecord({ type: 'CAA', name: 'example.com', content: '0 issue "letsencrypt.org"', ttl: 300 }));
    expect(line).toBe('example.com 300 IN CAA 0 issue "letsencrypt.org"');
  });

  it('formats a PTR record', () => {
    const line = recordToBind(makeRecord({ type: 'PTR', name: '1.2.3.4.in-addr.arpa', content: 'host.example.com', ttl: 300 }));
    expect(line).toBe('1.2.3.4.in-addr.arpa 300 IN PTR host.example.com');
  });
});

// ── recordsToBindZone ──────────────────────────────────────────────────────

describe('recordsToBindZone', () => {
  it('returns a string containing all record lines', () => {
    const records = [
      makeRecord({ type: 'A', content: '1.2.3.4' }),
      makeRecord({ type: 'AAAA', content: '2001:db8::1' }),
    ];
    const zone = recordsToBindZone(records);
    expect(zone).toContain('IN A 1.2.3.4');
    expect(zone).toContain('IN AAAA 2001:db8::1');
  });

  it('includes $ORIGIN and comment when zoneName is provided', () => {
    const zone = recordsToBindZone([makeRecord()], 'example.com');
    expect(zone).toContain('$ORIGIN example.com.');
    expect(zone).toContain('Zone export for example.com');
  });

  it('omits $ORIGIN when zoneName is not provided', () => {
    const zone = recordsToBindZone([makeRecord()]);
    expect(zone).not.toContain('$ORIGIN');
  });

  it('groups records by type with section comments', () => {
    const records = [
      makeRecord({ type: 'A' }),
      makeRecord({ type: 'MX', content: 'mail.example.com', priority: 10 }),
    ];
    const zone = recordsToBindZone(records);
    expect(zone).toContain('; A Records');
    expect(zone).toContain('; MX Records');
  });

  it('includes record count in the header comment', () => {
    const records = [makeRecord(), makeRecord({ id: 'b'.repeat(32) })];
    const zone = recordsToBindZone(records);
    expect(zone).toContain('Exported 2 record(s)');
  });

  it('returns a non-empty string for an empty record array', () => {
    const zone = recordsToBindZone([]);
    expect(typeof zone).toBe('string');
    expect(zone).toContain('Exported 0 record(s)');
  });
});

// ── handleExportDnsZone ────────────────────────────────────────────────────

describe('handleExportDnsZone', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  it('returns JSON array by default', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
    const result = await handleExportDnsZone({ format: 'json' });
    const text = (result as { content: { text: string }[] }).content[0].text;
    const parsed = JSON.parse(text);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe(VALID_ID);
  });

  it('passes zone_id to listDnsRecords', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([]);
    await handleExportDnsZone({ zone_id: 'zone123', format: 'json' });
    expect(CloudflareApi.listDnsRecords).toHaveBeenCalledWith('zone123');
  });

  it('returns BIND format when format is "bind"', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
    vi.mocked(CloudflareApi.listZones).mockResolvedValueOnce([]);
    const result = await handleExportDnsZone({ zone_id: 'zone123', format: 'bind' });
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain('IN A');
    expect(text).not.toContain('"id":'); // not JSON
  });

  it('resolves zone name from listZones when exporting BIND with a zone_id', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
    vi.mocked(CloudflareApi.listZones).mockResolvedValueOnce([
      { id: 'zone123', name: 'example.com', status: 'active', paused: false },
    ]);
    const result = await handleExportDnsZone({ zone_id: 'zone123', format: 'bind' });
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain('$ORIGIN example.com.');
  });

  it('continues without zone name when listZones fails during BIND export', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
    vi.mocked(CloudflareApi.listZones).mockRejectedValueOnce(new Error('zones unavailable'));
    const result = await handleExportDnsZone({ zone_id: 'zone123', format: 'bind' });
    // Should still succeed and return BIND content
    const text = (result as { content: { text: string }[] }).content[0].text;
    expect(text).toContain('IN A');
    expect(text).not.toContain('$ORIGIN');
  });

  it('returns isError when listDnsRecords throws', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockRejectedValueOnce(new Error('API error'));
    const result = await handleExportDnsZone({ format: 'json' }) as { isError: boolean; content: { text: string }[] };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain('Error exporting DNS zone');
  });

  it('does not call listZones when format is json', async () => {
    vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
    await handleExportDnsZone({ zone_id: 'zone123', format: 'json' });
    expect(CloudflareApi.listZones).not.toHaveBeenCalled();
  });
});

// ── handleImportDnsZone ────────────────────────────────────────────────────

describe('handleImportDnsZone', () => {
  beforeEach(() => vi.clearAllMocks());
  afterEach(() => vi.clearAllMocks());

  const importRecord = { type: 'A' as const, name: 'www.example.com', content: '1.2.3.4' };

  it('creates all records and reports count', async () => {
    vi.mocked(CloudflareApi.createDnsRecord).mockResolvedValue(baseRecord);
    const result = await handleImportDnsZone({ records: [importRecord, importRecord] });
    const text = getText(result);
    expect(text).toContain('2 created');
    expect(text).toContain('0 failed');
  });

  it('passes zone_id to createDnsRecord', async () => {
    vi.mocked(CloudflareApi.createDnsRecord).mockResolvedValueOnce(baseRecord);
    await handleImportDnsZone({ zone_id: 'zone123', records: [importRecord] });
    expect(CloudflareApi.createDnsRecord).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'A' }),
      'zone123',
    );
  });

  it('continues creating remaining records when one fails', async () => {
    vi.mocked(CloudflareApi.createDnsRecord)
      .mockRejectedValueOnce(new Error('record exists'))
      .mockResolvedValueOnce(baseRecord);
    const result = await handleImportDnsZone({ records: [importRecord, importRecord] });
    const text = getText(result);
    expect(text).toContain('1 created');
    expect(text).toContain('1 failed');
  });

  it('lists individual errors in output when records fail', async () => {
    vi.mocked(CloudflareApi.createDnsRecord).mockRejectedValueOnce(new Error('duplicate record'));
    const result = await handleImportDnsZone({ records: [importRecord] });
    const text = getText(result);
    expect(text).toContain('Errors:');
    expect(text).toContain('www.example.com');
  });

  it('sets isError: true only when ALL records fail', async () => {
    vi.mocked(CloudflareApi.createDnsRecord).mockRejectedValue(new Error('fail'));
    const result = await handleImportDnsZone({ records: [importRecord] }) as { isError: boolean };
    expect(result.isError).toBe(true);
  });

  it('does not set isError when at least one record succeeded', async () => {
    vi.mocked(CloudflareApi.createDnsRecord)
      .mockRejectedValueOnce(new Error('fail'))
      .mockResolvedValueOnce(baseRecord);
    const result = await handleImportDnsZone({ records: [importRecord, importRecord] }) as { isError?: boolean };
    expect(result.isError).toBeFalsy();
  });

  it('returns success message with no errors section when all records succeed', async () => {
    vi.mocked(CloudflareApi.createDnsRecord).mockResolvedValueOnce(baseRecord);
    const text = getText(await handleImportDnsZone({ records: [importRecord] }));
    expect(text).not.toContain('Errors:');
  });

  it('reports 0 created and 0 failed for an empty records array', async () => {
    const text = getText(await handleImportDnsZone({ records: [] }));
    expect(text).toContain('0 created');
    expect(text).toContain('0 failed');
    expect(CloudflareApi.createDnsRecord).not.toHaveBeenCalled();
  });
});

// ── MCP server integration ─────────────────────────────────────────────────

describe('MCP server — export_dns_zone and import_dns_zone registration', () => {
  let server: ReturnType<typeof createServer>;

  beforeEach(() => {
    vi.clearAllMocks();
    server = createServer();
  });

  afterEach(() => vi.clearAllMocks());

  // ── tool list ────────────────────────────────────────────────────────────

  it('registers export_dns_zone in list_tools', async () => {
    const { tools } = await listTools(server);
    expect(tools.some((t) => t.name === 'export_dns_zone')).toBe(true);
  });

  it('registers import_dns_zone in list_tools', async () => {
    const { tools } = await listTools(server);
    expect(tools.some((t) => t.name === 'import_dns_zone')).toBe(true);
  });

  // ── export_dns_zone via server ───────────────────────────────────────────

  describe('export_dns_zone', () => {
    it('returns JSON output when format is json', async () => {
      vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
      const result = await callTool(server, 'export_dns_zone', { format: 'json' });
      const text = getText(result);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('defaults to JSON format when format is omitted', async () => {
      vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
      const result = await callTool(server, 'export_dns_zone', {});
      const text = getText(result);
      expect(() => JSON.parse(text)).not.toThrow();
    });

    it('returns BIND output when format is bind', async () => {
      vi.mocked(CloudflareApi.listDnsRecords).mockResolvedValueOnce([baseRecord]);
      vi.mocked(CloudflareApi.listZones).mockResolvedValueOnce([]);
      const text = getText(await callTool(server, 'export_dns_zone', { zone_id: 'z1', format: 'bind' }));
      expect(text).toContain('IN A');
    });

    it('returns isError when API call fails', async () => {
      vi.mocked(CloudflareApi.listDnsRecords).mockRejectedValueOnce(new Error('network failure'));
      const result = await callTool(server, 'export_dns_zone', {}) as { isError: boolean };
      expect(result.isError).toBe(true);
    });

    it('rejects invalid format via Zod', async () => {
      await expect(callTool(server, 'export_dns_zone', { format: 'yaml' })).rejects.toThrow();
    });
  });

  // ── import_dns_zone via server ───────────────────────────────────────────

  describe('import_dns_zone', () => {
    const importRecord = { type: 'A', name: 'www.example.com', content: '1.2.3.4' };

    it('creates records and returns a summary', async () => {
      vi.mocked(CloudflareApi.createDnsRecord).mockResolvedValueOnce(baseRecord);
      const text = getText(await callTool(server, 'import_dns_zone', { records: [importRecord] }));
      expect(text).toContain('1 created');
    });

    it('rejects missing records field via Zod', async () => {
      await expect(callTool(server, 'import_dns_zone', {})).rejects.toThrow();
    });

    it('rejects records with an invalid type via Zod', async () => {
      await expect(
        callTool(server, 'import_dns_zone', {
          records: [{ type: 'INVALID', name: 'x.com', content: '1.1.1.1' }],
        }),
      ).rejects.toThrow();
    });

    it('returns isError: true when all imports fail', async () => {
      vi.mocked(CloudflareApi.createDnsRecord).mockRejectedValueOnce(new Error('fail'));
      const result = await callTool(server, 'import_dns_zone', { records: [importRecord] }) as { isError: boolean };
      expect(result.isError).toBe(true);
    });
  });
});
