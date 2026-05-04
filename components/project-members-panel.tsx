'use client'

import { useState, useMemo } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { motion, AnimatePresence } from 'framer-motion'
import Image from 'next/image'
import { toast } from 'sonner'
import {
  Users,
  UserPlus,
  X,
  Crown,
  User2,
  Search,
  Loader2,
  Trash2,
  Shield,
} from 'lucide-react'

interface Member {
  id: number
  user_id: number
  project_id: number
  role: string
  name?: string
  email?: string
  avatar_url?: string
  created_at?: string
}

interface User {
  id: number
  name?: string
  email: string
  avatar_url?: string
  role?: string
}

interface ProjectMembersPanelProps {
  projectId: number
  currentUserId: number
}

const ROLE_CONFIG = {
  owner: { label: 'Owner', color: 'text-amber-500', bg: 'bg-amber-500/10', icon: Crown },
  admin: { label: 'Admin', color: 'text-purple-500', bg: 'bg-purple-500/10', icon: Shield },
  member: { label: 'Member', color: 'text-blue-500', bg: 'bg-blue-500/10', icon: User2 },
  viewer: { label: 'Viewer', color: 'text-gray-500', bg: 'bg-gray-500/10', icon: User2 },
} as const

export function ProjectMembersPanel({ projectId, currentUserId }: ProjectMembersPanelProps) {
  const [showInviteModal, setShowInviteModal] = useState(false)
  const queryClient = useQueryClient()

  // Fetch project members
  const { data: members = [], isLoading } = useQuery({
    queryKey: ['project-members', projectId],
    queryFn: async () => {
      const res = await fetch(`/api/projects/${projectId}/members`)
      if (!res.ok) throw new Error('Failed to fetch members')
      return res.json() as Promise<Member[]>
    },
  })

  // Check if current user is owner/admin
  const currentUserMember = members.find(m => m.user_id === currentUserId)
  const isOwnerOrAdmin = currentUserMember?.role === 'owner' || currentUserMember?.role === 'admin'

  // Remove member mutation
  const removeMember = useMutation({
    mutationFn: async (userId: number) => {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId }),
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to remove member')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      toast.success('Member removed')
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleRemoveMember = (member: Member) => {
    // Can't remove yourself
    if (member.user_id === currentUserId) {
      toast.error("You can't remove yourself from the project")
      return
    }

    if (confirm(`Remove ${member.name || member.email} from this project?`)) {
      removeMember.mutate(member.user_id)
    }
  }

  return (
    <div className="bg-card rounded-xl border border-border">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-border">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
            <Users className="w-5 h-5 text-primary" />
          </div>
          <div>
            <h3 className="font-semibold">Team Members</h3>
            <p className="text-sm text-muted-foreground">
              {members.length} member{members.length !== 1 ? 's' : ''}
            </p>
          </div>
        </div>

        {isOwnerOrAdmin && (
          <button
            onClick={() => setShowInviteModal(true)}
            className="flex items-center gap-2 px-3 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
          >
            <UserPlus size={16} />
            Invite Member
          </button>
        )}
      </div>

      {/* Members list */}
      <div className="p-4">
        {isLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : members.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-12 h-12 mx-auto text-muted-foreground/50 mb-3" />
            <p className="text-muted-foreground">No members yet</p>
          </div>
        ) : (
          <div className="space-y-2">
            {members.map((member) => {
              const roleConfig = ROLE_CONFIG[member.role as keyof typeof ROLE_CONFIG] || ROLE_CONFIG.member
              const RoleIcon = roleConfig.icon
              const canRemove = isOwnerOrAdmin && member.user_id !== currentUserId

              return (
                <motion.div
                  key={member.user_id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    {/* Avatar */}
                    {member.avatar_url ? (
                      <Image
                        src={member.avatar_url}
                        alt={member.name || member.email || 'Member'}
                        width={40}
                        height={40}
                        className="rounded-full"
                      />
                    ) : (
                      <div className="w-10 h-10 bg-secondary rounded-full flex items-center justify-center">
                        <span className="text-sm font-medium">
                          {(member.name || member.email || '?').charAt(0).toUpperCase()}
                        </span>
                      </div>
                    )}

                    {/* Name and email */}
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm">
                          {member.name || 'Unknown'}
                        </span>
                        {member.user_id === currentUserId && (
                          <span className="text-xs text-muted-foreground">(you)</span>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {member.email}
                      </p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {/* Role badge */}
                    <span className={`flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full ${roleConfig.bg} ${roleConfig.color}`}>
                      <RoleIcon size={12} />
                      {roleConfig.label}
                    </span>

                    {/* Remove button */}
                    {canRemove && (
                      <button
                        onClick={() => handleRemoveMember(member)}
                        disabled={removeMember.isPending}
                        className="p-2 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="Remove member"
                      >
                        {removeMember.isPending ? (
                          <Loader2 size={16} className="animate-spin" />
                        ) : (
                          <Trash2 size={16} />
                        )}
                      </button>
                    )}
                  </div>
                </motion.div>
              )
            })}
          </div>
        )}
      </div>

      {/* Invite modal */}
      <AnimatePresence>
        {showInviteModal && (
          <InviteMemberModal
            projectId={projectId}
            existingMemberIds={members.map(m => m.user_id)}
            onClose={() => setShowInviteModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  )
}

function InviteMemberModal({
  projectId,
  existingMemberIds,
  onClose,
}: {
  projectId: number
  existingMemberIds: number[]
  onClose: () => void
}) {
  const [searchQuery, setSearchQuery] = useState('')
  const [selectedUser, setSelectedUser] = useState<User | null>(null)
  const [selectedRole, setSelectedRole] = useState<string>('member')
  const queryClient = useQueryClient()

  // Fetch all users
  const { data: users = [], isLoading: loadingUsers } = useQuery({
    queryKey: ['users'],
    queryFn: async () => {
      const res = await fetch('/api/users')
      if (!res.ok) throw new Error('Failed to fetch users')
      return res.json() as Promise<User[]>
    },
  })

  // Filter users not already members and matching search (memoized for performance)
  const availableUsers = useMemo(() => {
    return users.filter(user => {
      if (existingMemberIds.includes(user.id)) return false
      if (searchQuery) {
        const query = searchQuery.toLowerCase()
        const nameMatch = user.name?.toLowerCase().includes(query)
        const emailMatch = user.email.toLowerCase().includes(query)
        return nameMatch || emailMatch
      }
      return true
    })
  }, [users, existingMemberIds, searchQuery])

  // Add member mutation
  const addMember = useMutation({
    mutationFn: async ({ email, role }: { email: string; role: string }) => {
      const res = await fetch(`/api/projects/${projectId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, role }),
      })
      if (!res.ok) {
        const error = await res.json()
        throw new Error(error.error || 'Failed to add member')
      }
      return res.json()
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['project-members', projectId] })
      toast.success('Member added successfully')
      onClose()
    },
    onError: (error: Error) => {
      toast.error(error.message)
    },
  })

  const handleInvite = () => {
    if (!selectedUser) {
      toast.error('Please select a user')
      return
    }
    addMember.mutate({ email: selectedUser.email, role: selectedRole })
  }

  return (
    <>
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm z-40"
      />

      {/* Modal */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="fixed inset-0 flex items-center justify-center z-50 p-4"
      >
        <div className="bg-card rounded-2xl border border-border shadow-2xl w-full max-w-md">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-border">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                <UserPlus className="w-5 h-5 text-primary" />
              </div>
              <div>
                <h2 className="font-semibold">Invite Member</h2>
                <p className="text-sm text-muted-foreground">Add a team member to this project</p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="p-2 hover:bg-secondary rounded-lg transition-colors"
            >
              <X size={18} />
            </button>
          </div>

          {/* Content */}
          <div className="p-6 space-y-4">
            {/* Search input */}
            <div className="relative">
              <Search
                size={16}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              />
              <input
                type="text"
                placeholder="Search users by name or email..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-9 pr-4 py-2.5 bg-background border border-input rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                autoFocus
              />
            </div>

            {/* User list */}
            <div className="max-h-60 overflow-y-auto rounded-lg border border-input bg-background">
              {loadingUsers ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : availableUsers.length === 0 ? (
                <div className="text-center py-8 text-sm text-muted-foreground">
                  {searchQuery ? 'No users found matching your search' : 'No users available to invite'}
                </div>
              ) : (
                <div className="divide-y divide-border">
                  {availableUsers.map((user) => (
                    <button
                      key={user.id}
                      onClick={() => setSelectedUser(user)}
                      className={`w-full flex items-center gap-3 p-3 hover:bg-secondary/50 transition-colors text-left ${
                        selectedUser?.id === user.id ? 'bg-primary/10 border-l-2 border-primary' : ''
                      }`}
                    >
                      {user.avatar_url ? (
                        <Image
                          src={user.avatar_url}
                          alt={user.name || user.email}
                          width={36}
                          height={36}
                          className="rounded-full"
                        />
                      ) : (
                        <div className="w-9 h-9 bg-secondary rounded-full flex items-center justify-center">
                          <span className="text-sm font-medium">
                            {(user.name || user.email).charAt(0).toUpperCase()}
                          </span>
                        </div>
                      )}
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {user.name || 'Unknown'}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {user.email}
                        </p>
                      </div>
                      {selectedUser?.id === user.id && (
                        <div className="w-2 h-2 bg-primary rounded-full" />
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Role selection */}
            {selectedUser && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                className="space-y-2"
              >
                <label className="block text-sm font-medium">
                  Role for {selectedUser.name || selectedUser.email}
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {(['member', 'admin', 'viewer', 'owner'] as const).map((role) => {
                    const config = ROLE_CONFIG[role]
                    const Icon = config.icon
                    return (
                      <button
                        key={role}
                        onClick={() => setSelectedRole(role)}
                        className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-sm transition-colors ${
                          selectedRole === role
                            ? 'border-primary bg-primary/10'
                            : 'border-input hover:border-primary/50'
                        }`}
                      >
                        <Icon size={14} className={config.color} />
                        <span>{config.label}</span>
                      </button>
                    )
                  })}
                </div>
              </motion.div>
            )}
          </div>

          {/* Footer */}
          <div className="flex justify-end gap-3 px-6 py-4 border-t border-border">
            <button
              onClick={onClose}
              className="px-4 py-2 text-muted-foreground hover:text-foreground transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleInvite}
              disabled={!selectedUser || addMember.isPending}
              className="px-4 py-2 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors disabled:opacity-50"
            >
              {addMember.isPending ? (
                <span className="flex items-center gap-2">
                  <Loader2 size={16} className="animate-spin" />
                  Adding...
                </span>
              ) : (
                'Add Member'
              )}
            </button>
          </div>
        </div>
      </motion.div>
    </>
  )
}
