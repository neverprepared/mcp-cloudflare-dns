import { describe, it, expect } from 'vitest';
import {
  DnsRecordType,
  CloudflareDnsRecord,
  CloudflareApiResponse,
  CreateDnsRecordRequest,
  UpdateDnsRecordRequest,
  SrvData,
  CaaData,
} from '../src/types.js';

const validRecord = {
  id: 'abcdef0123456789abcdef0123456789',
  name: 'example.com',
  type: 'A' as const,
  content: '1.2.3.4',
  ttl: 300,
  created_on: '2024-01-01T00:00:00Z',
  modified_on: '2024-01-01T00:00:00Z',
};

describe('DnsRecordType', () => {
  it.each(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR'])(
    'accepts %s',
    (type) => expect(() => DnsRecordType.parse(type)).not.toThrow()
  );

  it('rejects unknown type', () => {
    expect(() => DnsRecordType.parse('SPF')).toThrow();
  });

  it('rejects empty string', () => {
    expect(() => DnsRecordType.parse('')).toThrow();
  });
});

describe('CloudflareDnsRecord', () => {
  it('parses a complete valid record', () => {
    const result = CloudflareDnsRecord.parse({
      ...validRecord,
      zone_id: 'zone123',
      zone_name: 'example.com',
      proxied: true,
      priority: 10,
      meta: { auto_added: false, managed_by_apps: false, managed_by_argo_tunnel: false },
    });
    expect(result.id).toBe(validRecord.id);
    expect(result.proxied).toBe(true);
    expect(result.priority).toBe(10);
  });

  it('parses a minimal record with only required fields', () => {
    const result = CloudflareDnsRecord.parse(validRecord);
    expect(result.proxied).toBeUndefined();
    expect(result.priority).toBeUndefined();
    expect(result.zone_id).toBeUndefined();
  });

  it('rejects a record missing id', () => {
    const { id: _, ...noId } = validRecord;
    expect(() => CloudflareDnsRecord.parse(noId)).toThrow();
  });

  it('rejects a record with invalid type', () => {
    expect(() => CloudflareDnsRecord.parse({ ...validRecord, type: 'SPF' })).toThrow();
  });

  it('rejects a record where ttl is a string', () => {
    expect(() => CloudflareDnsRecord.parse({ ...validRecord, ttl: '300' })).toThrow();
  });

  it('parses meta with optional sub-fields', () => {
    const result = CloudflareDnsRecord.parse({ ...validRecord, meta: {} });
    expect(result.meta).toEqual({});
  });
});

describe('CloudflareApiResponse', () => {
  it('parses a success list response', () => {
    const result = CloudflareApiResponse.parse({
      success: true,
      errors: [],
      messages: [],
      result: [validRecord, { ...validRecord, id: 'b'.repeat(32) }],
    });
    expect(result.success).toBe(true);
    expect(Array.isArray(result.result)).toBe(true);
  });

  it('parses a success single-record response', () => {
    const result = CloudflareApiResponse.parse({
      success: true,
      errors: [],
      messages: [],
      result: validRecord,
    });
    expect(result.result).toMatchObject({ id: validRecord.id });
  });

  it('parses a null result response', () => {
    const result = CloudflareApiResponse.parse({
      success: true,
      errors: [],
      messages: [],
      result: null,
    });
    expect(result.result).toBeNull();
  });

  it('parses a response with result absent', () => {
    const result = CloudflareApiResponse.parse({
      success: true,
      errors: [],
      messages: [],
    });
    expect(result.result).toBeUndefined();
  });

  it('parses a failure response', () => {
    const result = CloudflareApiResponse.parse({
      success: false,
      errors: [{ code: 9109, message: 'Invalid zone' }],
      messages: [],
    });
    expect(result.success).toBe(false);
    expect(result.errors[0].code).toBe(9109);
  });

  it('rejects a response missing success field', () => {
    expect(() => CloudflareApiResponse.parse({ errors: [], messages: [] })).toThrow();
  });

  it('rejects a response where errors is not an array', () => {
    expect(() =>
      CloudflareApiResponse.parse({ success: true, errors: 'none', messages: [] })
    ).toThrow();
  });
});

