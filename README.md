# MCP Cloudflare DNS Server

A Model Context Protocol server implementation for Cloudflare DNS that enables AI agents to manage DNS records for your domains.

> **Fork of [gilberth/mcp-cloudflare](https://github.com/gilberth/mcp-cloudflare)** by [TheLord](https://github.com/gilberth).
> Original work is credited and this fork is distributed under the same MIT license.

## Features

- **List DNS records** - View all or filtered DNS records
- **Create DNS records** - Add new A, AAAA, CNAME, MX, TXT, and other record types
- **Update DNS records** - Modify existing records
- **Delete DNS records** - Remove unwanted records
- **Full Cloudflare API support** - Supports proxying, TTL, priority settings

## Setup

### 1. Get Cloudflare API Token

1. Go to [Cloudflare API Tokens](https://dash.cloudflare.com/profile/api-tokens)
2. Click "Create Token"
3. Use the "Edit zone DNS" template or create a custom token with:
   - Zone:Read (to use `list_zones`)
   - DNS:Edit (to create, update, and delete DNS records)
4. Copy your API token

### 2. Get Zone ID

1. Go to your domain in the Cloudflare Dashboard
2. Copy the Zone ID from the right sidebar

## Usage

### Environment Variables

Create a `.env` file:

```env
CLOUDFLARE_API_TOKEN=your-api-token-here
CLOUDFLARE_ZONE_ID=your-zone-id-here  # Optional: default zone when zone_id not specified per-tool
CLOUDFLARE_EMAIL=your-email@example.com  # Optional, only for legacy API keys
```

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "cloudflare": {
      "command": "npx",
      "args": ["-y", "@neverprepared/mcp-cloudflare-dns"],
      "env": {
        "CLOUDFLARE_API_TOKEN": "your-api-token"
      }
    }
  }
}
```

### Run locally

```bash
npx -y @neverprepared/mcp-cloudflare-dns
```

## Available Tools

### `list_zones`
List all Cloudflare zones (domains) on the account. Use this to discover zone IDs when
working with a domain by name.

### `list_dns_records`
List all DNS records for a zone, with optional filters for record name and type.

### `get_dns_record`
Get detailed information about a specific DNS record by ID.

### `create_dns_record`
Create a new DNS record with specified type, name, and content.
SRV and CAA records accept a structured `data` object instead of a `content` string.

### `update_dns_record`
Update an existing DNS record by ID. All fields except `recordId` are optional.

### `delete_dns_record`
Delete a DNS record by ID.

### `export_dns_zone`
Export all DNS records for a zone as a JSON array. Useful for backups and bulk operations.

### `import_dns_zone`
Bulk-import DNS records from a JSON array. Returns a success/failure summary with
per-record partial failure handling.

## Supported DNS Record Types

- A (IPv4 address)
- AAAA (IPv6 address)
- CNAME (Canonical name)
- MX (Mail exchange)
- TXT (Text)
- NS (Name server)
- SRV (Service)
- CAA (Certificate Authority Authorization)
- PTR (Pointer)

## Security

- API tokens are never logged or exposed
- DNS record content is treated as untrusted external data to guard against prompt injection
- Record IDs are validated against Cloudflare's expected format before use
- API error details are sanitized before being returned to the calling agent
- Uses official Cloudflare API with secure authentication
- Supports scoped API tokens for minimal permissions

## License

MIT — see [LICENSE](./LICENSE).

Original work copyright TheLord ([gilberth/mcp-cloudflare](https://github.com/gilberth/mcp-cloudflare)).
