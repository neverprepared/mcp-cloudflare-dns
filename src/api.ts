import { z } from 'zod';
import {
  CloudflareApiResponse,
  CloudflareZonesApiResponse,
  type CreateDnsRecord,
  CreateDnsRecordRequest,
  type DnsRecord,
  type UpdateDnsRecord,
  UpdateDnsRecordRequest,
  type Zone,
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

// Make a request to a non-zone-specific Cloudflare API endpoint (e.g. /zones).
const accountApi = async (endpoint: string) => {
  const headers = getHeaders();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000);

  try {
    const url = `https://api.cloudflare.com/client/v4/${endpoint}`;
    const response = await fetch(url, { method: 'GET', headers, signal: controller.signal });

    if (!response.ok) {
      throw new Error(`Cloudflare API error: ${response.status} ${response.statusText}`);
    }

    return response;
  } catch (error) {
    if (error instanceof Error) {
      if (error.name === 'AbortError') throw new Error('Cloudflare API request timed out');
      throw new Error(`Cloudflare API error: ${error.message}`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
};

const api = async (
  endpoint: string,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' = 'GET',
  body?: Record<string, unknown>,
  zoneId?: string,
) => {
  const resolvedZoneId = zoneId ?? cloudflareConfig.zoneId;
  if (!resolvedZoneId) {
    throw new Error('No zone ID provided. Pass a zone_id parameter or set CLOUDFLARE_ZONE_ID.');
  }

  // Call getHeaders() before entering the try block so a missing-token error
  // propagates cleanly rather than being caught and re-wrapped as "Cloudflare API error: ...".
  const headers = getHeaders();

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15000); // 15 second timeout

  try {
    const url = `https://api.cloudflare.com/client/v4/zones/${resolvedZoneId}/${endpoint}`;

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

// Fetch all pages of DNS records from an endpoint, concatenating results.
// Cloudflare returns at most 100 records per page; this loops until the last page.
const fetchAllDnsRecordPages = async (
  baseEndpoint: string,
  queryParams: URLSearchParams,
  zoneId?: string,
): Promise<DnsRecord[]> => {
  const allRecords: DnsRecord[] = [];
  let page = 1;

  while (true) {
    const params = new URLSearchParams(queryParams);
    params.set('page', String(page));
    params.set('per_page', '100');
    const response = await api(`${baseEndpoint}?${params.toString()}`, 'GET', undefined, zoneId);
    const data = await parseApiResponse(response);

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result) break;
    const records = Array.isArray(data.result) ? data.result : [data.result];
    const filtered = records.filter((record) => record !== null);
    allRecords.push(...filtered);

    // Stop when: no pagination info, empty page, or partial page (signals last page)
    if (!data.result_info || filtered.length === 0 || data.result_info.count < data.result_info.per_page) {
      break;
    }

    page++;
  }

  return allRecords;
};

export const CloudflareApi = {
  configure,

  // List all zones on the account
  listZones: async (): Promise<Zone[]> => {
    let rawData: unknown;
    try {
      rawData = await (await accountApi('zones')).json();
    } catch {
      throw new Error('Failed to parse Cloudflare zones response as JSON');
    }
    const data = CloudflareZonesApiResponse.parse(rawData);
    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }
    return data.result ?? [];
  },

  // List all DNS records with automatic pagination
  listDnsRecords: async (zoneId?: string): Promise<DnsRecord[]> => {
    return fetchAllDnsRecordPages('dns_records', new URLSearchParams(), zoneId);
  },

  // Get a specific DNS record by ID
  getDnsRecord: async (recordId: string, zoneId?: string): Promise<DnsRecord> => {
    validateRecordId(recordId);
    const data = await parseApiResponse(
      await api(`dns_records/${recordId}`, 'GET', undefined, zoneId),
    );

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result || Array.isArray(data.result)) {
      throw new Error('DNS record not found');
    }

    return data.result;
  },

  // Create a new DNS record
  createDnsRecord: async (record: CreateDnsRecord, zoneId?: string): Promise<DnsRecord> => {
    const validatedRecord = CreateDnsRecordRequest.parse(record);
    const data = await parseApiResponse(await api('dns_records', 'POST', validatedRecord, zoneId));

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }

    if (!data.result || Array.isArray(data.result)) {
      throw new Error('Failed to create DNS record');
    }

    return data.result;
  },

  // Update an existing DNS record
  updateDnsRecord: async (
    recordId: string,
    updates: UpdateDnsRecord,
    zoneId?: string,
  ): Promise<DnsRecord> => {
    validateRecordId(recordId);
    const validatedUpdates = UpdateDnsRecordRequest.parse(updates);
    const data = await parseApiResponse(
      await api(`dns_records/${recordId}`, 'PATCH', validatedUpdates, zoneId),
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
  deleteDnsRecord: async (recordId: string, zoneId?: string): Promise<void> => {
    validateRecordId(recordId);
    const data = await parseApiResponse(
      await api(`dns_records/${recordId}`, 'DELETE', undefined, zoneId),
    );

    if (!data.success) {
      throw new Error(sanitizeApiErrors(data.errors));
    }
  },

  // Find DNS records by name and/or type with automatic pagination
  findDnsRecords: async (name?: string, type?: string, zoneId?: string): Promise<DnsRecord[]> => {
    const params = new URLSearchParams();
    if (name) params.append('name', name);
    if (type) params.append('type', type);
    return fetchAllDnsRecordPages('dns_records', params, zoneId);
  },
};
