import { NextRequest, NextResponse } from 'next/server'
import { resolveUser } from '@/lib/auth/resolve'
import { getAttachments, createAttachment, deleteAttachment, getAttachment, getIssue, getProjectMemberRole } from '@/lib/db'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const issueId = parseInt(id)
    if (isNaN(issueId)) {
      return NextResponse.json({ error: 'Invalid issue ID' }, { status: 400 })
    }

    const attachments = await getAttachments(issueId)
    return NextResponse.json(attachments)
  } catch (error) {
    console.error('Failed to fetch attachments:', error)
    return NextResponse.json(
      { error: 'Failed to fetch attachments' },
      { status: 500 }
    )
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const issueId = parseInt(id)
    if (isNaN(issueId)) {
      return NextResponse.json({ error: 'Invalid issue ID' }, { status: 400 })
    }

    const issue = await getIssue(issueId)
    if (!issue) {
      return NextResponse.json({ error: 'Issue not found' }, { status: 404 })
    }

    const role = await getProjectMemberRole(issue.project_id, user.id)
    if (!role || role === 'viewer') {
      return NextResponse.json(
        { error: 'Forbidden', suggestion: 'Only project members (non-viewer) can attach files' },
        { status: 403 }
      )
    }

    const body = await request.json()
    const { filename, file_url, file_size, mime_type } = body

    if (!filename || !file_url) {
      return NextResponse.json(
        { error: 'Filename and file_url are required' },
        { status: 400 }
      )
    }

    const attachment = await createAttachment({
      issue_id: issueId,
      filename,
      file_url,
      file_size,
      mime_type,
      uploaded_by: user.id,
    })

    return NextResponse.json(attachment, { status: 201 })
  } catch (error) {
    console.error('Failed to create attachment:', error)
    return NextResponse.json(
      { error: 'Failed to create attachment' },
      { status: 500 }
    )
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await resolveUser(request)
    if (!user) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { id } = await params
    const issueId = parseInt(id)
    if (isNaN(issueId)) {
      return NextResponse.json({ error: 'Invalid issue ID' }, { status: 400 })
    }

    const { searchParams } = new URL(request.url)
    const attachmentId = searchParams.get('attachmentId')

    if (!attachmentId) {
      return NextResponse.json(
        { error: 'Attachment ID is required', suggestion: 'Add ?attachmentId=123 to the URL' },
        { status: 400 }
      )
    }

    const attachment = await getAttachment(parseInt(attachmentId))
    if (!attachment) {
      return NextResponse.json({ error: 'Attachment not found' }, { status: 404 })
    }

    if (attachment.issue_id !== issueId) {
      return NextResponse.json({ error: 'Attachment does not belong to this issue' }, { status: 403 })
    }

    if (attachment.uploaded_by !== user.id) {
      const issue = await getIssue(issueId)
      if (issue) {
        const role = await getProjectMemberRole(issue.project_id, user.id)
        if (!role || !['owner', 'admin'].includes(role)) {
          return NextResponse.json(
            { error: 'Forbidden', suggestion: 'Only the uploader or project admins can delete attachments' },
            { status: 403 }
          )
        }
      }
    }

    await deleteAttachment(parseInt(attachmentId))
    return NextResponse.json({ success: true })
  } catch (error) {
    console.error('Failed to delete attachment:', error)
    return NextResponse.json(
      { error: 'Failed to delete attachment' },
      { status: 500 }
    )
  }
}
