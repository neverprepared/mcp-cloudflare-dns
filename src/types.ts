import { z } from 'zod';

// Cloudflare DNS Record types
export const DnsRecordType = z.enum(['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'PTR']);

// Structured data for SRV records
export const SrvData = z.object({
  priority: z.number().int().min(0).max(65535),
  weight: z.number().int().min(0).max(65535),
  port: z.number().int().min(1).max(65535),
  target: z.string().min(1),
});

// Structured data for CAA records
export const CaaData = z.object({
  flags: z.number().int().min(0).max(255),
  tag: z.enum(['issue', 'issuewild', 'iodef']),
  value: z.string().min(1),
});

export const CloudflareDnsRecord = z.object({
  id: z.string(),
  zone_id: z.string().optional(),
  zone_name: z.string().optional(),
  name: z.string(),
  type: DnsRecordType,
  content: z.string(),
  proxied: z.boolean().optional(),
  ttl: z.number(),
  priority: z.number().optional(),
  created_on: z.string(),
  modified_on: z.string(),
  meta: z
    .object({
      auto_added: z.boolean().optional(),
      managed_by_apps: z.boolean().optional(),
      managed_by_argo_tunnel: z.boolean().optional(),
    })
    .optional(),
});

export const CloudflareApiResponse = z.object({
  success: z.boolean(),
  errors: z.array(
    z.object({
      code: z.number(),
      message: z.string(),
    }),
  ),
  messages: z.array(
    z.object({
      code: z.number(),
      message: z.string(),
    }),
  ),
  result: z.union([z.array(CloudflareDnsRecord), CloudflareDnsRecord, z.null()]).optional(),
  result_info: z
    .object({
      page: z.number(),
      per_page: z.number(),
      count: z.number(),
      total_count: z.number(),
    })
    .optional(),
});

export const CreateDnsRecordRequest = z.object({
  type: DnsRecordType,
  name: z.string(),
  content: z.string().optional(),
  ttl: z.number().optional().default(1),
  priority: z.number().optional(),
  proxied: z.boolean().optional(),
  data: z.union([SrvData, CaaData]).optional(),
});

export const UpdateDnsRecordRequest = z.object({
  type: DnsRecordType.optional(),
  name: z.string().optional(),
  content: z.string().optional(),
  ttl: z.number().optional(),
  priority: z.number().optional(),
  proxied: z.boolean().optional(),
  data: z.union([SrvData, CaaData]).optional(),
});

export const CloudflareZone = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  paused: z.boolean(),
});

export const CloudflareZonesApiResponse = z.object({
  success: z.boolean(),
  errors: z.array(z.object({ code: z.number(), message: z.string() })),
  messages: z.array(z.object({ code: z.number(), message: z.string() })),
  result: z.array(CloudflareZone).nullable().optional(),
  result_info: z
    .object({
      page: z.number(),
      per_page: z.number(),
      count: z.number(),
      total_count: z.number(),
    })
    .optional(),
});

export type DnsRecord = z.infer<typeof CloudflareDnsRecord>;
export type DnsRecordTypeEnum = z.infer<typeof DnsRecordType>;
export type ApiResponse = z.infer<typeof CloudflareApiResponse>;
export type CreateDnsRecord = z.infer<typeof CreateDnsRecordRequest>;
export type UpdateDnsRecord = z.infer<typeof UpdateDnsRecordRequest>;
export type Zone = z.infer<typeof CloudflareZone>;
export type SrvDataType = z.infer<typeof SrvData>;
export type CaaDataType = z.infer<typeof CaaData>;