describe('SrvData', () => {
  const validSrv = { priority: 10, weight: 20, port: 443, target: 'srv.example.com' };

  it('parses a valid SRV data object', () => {
    const result = SrvData.parse(validSrv);
    expect(result.priority).toBe(10);
    expect(result.target).toBe('srv.example.com');
  });

  it('rejects missing priority', () => {
    const { priority: _, ...rest } = validSrv;
    expect(() => SrvData.parse(rest)).toThrow();
  });

  it('rejects missing weight', () => {
    const { weight: _, ...rest } = validSrv;
    expect(() => SrvData.parse(rest)).toThrow();
  });

  it('rejects missing port', () => {
    const { port: _, ...rest } = validSrv;
    expect(() => SrvData.parse(rest)).toThrow();
  });

  it('rejects missing target', () => {
    const { target: _, ...rest } = validSrv;
    expect(() => SrvData.parse(rest)).toThrow();
  });

  it('rejects empty target', () => {
    expect(() => SrvData.parse({ ...validSrv, target: '' })).toThrow();
  });

  it('rejects priority out of range', () => {
    expect(() => SrvData.parse({ ...validSrv, priority: 65536 })).toThrow();
    expect(() => SrvData.parse({ ...validSrv, priority: -1 })).toThrow();
  });

  it('rejects non-integer port', () => {
    expect(() => SrvData.parse({ ...validSrv, port: 80.5 })).toThrow();
  });
});

describe('CaaData', () => {
  const validCaa = { flags: 0, tag: 'issue' as const, value: 'letsencrypt.org' };

  it('parses a valid CAA data object with tag issue', () => {
    const result = CaaData.parse(validCaa);
    expect(result.tag).toBe('issue');
    expect(result.flags).toBe(0);
  });

  it('parses tag issuewild', () => {
    expect(() => CaaData.parse({ ...validCaa, tag: 'issuewild' })).not.toThrow();
  });

  it('parses tag iodef', () => {
    expect(() => CaaData.parse({ ...validCaa, tag: 'iodef' })).not.toThrow();
  });

  it('rejects invalid tag', () => {
    expect(() => CaaData.parse({ ...validCaa, tag: 'invalid' })).toThrow();
    expect(() => CaaData.parse({ ...validCaa, tag: 'issuance' })).toThrow();
  });

  it('rejects missing flags', () => {
    const { flags: _, ...rest } = validCaa;
    expect(() => CaaData.parse(rest)).toThrow();
  });

  it('rejects missing tag', () => {
    const { tag: _, ...rest } = validCaa;
    expect(() => CaaData.parse(rest)).toThrow();
  });

  it('rejects missing value', () => {
    const { value: _, ...rest } = validCaa;
    expect(() => CaaData.parse(rest)).toThrow();
  });

  it('rejects flags out of range', () => {
    expect(() => CaaData.parse({ ...validCaa, flags: 256 })).toThrow();
    expect(() => CaaData.parse({ ...validCaa, flags: -1 })).toThrow();
  });
});

describe('CreateDnsRecordRequest', () => {
  it('parses a minimal valid request and defaults ttl to 1', () => {
    const result = CreateDnsRecordRequest.parse({ type: 'A', name: 'test.com', content: '1.2.3.4' });
    expect(result.ttl).toBe(1);
    expect(result.proxied).toBeUndefined();
  });

  it('parses a full request with all optional fields', () => {
    const result = CreateDnsRecordRequest.parse({
      type: 'MX',
      name: 'mail.example.com',
      content: 'mail.example.com',
      ttl: 3600,
      priority: 10,
      proxied: false,
    });
    expect(result.priority).toBe(10);
    expect(result.ttl).toBe(3600);
  });

  it('rejects when type is absent', () => {
    expect(() => CreateDnsRecordRequest.parse({ name: 'test.com', content: '1.2.3.4' })).toThrow();
  });

  it('rejects when name is absent', () => {
    expect(() => CreateDnsRecordRequest.parse({ type: 'A', content: '1.2.3.4' })).toThrow();
  });

  it('rejects an unknown DNS type', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({ type: 'SPF', name: 'test.com', content: '1.2.3.4' })
    ).toThrow();
  });

  it('rejects missing content via Zod for non-SRV/CAA types', () => {
    expect(() => CreateDnsRecordRequest.parse({ type: 'A', name: 'test.com' })).toThrow();
  });

  it('parses a valid SRV record with required data fields', () => {
    const result = CreateDnsRecordRequest.parse({
      type: 'SRV',
      name: '_sip._tcp.example.com',
      data: { priority: 10, weight: 20, port: 5060, target: 'sip.example.com' },
    });
    expect(result.type).toBe('SRV');
    expect(result.data).toMatchObject({ priority: 10, weight: 20, port: 5060, target: 'sip.example.com' });
  });

  it('rejects SRV record with missing data', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({ type: 'SRV', name: '_sip._tcp.example.com' })
    ).toThrow();
  });

  it('rejects SRV record with incomplete data (missing target)', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({
        type: 'SRV',
        name: '_sip._tcp.example.com',
        data: { priority: 10, weight: 20, port: 5060 },
      })
    ).toThrow();
  });

  it('rejects SRV record with invalid data types', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({
        type: 'SRV',
        name: '_sip._tcp.example.com',
        data: { priority: 'high', weight: 20, port: 5060, target: 'sip.example.com' },
      })
    ).toThrow();
  });

  it('parses a valid CAA record with required data fields', () => {
    const result = CreateDnsRecordRequest.parse({
      type: 'CAA',
      name: 'example.com',
      data: { flags: 0, tag: 'issue', value: 'letsencrypt.org' },
    });
    expect(result.type).toBe('CAA');
    expect(result.data).toMatchObject({ flags: 0, tag: 'issue', value: 'letsencrypt.org' });
  });

  it('rejects CAA record with missing data', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({ type: 'CAA', name: 'example.com' })
    ).toThrow();
  });

  it('rejects CAA record with invalid tag', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({
        type: 'CAA',
        name: 'example.com',
        data: { flags: 0, tag: 'badtag', value: 'letsencrypt.org' },
      })
    ).toThrow();
  });

  it('rejects CAA record with flags out of range', () => {
    expect(() =>
      CreateDnsRecordRequest.parse({
        type: 'CAA',
        name: 'example.com',
        data: { flags: 256, tag: 'issue', value: 'letsencrypt.org' },
      })
    ).toThrow();
  });

  it('parses CAA record with all valid tags', () => {
    for (const tag of ['issue', 'issuewild', 'iodef'] as const) {
      expect(() =>
        CreateDnsRecordRequest.parse({
          type: 'CAA',
          name: 'example.com',
          data: { flags: 0, tag, value: 'letsencrypt.org' },
        })
      ).not.toThrow();
    }
  });
});

