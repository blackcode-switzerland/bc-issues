import { NextResponse } from 'next/server'

export async function POST() {
  return NextResponse.json(
    {
      error: 'Deprecated',
      suggestion: 'Migrations are managed by drizzle-kit. Run `npm run db:migrate` locally or via the deploy pipeline.',
    },
    { status: 410 }
  )
}
