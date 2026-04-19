# Changelog

## [1.2.4](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.2.3...v1.2.4) (2026-04-19)


### Bug Fixes

* move dotenv to dependencies so npx installs it ([5bb55fe](https://github.com/neverprepared/mcp-cloudflare-dns/commit/5bb55fe882ef1f51e45413269975a5b401672c0d))

## [1.2.3](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.2.2...v1.2.3) (2026-03-12)


### Bug Fixes

* **types:** use permissive schema for delete response in deleteDnsRecord ([bcf8628](https://github.com/neverprepared/mcp-cloudflare-dns/commit/bcf8628e59565044fe8eaed128479f4a69381cc1))

## [1.2.2](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.2.1...v1.2.2) (2026-03-12)


### Bug Fixes

* allow env-only config without requiring CLOUDFLARE_ZONE_ID ([2094610](https://github.com/neverprepared/mcp-cloudflare-dns/commit/209461055436bbb6f3db480046546daacc12cb3e))

## [1.2.1](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.2.0...v1.2.1) (2026-03-12)


### Bug Fixes

* include response body in HTTP errors, separate zones schema validation ([0026c69](https://github.com/neverprepared/mcp-cloudflare-dns/commit/0026c69162641a695f6b38f945bd00db88424d3c))
* include response body in HTTP errors, separate zones schema validation ([4898c6c](https://github.com/neverprepared/mcp-cloudflare-dns/commit/4898c6c056cccb28674d2559566f39d33d8eb60e))

## [1.2.0](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.1.1...v1.2.0) (2026-03-11)


### Features

* add DNS zone export and import tools ([2e3f644](https://github.com/neverprepared/mcp-cloudflare-dns/commit/2e3f6445dfc275eb2c968246a40fb6dc662e31f9))
* add DNS zone export and import tools ([cfba97a](https://github.com/neverprepared/mcp-cloudflare-dns/commit/cfba97a27b273fbd4f883f3ce19c012da546d1c0))
* add SRV and CAA record data validation ([85a7a81](https://github.com/neverprepared/mcp-cloudflare-dns/commit/85a7a812567e57f464c080efd6cb0ba46df4b9c0))
* add SRV and CAA record data validation ([3c645aa](https://github.com/neverprepared/mcp-cloudflare-dns/commit/3c645aae91dd08e1a3fd93817fbbf3fb1e1c7a1e))


### Bug Fixes

* audit MCP server — fix broken handlers, SRV/CAA data, error wrapping, README ([71ccc97](https://github.com/neverprepared/mcp-cloudflare-dns/commit/71ccc97efaa2569980d11d9975ddae3dc2ab57b3))
* import CreateDnsRecordRequest, preserve SRV/CAA data, fix HTTP error wrapping ([5551a3d](https://github.com/neverprepared/mcp-cloudflare-dns/commit/5551a3d305528b9150afd8a8009355e05718e5bf))

## [1.1.1](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.1.0...v1.1.1) (2026-03-08)


### Bug Fixes

* move publish step into release-please workflow ([ef4ea4e](https://github.com/neverprepared/mcp-cloudflare-dns/commit/ef4ea4eed83433b3d4b0e69e3268e480db39e24c))
* trigger release to test publish pipeline ([02588ae](https://github.com/neverprepared/mcp-cloudflare-dns/commit/02588aedd1c516d7316ac574662115ff76dca58b))

## [1.1.0](https://github.com/neverprepared/mcp-cloudflare-dns/compare/v1.0.0...v1.1.0) (2026-03-08)


### Features

* add multi-zone support with list_zones tool ([292efd7](https://github.com/neverprepared/mcp-cloudflare-dns/commit/292efd76297b24079aa19830718b00e4ec163a2e))


### Bug Fixes

* make CLOUDFLARE_ZONE_ID optional in CLI and docs ([73a2396](https://github.com/neverprepared/mcp-cloudflare-dns/commit/73a23968e27bff99db6f47848c53e0c47cac54a0))

## 1.0.0 (2026-03-08)


### Bug Fixes

* initial release via GitHub Packages ([aa944f6](https://github.com/neverprepared/mcp-cloudflare-dns/commit/aa944f636ad1ed91a15adafe886472baabc933db))
