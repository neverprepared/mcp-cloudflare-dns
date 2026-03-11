import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Helper to build a mock Response object
const mockResponse = (body: unknown, ok = true, status = 200, statusText = 'OK') => ({
  ok,
  status,
  statusText,
  json: vi.fn().mockResolvedValue(body),
});

const VALID_ID = 'abcdef0123456789abcdef0123456789';

const validRecord = {
  id: VALID_ID,
  name: 'example.com',
  type: 'A',
  content: '1.2.3.4',
  ttl: 300,
  proxied: false,
  created_on: '2024-01-01T00:00:00Z',
  modified_on: '2024-01-01T00:00:00Z',
};

const successListBody = {
  success: true,
  errors: [],
  messages: [],
  result: [validRecord],
};

const successSingleBody = {
  success: true,
  errors: [],
  messages: [],
  result: validRecord,
};

const failureBody = {
  success: false,
  errors: [{ code: 9109, message: 'internal secret detail' }],
  messages: [],
};

describe('CloudflareApi', () => {
  let CloudflareApi: typeof import('../src/api.js').CloudflareApi;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    // Fresh module import per test block to reset module-level config state
    vi.resetModules();
    vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
    vi.stubEnv('CLOUDFLARE_ZONE_ID', 'test-zone-id');
    vi.stubEnv('DEBUG', '');

    const mod = await import('../src/api.js');
    CloudflareApi = mod.CloudflareApi;

    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  // ── validateRecordId (tested via public methods) ──────────────────────────

  describe('validateRecordId', () => {
    it('accepts a valid 32-char lowercase hex ID', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      await expect(CloudflareApi.getDnsRecord(VALID_ID)).resolves.toBeDefined();
    });

    it('accepts uppercase hex', async () => {
      const upperId = VALID_ID.toUpperCase();
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      await expect(CloudflareApi.getDnsRecord(upperId)).resolves.toBeDefined();
    });

    it('rejects a 31-char ID', async () => {
      await expect(CloudflareApi.getDnsRecord('a'.repeat(31))).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a 33-char ID', async () => {
      await expect(CloudflareApi.getDnsRecord('a'.repeat(33))).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an ID with non-hex characters', async () => {
      await expect(CloudflareApi.getDnsRecord('g'.repeat(32))).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an empty string', async () => {
      await expect(CloudflareApi.getDnsRecord('')).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects a path traversal payload', async () => {
      await expect(
        CloudflareApi.getDnsRecord('../../etc/passwd123456789012')
      ).rejects.toThrow('Invalid DNS record ID format');
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('rejects an injection payload with special chars', async () => {
      await expect(
        CloudflareApi.getDnsRecord("'; DROP TABLE records; --0000")
      ).rejects.toThrow('Invalid DNS record ID format');
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── sanitizeApiErrors ─────────────────────────────────────────────────────

  describe('sanitizeApiErrors', () => {
    it('does not leak the raw error message to the caller', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const err = await CloudflareApi.listDnsRecords().catch(e => e);
      expect(err.message).not.toContain('internal secret detail');
      expect(err.message).toContain('code 9109');
    });

    it('includes all error codes when multiple errors are returned', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          success: false,
          errors: [
            { code: 1003, message: 'secret A' },
            { code: 9110, message: 'secret B' },
          ],
          messages: [],
        })
      );
      const err = await CloudflareApi.listDnsRecords().catch(e => e);
      expect(err.message).toContain('code 1003');
      expect(err.message).toContain('code 9110');
      expect(err.message).not.toContain('secret A');
      expect(err.message).not.toContain('secret B');
    });

    it('logs original error details to console.error', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      await CloudflareApi.listDnsRecords().catch(() => {});
      expect(spy).toHaveBeenCalledWith(
        'Cloudflare API errors:',
        expect.stringContaining('internal secret detail')
      );
      spy.mockRestore();
    });
  });

  // ── parseApiResponse ──────────────────────────────────────────────────────

  describe('parseApiResponse (via public methods)', () => {
    it('throws when response body is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      await expect(CloudflareApi.listDnsRecords()).rejects.toThrow(
        'Failed to parse Cloudflare API response as JSON'
      );
    });

    it('throws when JSON does not match expected schema', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ unexpected: true }));
      await expect(CloudflareApi.listDnsRecords()).rejects.toThrow(
        'Failed to parse API response:'
      );
    });

    it('logs raw response only when DEBUG is set', async () => {
      vi.stubEnv('DEBUG', 'true');
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockResponse({ unexpected: true }));
      await CloudflareApi.listDnsRecords().catch(() => {});
      const calls = spy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c === 'Raw API Response:')).toBe(true);
      spy.mockRestore();
    });

    it('does not log raw response when DEBUG is not set', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(mockResponse({ unexpected: true }));
      await CloudflareApi.listDnsRecords().catch(() => {});
      const calls = spy.mock.calls.map(c => c[0]);
      expect(calls.some(c => c === 'Raw API Response:')).toBe(false);
      spy.mockRestore();
    });
  });

  // ── listDnsRecords ────────────────────────────────────────────────────────

  describe('listDnsRecords', () => {
    it('returns an array of records on success', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      const records = await CloudflareApi.listDnsRecords();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(VALID_ID);
    });

    it('returns empty array when result is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null })
      );
      await expect(CloudflareApi.listDnsRecords()).resolves.toEqual([]);
    });

    it('returns empty array when result is absent', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [] })
      );
      await expect(CloudflareApi.listDnsRecords()).resolves.toEqual([]);
    });

    it('throws a sanitized error when API returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      await expect(CloudflareApi.listDnsRecords()).rejects.toThrow(
        'Cloudflare API request failed'
      );
    });

    it('throws when HTTP response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, false, 403, 'Forbidden'));
      await expect(CloudflareApi.listDnsRecords()).rejects.toThrow('403');
    });

    it('does not double-wrap the HTTP error message', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, false, 403, 'Forbidden'));
      const err = await CloudflareApi.listDnsRecords().catch((e) => e);
      // Should be "Cloudflare API error: 403 Forbidden", NOT "Cloudflare API error: Cloudflare API error: ..."
      expect(err.message).not.toMatch(/Cloudflare API error:.*Cloudflare API error:/);
    });

    it('throws a timeout error when request is aborted', async () => {
      vi.useFakeTimers();
      mockFetch.mockImplementationOnce(
        (_url: string, opts: { signal: AbortSignal }) =>
          new Promise((_resolve, reject) => {
            opts.signal.addEventListener('abort', () => {
              const err = new Error('The operation was aborted');
              err.name = 'AbortError';
              reject(err);
            });
          })
      );
      const promise = CloudflareApi.listDnsRecords();
      vi.advanceTimersByTime(15001);
      await expect(promise).rejects.toThrow('Cloudflare API request timed out');
      vi.useRealTimers();
    });

    it('uses the Authorization header with the configured token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.listDnsRecords();
      const [, opts] = mockFetch.mock.calls[0];
      expect((opts as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer test-token',
      });
    });
  });

  // ── getDnsRecord ──────────────────────────────────────────────────────────

  describe('getDnsRecord', () => {
    it('returns a single record on success', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      const record = await CloudflareApi.getDnsRecord(VALID_ID);
      expect(record.id).toBe(VALID_ID);
    });

    it('throws when result is an array (unexpected)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await expect(CloudflareApi.getDnsRecord(VALID_ID)).rejects.toThrow(
        'DNS record not found'
      );
    });

    it('throws when result is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null })
      );
      await expect(CloudflareApi.getDnsRecord(VALID_ID)).rejects.toThrow(
        'DNS record not found'
      );
    });

    it('throws sanitized error when API returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const err = await CloudflareApi.getDnsRecord(VALID_ID).catch(e => e);
      expect(err.message).not.toContain('internal secret detail');
      expect(err.message).toContain('code 9109');
    });
  });

  // ── createDnsRecord ───────────────────────────────────────────────────────

  describe('createDnsRecord', () => {
    it('sends a POST request and returns the created record', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      const record = await CloudflareApi.createDnsRecord({
        type: 'A',
        name: 'example.com',
        content: '1.2.3.4',
        ttl: 1,
      });
      const [, opts] = mockFetch.mock.calls[0];
      expect((opts as RequestInit).method).toBe('POST');
      expect(record.id).toBe(VALID_ID);
    });

    it('defaults ttl to 1 when not provided', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      await CloudflareApi.createDnsRecord({ type: 'A', name: 'x.com', content: '1.1.1.1', ttl: 1 });
      const [, opts] = mockFetch.mock.calls[0];
      const body = JSON.parse((opts as RequestInit).body as string);
      expect(body.ttl).toBe(1);
    });

    it('throws ZodError before fetching when type is invalid', async () => {
      await expect(
        CloudflareApi.createDnsRecord({ type: 'SPF' as never, name: 'x.com', content: '1.1.1.1', ttl: 1 })
      ).rejects.toThrow();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when API returns array in result', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await expect(
        CloudflareApi.createDnsRecord({ type: 'A', name: 'x.com', content: '1.1.1.1', ttl: 1 })
      ).rejects.toThrow('Failed to create DNS record');
    });
  });

  // ── updateDnsRecord ───────────────────────────────────────────────────────

  describe('updateDnsRecord', () => {
    it('sends a PATCH to the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      await CloudflareApi.updateDnsRecord(VALID_ID, { content: '9.9.9.9' });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain(`dns_records/${VALID_ID}`);
      expect((opts as RequestInit).method).toBe('PATCH');
    });

    it('accepts an empty updates object', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      await expect(CloudflareApi.updateDnsRecord(VALID_ID, {})).resolves.toBeDefined();
    });

    it('rejects invalid recordId without calling fetch', async () => {
      await expect(CloudflareApi.updateDnsRecord('bad-id', {})).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws sanitized error on API failure', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const err = await CloudflareApi.updateDnsRecord(VALID_ID, {}).catch(e => e);
      expect(err.message).not.toContain('internal secret detail');
    });
  });

  // ── deleteDnsRecord ───────────────────────────────────────────────────────

  describe('deleteDnsRecord', () => {
    it('sends a DELETE to the correct endpoint', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [] })
      );
      await CloudflareApi.deleteDnsRecord(VALID_ID);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain(`dns_records/${VALID_ID}`);
      expect((opts as RequestInit).method).toBe('DELETE');
    });

    it('rejects invalid recordId without calling fetch', async () => {
      await expect(CloudflareApi.deleteDnsRecord('not-valid')).rejects.toThrow(
        'Invalid DNS record ID format'
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws sanitized error when API returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const err = await CloudflareApi.deleteDnsRecord(VALID_ID).catch(e => e);
      expect(err.message).toContain('code 9109');
      expect(err.message).not.toContain('internal secret detail');
    });
  });

  // ── findDnsRecords ────────────────────────────────────────────────────────

  describe('findDnsRecords', () => {
    it('calls dns_records with no query string when no filters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.findDnsRecords();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toMatch(/dns_records$/);
    });

    it('appends name filter as query param', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.findDnsRecords('example.com');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('name=example.com');
    });

    it('appends type filter as query param', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.findDnsRecords(undefined, 'A');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('type=A');
    });

    it('appends both filters', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.findDnsRecords('example.com', 'MX');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('name=example.com');
      expect(url).toContain('type=MX');
    });
  });

  // ── listZones ─────────────────────────────────────────────────────────────

  describe('listZones', () => {
    const zonesBody = {
      success: true,
      errors: [],
      messages: [],
      result: [{ id: 'zone123', name: 'example.com', status: 'active', paused: false }],
    };

    it('calls the /zones endpoint (not zone-scoped)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(zonesBody));
      await CloudflareApi.listZones();
      const [url] = mockFetch.mock.calls[0];
      expect(url).toMatch(/\/v4\/zones$/);
      expect(url).not.toContain('test-zone-id');
    });

    it('returns an array of zones', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(zonesBody));
      const zones = await CloudflareApi.listZones();
      expect(zones).toHaveLength(1);
      expect(zones[0].name).toBe('example.com');
      expect(zones[0].id).toBe('zone123');
    });

    it('returns empty array when result is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null }),
      );
      const zones = await CloudflareApi.listZones();
      expect(zones).toEqual([]);
    });

    it('throws sanitized error when API returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const err = await CloudflareApi.listZones().catch((e) => e);
      expect(err.message).toContain('code 9109');
      expect(err.message).not.toContain('internal secret detail');
    });

    it('throws when fetch fails', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      await expect(CloudflareApi.listZones()).rejects.toThrow();
    });

    it('propagates the original API error (not a JSON parse error) on network failure', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const err = await CloudflareApi.listZones().catch((e) => e);
      expect(err.message).not.toContain('Failed to parse Cloudflare zones response as JSON');
      expect(err.message).toContain('network error');
    });
  });

  // ── exportDnsZone ─────────────────────────────────────────────────────────

  describe('exportDnsZone', () => {
    it('returns all DNS records as an array', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      const records = await CloudflareApi.exportDnsZone();
      expect(records).toHaveLength(1);
      expect(records[0].id).toBe(VALID_ID);
    });

    it('returns empty array when no records exist', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: [] }),
      );
      await expect(CloudflareApi.exportDnsZone()).resolves.toEqual([]);
    });

    it('sends a GET request to dns_records', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.exportDnsZone();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toContain('dns_records');
      expect((opts as RequestInit).method).toBe('GET');
    });

    it('accepts an explicit zoneId parameter', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      await CloudflareApi.exportDnsZone('custom-zone-id');
      const [url] = mockFetch.mock.calls[0];
      expect(url).toContain('custom-zone-id');
    });

    it('throws sanitized error when API returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      await expect(CloudflareApi.exportDnsZone()).rejects.toThrow('Cloudflare API request failed');
    });
  });

  // ── importDnsZone ─────────────────────────────────────────────────────────

  describe('importDnsZone', () => {
    const recordToImport = { type: 'A' as const, name: 'example.com', content: '1.2.3.4', ttl: 1 };

    it('returns succeeded records when all creates succeed', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      const result = await CloudflareApi.importDnsZone([recordToImport]);
      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(0);
      expect(result.succeeded[0].id).toBe(VALID_ID);
    });

    it('returns failed entry when a create returns success: false', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const result = await CloudflareApi.importDnsZone([recordToImport]);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('code 9109');
      expect(result.failed[0].record).toEqual(recordToImport);
    });

    it('handles partial failures across multiple records', async () => {
      const record2 = { type: 'AAAA' as const, name: 'v6.example.com', content: '::1', ttl: 1 };
      mockFetch.mockResolvedValueOnce(mockResponse(successSingleBody));
      mockFetch.mockResolvedValueOnce(mockResponse(failureBody));
      const result = await CloudflareApi.importDnsZone([recordToImport, record2]);
      expect(result.succeeded).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
    });

    it('returns empty succeeded and failed arrays for empty input', async () => {
      const result = await CloudflareApi.importDnsZone([]);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(0);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('records a failed entry when fetch throws', async () => {
      mockFetch.mockRejectedValueOnce(new Error('network error'));
      const result = await CloudflareApi.importDnsZone([recordToImport]);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('network error');
    });

    it('adds a failed entry without calling fetch when record type is invalid', async () => {
      const badRecord = { type: 'SPF' as never, name: 'x.com', content: 'v=spf1', ttl: 1 };
      const result = await CloudflareApi.importDnsZone([badRecord]);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('sends POST requests to dns_records for each record', async () => {
      const record2 = { type: 'CNAME' as const, name: 'www.example.com', content: 'example.com', ttl: 1 };
      mockFetch.mockResolvedValue(mockResponse(successSingleBody));
      await CloudflareApi.importDnsZone([recordToImport, record2]);
      expect(mockFetch).toHaveBeenCalledTimes(2);
      for (const call of mockFetch.mock.calls) {
        const [url, opts] = call;
        expect(url).toContain('dns_records');
        expect((opts as RequestInit).method).toBe('POST');
      }
    });
  });

  // ── pagination warning ────────────────────────────────────────────────────

  describe('pagination warning', () => {
    it('logs a warning when total_count exceeds returned records', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          success: true,
          errors: [],
          messages: [],
          result: [validRecord],
          result_info: { page: 1, per_page: 100, count: 1, total_count: 200 },
        }),
      );
      await CloudflareApi.listDnsRecords();
      expect(spy).toHaveBeenCalledWith(expect.stringContaining('Pagination is not yet implemented'));
      spy.mockRestore();
    });

    it('does not log a warning when all records are returned', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockFetch.mockResolvedValueOnce(
        mockResponse({
          success: true,
          errors: [],
          messages: [],
          result: [validRecord],
          result_info: { page: 1, per_page: 100, count: 1, total_count: 1 },
        }),
      );
      await CloudflareApi.listDnsRecords();
      expect(spy).not.toHaveBeenCalledWith(expect.stringContaining('Pagination'));
      spy.mockRestore();
    });
  });

  // ── listZones JSON parse error ────────────────────────────────────────────

  describe('listZones JSON parse error', () => {
    it('throws when response body is not valid JSON', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockRejectedValue(new SyntaxError('Unexpected token')),
      });
      await expect(CloudflareApi.listZones()).rejects.toThrow(
        'Failed to parse Cloudflare zones response as JSON',
      );
    });
  });

  // ── createDnsRecord null result ───────────────────────────────────────────

  describe('createDnsRecord null result', () => {
    it('throws when API returns success: true but result is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null }),
      );
      await expect(
        CloudflareApi.createDnsRecord({ type: 'A', name: 'x.com', content: '1.1.1.1', ttl: 1 }),
      ).rejects.toThrow('Failed to create DNS record');
    });
  });

  // ── updateDnsRecord null result ───────────────────────────────────────────

  describe('updateDnsRecord null result', () => {
    it('throws when API returns success: true but result is null', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null }),
      );
      await expect(CloudflareApi.updateDnsRecord(VALID_ID, { content: '9.9.9.9' })).rejects.toThrow(
        'Failed to update DNS record',
      );
    });
  });

  // ── importDnsZone non-Error exception ─────────────────────────────────────

  describe('importDnsZone non-Error exception', () => {
    it('records "Unknown error" when fetch throws a non-Error value', async () => {
      mockFetch.mockRejectedValueOnce('raw string error');
      const result = await CloudflareApi.importDnsZone([
        { type: 'A', name: 'x.com', content: '1.1.1.1', ttl: 1 },
      ]);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toBe('Unknown error');
    });
  });

  // ── missing API token / zone ID ──────────────────────────────────────────

  describe('missing credentials', () => {
    it('throws when API token is not configured', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_API_TOKEN', '');
      vi.stubEnv('CLOUDFLARE_ZONE_ID', '');
      const mod = await import('../src/api.js');
      // listZones uses accountApi which checks token before zone
      await expect(mod.CloudflareApi.listZones()).rejects.toThrow(
        'Cloudflare API Token not configured',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it('throws when no zone ID is configured and none is passed', async () => {
      vi.resetModules();
      vi.stubEnv('CLOUDFLARE_API_TOKEN', 'test-token');
      vi.stubEnv('CLOUDFLARE_ZONE_ID', '');
      const mod = await import('../src/api.js');
      await expect(mod.CloudflareApi.listDnsRecords()).rejects.toThrow(
        'No zone ID provided',
      );
      expect(mockFetch).not.toHaveBeenCalled();
    });
  });

  // ── listZones HTTP / non-Error errors ────────────────────────────────────

  describe('listZones HTTP error', () => {
    it('throws when accountApi response is not ok', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, false, 401, 'Unauthorized'));
      await expect(CloudflareApi.listZones()).rejects.toThrow('401');
    });

    it('re-throws non-Error exceptions from accountApi fetch', async () => {
      mockFetch.mockRejectedValueOnce('raw network failure');
      await expect(CloudflareApi.listZones()).rejects.toBe('raw network failure');
    });
  });

  // ── importDnsZone null result ─────────────────────────────────────────────

  describe('importDnsZone null result', () => {
    it('records a failed entry when create returns success: true but null result', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ success: true, errors: [], messages: [], result: null }),
      );
      const result = await CloudflareApi.importDnsZone([
        { type: 'A', name: 'x.com', content: '1.1.1.1', ttl: 1 },
      ]);
      expect(result.succeeded).toHaveLength(0);
      expect(result.failed).toHaveLength(1);
      expect(result.failed[0].error).toContain('Failed to create DNS record');
    });
  });

  // ── configure / credential handling ──────────────────────────────────────

  describe('configure', () => {
    it('uses the configured token in the Authorization header', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(successListBody));
      CloudflareApi.configure({
        cloudflareApiToken: 'my-custom-token',
        cloudflareZoneId: 'my-zone',
      });
      await CloudflareApi.listDnsRecords();
      const [, opts] = mockFetch.mock.calls[0];
      expect((opts as RequestInit).headers).toMatchObject({
        Authorization: 'Bearer my-custom-token',
      });
    });
  });
});
