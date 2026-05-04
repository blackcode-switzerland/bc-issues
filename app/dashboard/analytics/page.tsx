'use client'

import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Image from 'next/image'
import Link from 'next/link'
import { format, parseISO } from 'date-fns'
import {
  BarChart3,
  TrendingUp,
  Users,
  Folder,
  CheckCircle2,
  Clock,
} from 'lucide-react'

// Format ISO date string to "Jan 24" format
function formatDateLabel(dateStr: string): string {
  try {
    const date = parseISO(dateStr)
    return format(date, 'MMM d')
  } catch {
    return dateStr
  }
}

const STATUS_COLORS: Record<string, string> = {
  backlog: 'bg-gray-500',
  todo: 'bg-blue-500',
  in_progress: 'bg-amber-500',
  blocked: 'bg-red-500',
  in_review: 'bg-purple-500',
  done: 'bg-green-500',
}

const STATUS_LABELS: Record<string, string> = {
  backlog: 'Backlog',
  todo: 'To Do',
  in_progress: 'In Progress',
  blocked: 'Blocked',
  in_review: 'In Review',
  done: 'Done',
}

export default function AnalyticsPage() {
  const { data: analytics, isLoading } = useQuery({
    queryKey: ['analytics'],
    queryFn: async () => {
      const res = await fetch('/api/analytics')
      if (!res.ok) throw new Error('Failed to fetch analytics')
      return res.json()
    },
  })

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-6xl mx-auto">
          <div className="h-8 bg-card rounded-lg animate-pulse mb-8" />
          <div className="grid md:grid-cols-2 gap-6">
            {[...Array(4)].map((_, i) => (
              <div key={i} className="h-64 bg-card rounded-lg animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  if (!analytics) {
    return (
      <div className="min-h-screen bg-background p-6">
        <div className="max-w-6xl mx-auto text-center py-24">
          <h2 className="text-xl font-semibold mb-2">Failed to load analytics</h2>
        </div>
      </div>
    )
  }

  const totalIssues = analytics.issuesByStatus?.reduce(
    (sum: number, item: any) => sum + item.count,
    0
  ) || 0

  const maxStatusCount = Math.max(
    ...(analytics.issuesByStatus?.map((item: any) => item.count) || [0])
  )

  const maxProjectCount = Math.max(
    ...(analytics.issuesByProject?.map((item: any) => item.count) || [0])
  )

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Analytics</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Insights into your projects and issues
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <div className="max-w-6xl mx-auto space-y-6">
          {/* Stats Grid */}
          <div className="grid md:grid-cols-4 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                  <BarChart3 className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <p className="text-2xl font-bold">{totalIssues}</p>
                  <p className="text-xs text-muted-foreground">Total Issues</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5 text-green-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {analytics.issuesByStatus?.find((s: any) => s.status === 'done')?.count || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Completed</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                  <Folder className="w-5 h-5 text-blue-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {analytics.issuesByProject?.length || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Projects</p>
                </div>
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card rounded-lg border border-border p-4"
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                  <Users className="w-5 h-5 text-purple-500" />
                </div>
                <div>
                  <p className="text-2xl font-bold">
                    {analytics.topAssignees?.length || 0}
                  </p>
                  <p className="text-xs text-muted-foreground">Active Assignees</p>
                </div>
              </div>
            </motion.div>
          </div>

          {/* Charts Grid */}
          <div className="grid md:grid-cols-2 gap-6">
            {/* Issues by Status */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-card rounded-lg border border-border p-6"
            >
              <h2 className="text-lg font-semibold mb-4">Issues by Status</h2>
              <div className="space-y-3">
                {analytics.issuesByStatus?.map((item: any) => {
                  const percentage = maxStatusCount > 0 ? (item.count / maxStatusCount) * 100 : 0
                  return (
                    <div key={item.status}>
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <div
                            className={`w-3 h-3 rounded-full ${
                              STATUS_COLORS[item.status] || 'bg-gray-500'
                            }`}
                          />
                          <span className="text-sm font-medium">
                            {STATUS_LABELS[item.status] || item.status}
                          </span>
                        </div>
                        <span className="text-sm font-semibold">{item.count}</span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className={`h-full ${STATUS_COLORS[item.status] || 'bg-gray-500'} transition-all`}
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {/* Issues by Project */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-card rounded-lg border border-border p-6"
            >
              <h2 className="text-lg font-semibold mb-4">Issues by Project</h2>
              <div className="space-y-3">
                {analytics.issuesByProject?.slice(0, 8).map((item: any) => {
                  const percentage = maxProjectCount > 0 ? (item.count / maxProjectCount) * 100 : 0
                  return (
                    <div key={item.id}>
                      <div className="flex items-center justify-between mb-1">
                        <Link
                          href={`/dashboard/${item.id}`}
                          className="text-sm font-medium hover:text-primary transition-colors"
                        >
                          {item.name}
                        </Link>
                        <span className="text-sm font-semibold">{item.count}</span>
                      </div>
                      <div className="h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  )
                })}
              </div>
            </motion.div>

            {/* Top Assignees */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-card rounded-lg border border-border p-6"
            >
              <h2 className="text-lg font-semibold mb-4">Top Assignees</h2>
              <div className="space-y-3">
                {analytics.topAssignees?.slice(0, 8).map((assignee: any, index: number) => (
                  <div key={assignee.id} className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <span className="text-sm font-medium text-muted-foreground w-6">
                        #{index + 1}
                      </span>
                      {assignee.avatar_url ? (
                        <Image
                          src={assignee.avatar_url}
                          alt={assignee.name || 'User'}
                          width={32}
                          height={32}
                          className="rounded-full"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center text-xs font-medium">
                          {assignee.name?.charAt(0) || 'U'}
                        </div>
                      )}
                      <span className="text-sm font-medium">{assignee.name || 'Unknown'}</span>
                    </div>
                    <span className="text-sm font-semibold">{assignee.count}</span>
                  </div>
                ))}
              </div>
            </motion.div>

            {/* Issues Over Time */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="bg-card rounded-lg border border-border p-6"
            >
              <h2 className="text-lg font-semibold mb-4">Issues Created (Last 30 Days)</h2>
              {analytics.issuesOverTime && analytics.issuesOverTime.length > 0 ? (
                <div className="space-y-2">
                  <div className="flex items-end gap-1 h-32">
                    {analytics.issuesOverTime.map((item: any) => {
                      const maxCount = Math.max(
                        ...analytics.issuesOverTime.map((i: any) => i.count)
                      )
                      const height = maxCount > 0 ? (item.count / maxCount) * 100 : 0
                      return (
                        <div
                          key={item.date}
                          className="flex-1 bg-primary rounded-t transition-all hover:bg-primary/80"
                          style={{ height: `${Math.max(height, 2)}%` }}
                          title={`${formatDateLabel(item.date)}: ${item.count} issues`}
                        />
                      )
                    })}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground pt-2">
                    <span>
                      {analytics.issuesOverTime[0]?.date ? formatDateLabel(analytics.issuesOverTime[0].date) : ''}
                    </span>
                    <span>
                      {analytics.issuesOverTime[analytics.issuesOverTime.length - 1]?.date ? formatDateLabel(analytics.issuesOverTime[analytics.issuesOverTime.length - 1].date) : ''}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-center py-8 text-muted-foreground">
                  <Clock className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No data available</p>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </main>
    </div>
  )
}

