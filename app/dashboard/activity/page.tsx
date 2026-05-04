'use client'

import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { formatDistanceToNow } from 'date-fns'
import {
  Plus,
  Edit2,
  Trash2,
  ArrowRight,
  User,
  FileText,
  Target,
  Clock,
} from 'lucide-react'

interface Activity {
  id: number
  user_id: number
  user_name?: string
  user_avatar?: string
  operation_type: string
  table_name: string
  record_id: number
  old_data?: any
  new_data?: any
  created_at: string
}

const OPERATION_ICONS = {
  INSERT: Plus,
  UPDATE: Edit2,
  DELETE: Trash2,
}

const OPERATION_LABELS = {
  INSERT: 'created',
  UPDATE: 'updated',
  DELETE: 'deleted',
}

const TABLE_LABELS: Record<string, string> = {
  issues: 'issue',
  projects: 'project',
  milestones: 'milestone',
  comments: 'comment',
}

function formatActivityMessage(activity: Activity): string {
  const operation = OPERATION_LABELS[activity.operation_type as keyof typeof OPERATION_LABELS] || activity.operation_type.toLowerCase()
  const tableLabel = TABLE_LABELS[activity.table_name] || activity.table_name

  if (activity.operation_type === 'INSERT') {
    if (activity.table_name === 'issues' && activity.new_data?.title) {
      return `created issue "${activity.new_data.title}"`
    }
    return `created ${tableLabel} #${activity.record_id}`
  }

  if (activity.operation_type === 'UPDATE') {
    if (activity.table_name === 'issues') {
      if (activity.new_data?.status && activity.old_data?.status) {
        return `moved issue #${activity.record_id} from ${activity.old_data.status} to ${activity.new_data.status}`
      }
      if (activity.new_data?.title) {
        return `updated issue "${activity.new_data.title}"`
      }
      return `updated issue #${activity.record_id}`
    }
    return `updated ${tableLabel} #${activity.record_id}`
  }

  if (activity.operation_type === 'DELETE') {
    if (activity.table_name === 'issues' && activity.old_data?.title) {
      return `deleted issue "${activity.old_data.title}"`
    }
    return `deleted ${tableLabel} #${activity.record_id}`
  }

  return `${operation} ${tableLabel} #${activity.record_id}`
}

export default function ActivityPage() {
  const [limit] = useState(50)

  const { data: activities = [], isLoading } = useQuery<Activity[]>({
    queryKey: ['activity', limit],
    queryFn: async () => {
      const res = await fetch(`/api/activity?limit=${limit}`)
      if (!res.ok) throw new Error('Failed to fetch activity')
      return res.json()
    },
    refetchInterval: 30000, // Refetch every 30 seconds
  })

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-20 bg-card/80 backdrop-blur border-b border-border">
        <div className="px-6 py-4">
          <div>
            <h1 className="text-2xl font-bold">Activity</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Recent activity across all projects
            </p>
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="p-6">
        <div className="max-w-3xl mx-auto">
          {isLoading ? (
            <div className="space-y-4">
              {[...Array(10)].map((_, i) => (
                <div
                  key={i}
                  className="h-16 bg-card rounded-lg border border-border animate-pulse"
                />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div className="text-center py-24">
              <div className="inline-flex items-center justify-center w-16 h-16 bg-secondary rounded-2xl mb-4">
                <Clock className="w-8 h-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">No activity yet</h2>
              <p className="text-muted-foreground">
                Activity will appear here as you work on issues
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {activities.map((activity, index) => {
                const Icon = OPERATION_ICONS[activity.operation_type as keyof typeof OPERATION_ICONS] || FileText
                const message = formatActivityMessage(activity)

                return (
                  <motion.div
                    key={activity.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.02 }}
                    className="bg-card rounded-lg border border-border p-4 hover:border-primary/50 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      {activity.user_avatar ? (
                        <Image
                          src={activity.user_avatar}
                          alt={activity.user_name || 'User'}
                          width={32}
                          height={32}
                          className="rounded-full flex-shrink-0"
                        />
                      ) : (
                        <div className="w-8 h-8 bg-primary/20 rounded-full flex items-center justify-center flex-shrink-0">
                          <User size={16} className="text-primary" />
                        </div>
                      )}

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <span className="text-sm font-medium">
                            {activity.user_name || 'Unknown User'}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {formatDistanceToNow(new Date(activity.created_at))} ago
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <Icon size={14} className="text-muted-foreground flex-shrink-0" />
                          <span className="text-sm text-foreground">{message}</span>
                        </div>
                      </div>
                    </div>
                  </motion.div>
                )
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}

