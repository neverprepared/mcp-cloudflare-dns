import { z } from 'zod';
import {
  CloudflareApiResponse,
  type CreateDnsRecord,
  CreateDnsRecordRequest,
  type DnsRecord,
  type UpdateDnsRecord,
  UpdateDnsRecordRequest,
} from './types.js';

// Cloudflare record ID format: 32 hex characters
const RECORD_ID_RE = /^[0-9a-f]{32}$/i;

const validateRecordId = (recordId: string): void => {
  if (!RECORD_ID_RE.test(recordId)) {
    throw new Error('Invalid DNS record ID format');
  }
};

// Sanitize Cloudflare API error messages before surfacing to callers.
// Raw API errors may contain internal details; only the error codes are safe to expose.
const sanitizeApiErrors = (errors: { code: number; message: string }[]): string => {
  const codes = errors.map((e) => `code ${e.code}`).join(', ');
  console.error('Cloudflare API errors:', JSON.stringify(errors));
  return `Cloudflare API request failed (${codes})`;
};

// Configuration for Cloudflare API
const cloudflareConfig: {
  apiToken: string;
  zoneId: string;
  email?: string;
} = {
  apiToken: '',
  zoneId: '',
  email: undefined,
};

// Configure API with parameters from Smithery
const configure = (config: {
  cloudflareApiToken: string;
  cloudflareZoneId: string;
  cloudflareEmail?: string;
}) => {
  cloudflareConfig.apiToken = config.cloudflareApiToken;
  cloudflareConfig.zoneId = config.cloudflareZoneId;
  cloudflareConfig.email = config.cloudflareEmail;
};

// Fallback for local development with environment variables
const parseEnv = () => {
  const parsed = z
    .object({
      CLOUDFLARE_API_TOKEN: z.string().optional(),
      CLOUDFLARE_ZONE_ID: z.string().optional(),
      CLOUDFLARE_EMAIL: z.string().optional(),
    })
    .safeParse(process.env);

  if (parsed.success && parsed.data.CLOUDFLARE_API_TOKEN && parsed.data.CLOUDFLARE_ZONE_ID) {
    cloudflareConfig.apiToken = parsed.data.CLOUDFLARE_API_TOKEN;
    cloudflareConfig.zoneId = parsed.data.CLOUDFLARE_ZONE_ID;
    cloudflareConfig.email = parsed.data.CLOUDFLARE_EMAIL;
  }
};

// Initialize with environment variables if available
parseEnv();

const getHeaders = () => {
  if (!cloudflareConfig.apiToken) {
    throw new Error('Cloudflare API Token not configured');
  }

  return {
    Authorization: `Bearer ${cloudflareConfig.apiToken}`,
    'Content-Type': 'application/json',
  };
};

const api = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
) => {
  if (!cloudflareConfig.zoneId) {
    throw new Error('Cloudflare Zone ID not configured');
  }

  // Call getHeaders() before entering the try block so a missing-token error
  // propagates cleanly rather than being caught and re-wrapped as "Cloudflare API error: ...".
  const headers = getHeaders();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${cloudflareConfig.zoneId}/${endpoint}`;

    const response = await fetch(url, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${response.status} ${response.statusText}`);
    }

    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        throw new Error('Cloudflare API request timed out');
      }
      throw new Error(`Cloudflare API error: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

// Shared helper: parse a fetch Response as JSON and validate with Zod schema.
const parseApiResponse = async (response: Response) => {
  let rawData: unknown;
  try {
    rawData = await response.json();
  } catch {
    throw new Error('Failed to parse Cloudflare API response as JSON');
  }
  try {
    return CloudflareApiResponse.parse(rawData);
  } catch (parseError) {
    console.error('API Response parsing failed:', parseError);
    if (process.env.DEBUG) {
      console.error('Raw API Response:', JSON.stringify(rawData, null, 2));
    }
    throw new Error(
      `Failed to parse API response: ${parseError instanceof Error ? parseError.message : 'Unknown error'}`,
    );
  }
};

// Shared helper: parse a list response and return DnsRecord[].
const parseRecordList = async (response: Response): Promise<DnsRecord[]> => {
  const data = await parseApiResponse(response);
  if (!data.success) {
    throw new Error(sanitizeApiErrors(data.errors));
  }
  if (!data.result) return [];
  const records = Array.isArray(data.result) ? data.result : [data.result];
  const filtered = records.filter((record) => record !== null);

  // Warn when Cloudflare's pagination indicates more records exist than were returned.
  // The API returns at most 100 records per page by default.
  if (data.result_info && data.result_info.total_count > filtered.length) {
    console.error(
      `Warning: only ${filtered.length} of ${data.result_info.total_count} DNS records returned. Pagination is not yet implemented; some records may be missing.`,
    );
  }

  return filtered;
};

export const CloudflareApi = {
  configure,

  // List all DNS records
  listDnsRecords: async (): Promise<DnsRecord[]> => {
    return parseRecordList(await api('dns_records'));
  },

  // Get a specific DNS record by ID
  getDnsRecord: async (recordId: string): Promise<DnsRecord> => {
    validateRecordId(recordId);
    const data = await parseApiResponse(await api(`dns_records/${recordId}`));

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result || Array.isArray(data.result)) {
      throw new Error('DNS record not found');
    }

    return data.result;
  },

  // Create a new DNS record
  createDnsRecord: async (record: CreateDnsRecord): Promise<DnsRecord> => {
    const validatedRecord = CreateDnsRecordRequest.parse(record);
    const data = await parseApiResponse(await api('dns_records', 'POST', validatedRecord));

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result || Array.isArray(data.result)) {
      throw new Error('Failed to create DNS record');
    }

    return data.result;
  },

  // Update an existing DNS record
  updateDnsRecord: async (recordId: string, updates: UpdateDnsRecord): Promise<DnsRecord> => {
    validateRecordId(recordId);
    const validatedUpdates = UpdateDnsRecordRequest.parse(updates);
    const data = await parseApiResponse(
      await api(`dns_records/${recordId}`, 'PATCH', validatedUpdates),
    );

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result || Array.isArray(data.result)) {
      throw new Error('Failed to update DNS record');
    }

    return data.result;
  },

  // Delete a DNS record
  deleteDnsRecord: async (recordId: string): Promise<void> => {
    validateRecordId(recordId);
    const data = await parseApiResponse(await api(`dns_records/${recordId}`, 'DELETE'));

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }
  },

  // Find DNS records by name and/or type
  findDnsRecords: async (name?: string, type?: string): Promise<DnsRecord[]> => {
    const params = new URLSearchParams();
    if (name) params.append('name', name);
    if (type) params.append('type', type);
    const query = params.toString();
    const endpoint = query ? `dns_records?${query}` : 'dns_records';
    return parseRecordList(await api(endpoint));
  },
};