describe('UpdateDnsRecordRequest', () => {
  it('parses an empty object — all fields optional', () => {
    const result = UpdateDnsRecordRequest.parse({});
    expect(result).toEqual({});
  });

  it('parses a partial update with only content', () => {
    const result = UpdateDnsRecordRequest.parse({ content: '5.6.7.8' });
    expect(result.content).toBe('5.6.7.8');
    expect(result.type).toBeUndefined();
  });

  it('rejects when type is present but invalid', () => {
    expect(() => UpdateDnsRecordRequest.parse({ type: 'INVALID' })).toThrow();
  });

  it('rejects when ttl is a string', () => {
    expect(() => UpdateDnsRecordRequest.parse({ ttl: '3600' })).toThrow();
  });

  it('parses SRV update with valid data', () => {
    const result = UpdateDnsRecordRequest.parse({
      type: 'SRV',
      data: { priority: 5, weight: 10, port: 443, target: 'new.example.com' },
    });
    expect(result.type).toBe('SRV');
    expect(result.data).toMatchObject({ priority: 5, weight: 10, port: 443, target: 'new.example.com' });
  });

  it('rejects SRV update with invalid data fields', () => {
    expect(() =>
      UpdateDnsRecordRequest.parse({
        type: 'SRV',
        data: { priority: 5, weight: 10, port: 443 },
      })
    ).toThrow();
  });

  it('rejects SRV update with out-of-range port', () => {
    expect(() =>
      UpdateDnsRecordRequest.parse({
        type: 'SRV',
        data: { priority: 5, weight: 10, port: 70000, target: 'srv.example.com' },
      })
    ).toThrow();
  });

  it('allows SRV update without data (partial update)', () => {
    expect(() => UpdateDnsRecordRequest.parse({ type: 'SRV' })).not.toThrow();
  });

  it('parses CAA update with valid data', () => {
    const result = UpdateDnsRecordRequest.parse({
      type: 'CAA',
      data: { flags: 128, tag: 'issuewild', value: 'example.org' },
    });
    expect(result.data).toMatchObject({ flags: 128, tag: 'issuewild', value: 'example.org' });
  });

  it('rejects CAA update with invalid tag', () => {
    expect(() =>
      UpdateDnsRecordRequest.parse({
        type: 'CAA',
        data: { flags: 0, tag: 'wrongtag', value: 'example.org' },
      })
    ).toThrow();
  });

  it('rejects CAA update with flags out of range', () => {
    expect(() =>
      UpdateDnsRecordRequest.parse({
        type: 'CAA',
        data: { flags: -1, tag: 'issue', value: 'example.org' },
      })
    ).toThrow();
  });

  it('allows CAA update without data (partial update)', () => {
    expect(() => UpdateDnsRecordRequest.parse({ type: 'CAA' })).not.toThrow();
  });
});
