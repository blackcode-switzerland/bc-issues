'use client'

import { motion } from 'framer-motion'
import Link from 'next/link'
import Image from 'next/image'

export function LandingPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-primary/10">
      {/* Animated background pattern */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-[40%] -right-[40%] w-[80%] h-[80%] rounded-full bg-gradient-to-br from-primary/20 to-transparent blur-3xl" />
        <div className="absolute -bottom-[40%] -left-[40%] w-[80%] h-[80%] rounded-full bg-gradient-to-tr from-primary/10 to-transparent blur-3xl" />
      </div>

      {/* Content */}
      <div className="relative z-10">
        {/* Header */}
        <header className="border-b border-border/50 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Image
                src="/logo.png"
                alt="blackcode issues"
                width={32}
                height={32}
                className="rounded-lg"
              />
              <span className="font-bold text-lg">blackcode issues</span>
            </div>
            <Link
              href="/login"
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
            >
              Sign In
            </Link>
          </div>
        </header>

        {/* Hero */}
        <main className="max-w-7xl mx-auto px-6 py-24">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6 }}
            className="text-center"
          >
            <motion.div
              initial={{ scale: 0.5, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ delay: 0.2, duration: 0.5 }}
              className="inline-flex items-center gap-2 px-4 py-2 bg-primary/10 border border-primary/20 rounded-full text-sm text-primary mb-8"
            >
              <span className="w-2 h-2 bg-primary rounded-full animate-pulse" />
              AI-Native Issue Tracking
            </motion.div>

            <h1 className="text-5xl md:text-7xl font-bold tracking-tight mb-6">
              <span className="text-foreground">The </span>
              <span className="bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                Trinity
              </span>
              <br />
              <span className="text-foreground">Architecture</span>
            </h1>

            <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-12">
              Prompt → Tools → Software. Issue tracking designed for AI agents first,
              humans second. No more UUID chaos. No more slow APIs. Just speed.
            </p>

            <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
              <Link
                href="/login"
                className="px-8 py-4 bg-primary text-primary-foreground rounded-xl font-semibold text-lg hover:bg-primary/90 transition-colors shadow-lg shadow-primary/25"
              >
                Get Started Free
              </Link>
              <a
                href="https://github.com/Drew-source/blackcode-issues"
                target="_blank"
                rel="noopener noreferrer"
                className="px-8 py-4 bg-card border border-border rounded-xl font-semibold text-lg hover:bg-secondary transition-colors"
              >
                View on GitHub
              </a>
            </div>
          </motion.div>

          {/* Features */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4, duration: 0.6 }}
            className="mt-32 grid md:grid-cols-3 gap-8"
          >
            <FeatureCard
              icon="⚡"
              title="2-15ms Latency"
              description="Built for speed. Every operation is optimized for AI agent workflows. No more waiting."
            />
            <FeatureCard
              icon="🔢"
              title="Integer IDs"
              description="No more UUID hell. Simple, memorable IDs that AI agents can actually work with."
            />
            <FeatureCard
              icon="↩️"
              title="Instant Rollback"
              description="Every operation is reversible. One command to undo. State snapshots before bulk operations."
            />
            <FeatureCard
              icon="🎯"
              title="Natural Language"
              description="Complex queries in plain English. 'Show blocked issues from Q4 assigned to Andrea.'"
            />
            <FeatureCard
              icon="📦"
              title="Batch Operations"
              description="Move 50 issues at once. Create 100 comments. All atomic, all rollback-able."
            />
            <FeatureCard
              icon="🔺"
              title="Trinity Bound"
              description="Prompt, Tools, Software - tested together. CI fails if they drift apart."
            />
          </motion.div>

          {/* Code sample */}
          <motion.div
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.6, duration: 0.6 }}
            className="mt-32"
          >
            <h2 className="text-3xl font-bold text-center mb-4">
              Micro-Verbose Prompts
            </h2>
            <p className="text-center text-muted-foreground mb-8 max-w-2xl mx-auto">
              The AI receives everything it needs. No guessing. No retries.
            </p>
            <div className="bg-card rounded-2xl border border-border p-6 font-mono text-sm overflow-x-auto">
              <pre className="text-muted-foreground">
{`tool: create_issue
latency: 2-4ms (single) | 3-8ms (batch up to 50)
params:
  project_id: int, required, valid range 1-10000
  title: str, required, 1-200 chars
  status: enum [backlog, todo, in_progress, blocked, in_review, done]
  priority: int 1-5, default 3 (1=urgent, 5=low)
returns:
  success: {id: int, created_at: ISO8601, url: str}
  error: {code: str, message: str, suggestion: str}
errors:
  PROJECT_NOT_FOUND: "Project {id} doesn't exist. List: list_projects"
  TITLE_TOO_LONG: "Max 200 chars. Truncate or split."
rollback: auto-snapshot before write, retrieve via undo_last`}
              </pre>
            </div>
          </motion.div>

          {/* Made with love */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.8, duration: 0.6 }}
            className="mt-32 text-center"
          >
            <p className="text-muted-foreground">
              Made with 💝 by minds—carbon and silicon—working together
            </p>
            <p className="text-sm text-muted-foreground mt-2">
              Andrea David & AI
            </p>
          </motion.div>
        </main>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description,
}: {
  icon: string
  title: string
  description: string
}) {
  return (
    <div className="bg-card/50 backdrop-blur border border-border rounded-2xl p-6 hover:border-primary/50 transition-colors">
      <div className="text-4xl mb-4">{icon}</div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-muted-foreground">{description}</p>
    </div>
  )
}

