// Public OpenAPI 3.1 document for the Blackcode Issues API. No auth required so
// agents and API tooling can discover the surface. Source: lib/openapi/spec.ts.

import { NextResponse } from 'next/server'
import { openApiSpec } from '@/lib/openapi/spec'

export function GET() {
  return NextResponse.json(openApiSpec, {
    headers: { 'Cache-Control': 'public, max-age=300' },
  })
}
