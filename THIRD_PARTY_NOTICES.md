# Third Party Notices

This file tracks direct third-party dependencies used by ModelTruth. Internal workspace packages are excluded.

| Package | Version | License | Usage |
| --- | --- | --- | --- |
| `next` | 15.5.18 | MIT | Web app, App Router, metadata, sitemap and API routes |
| `react` | 19.2.6 | MIT | Web UI runtime |
| `react-dom` | 19.2.6 | MIT | Web UI DOM renderer |
| `postgres` | 3.4.9 | Unlicense | PostgreSQL client for production repositories and migrations |
| `promptfoo` | 0.121.13 | MIT | Local eval/provider contract for audit suite runner and custom provider compatibility |
| `zod` | 3.25.76 | MIT | Runtime validation for API and environment inputs |
| `esbuild` | 0.28.0 | MIT | Bundles the publishable standalone ModelTruth CLI package |
| `tsx` | 4.22.3 | MIT | TypeScript script runner for local tooling and startup scripts |
| `typescript` | 5.9.3 | Apache-2.0 | Type checking and build-time tooling |
| `vitest` | 3.2.4 | MIT | Unit and integration test runner |
| `@types/node` | 22.19.19 | MIT | Node.js TypeScript definitions |
| `@types/react` | 19.2.15 | MIT | React TypeScript definitions |
| `@types/react-dom` | 19.2.3 | MIT | React DOM TypeScript definitions |

Direct dependency policy:

- Allowed licenses: MIT, Apache-2.0, BSD-style licenses, ISC and Unlicense.
- GPL, AGPL, SSPL and source-available projects may be used only as design references unless explicitly approved.
- New direct dependencies must be added here with package name, version, license and concrete product usage.
