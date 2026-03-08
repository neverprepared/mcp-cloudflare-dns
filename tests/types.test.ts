import { describe, it, expect } from 'vitest';
import {
  DnsRecordType,
  CloudflareDnsRecord,
  CloudflareApiResponse,
  CreateDnsRecordRequest,
  UpdateDnsRecordRequest,
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
});
