'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, Square, RotateCcw, Loader2, MicOff } from 'lucide-react'
import { Modal } from '@/components/ui/modal'
import { Button } from '@/components/ui/button'

interface VoiceRecorderModalProps {
  open: boolean
  onClose: () => void
  /** Called with the finished recording as a File, ready to upload. */
  onRecorded: (file: File) => void
}

type RecorderState = 'requesting' | 'recording' | 'recorded' | 'denied' | 'unsupported' | 'nomic'

// Pick the first container the browser can actually record. Chrome/Firefox give
// us webm/opus; Safari only does mp4. The chosen mime drives the file extension
// and the stored content-type so the attachment renders as audio everywhere.
const CANDIDATE_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']

function pickMimeType(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of CANDIDATE_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return null
}

function extForMime(mime: string): string {
  if (mime.startsWith('audio/mp4')) return 'm4a' // .m4a → audio/mp4 in EXT_MIME
  return 'webm'
}

function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${s.toString().padStart(2, '0')}`
}

export function VoiceRecorderModal({ open, onClose, onRecorded }: VoiceRecorderModalProps) {
  const [state, setState] = useState<RecorderState>('requesting')
  const [seconds, setSeconds] = useState(0)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)

  const streamRef = useRef<MediaStream | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const mimeRef = useRef<string>('audio/webm')
  const blobRef = useRef<Blob | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const stopTimer = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
  }, [])

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
  }, [])

  const clearPreview = useCallback(() => {
    setPreviewUrl((prev) => {
      if (prev) URL.revokeObjectURL(prev)
      return null
    })
    blobRef.current = null
  }, [])

  // Fully tear down the mic + any in-flight recorder/timer/preview.
  const teardown = useCallback(() => {
    stopTimer()
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      try {
        recorderRef.current.stop()
      } catch {
        /* ignore */
      }
    }
    recorderRef.current = null
    releaseStream()
  }, [stopTimer, releaseStream])

  const startRecording = useCallback(async () => {
    setState('requesting')
    clearPreview()
    setSeconds(0)

    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setState('unsupported')
      return
    }
    if (typeof window !== 'undefined' && window.isSecureContext === false) {
      setState('unsupported')
      return
    }
    const mime = pickMimeType()
    if (!mime) {
      setState('unsupported')
      return
    }
    mimeRef.current = mime

    let stream: MediaStream
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    } catch (err) {
      const name = err instanceof DOMException ? err.name : ''
      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') setState('nomic')
      else setState('denied')
      return
    }

    streamRef.current = stream
    chunksRef.current = []
    const recorder = new MediaRecorder(stream, { mimeType: mime })
    recorderRef.current = recorder

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
    }
    recorder.onstop = () => {
      stopTimer()
      releaseStream()
      const blob = new Blob(chunksRef.current, { type: mime })
      blobRef.current = blob
      setPreviewUrl(URL.createObjectURL(blob))
      setState('recorded')
    }

    recorder.start()
    setState('recording')
    timerRef.current = setInterval(() => setSeconds((s) => s + 1), 1000)
  }, [clearPreview, stopTimer, releaseStream])

  // Kick off a fresh request whenever the modal opens; tear everything down when
  // it closes or the component unmounts (so the mic indicator never lingers).
  useEffect(() => {
    if (open) {
      void startRecording()
    } else {
      teardown()
      clearPreview()
    }
    return () => {
      teardown()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const stopRecording = useCallback(() => {
    if (recorderRef.current && recorderRef.current.state !== 'inactive') {
      recorderRef.current.stop()
    }
  }, [])

  const handleInsert = useCallback(() => {
    const blob = blobRef.current
    if (!blob) return
    const mime = mimeRef.current
    const stamp = new Date()
      .toISOString()
      .slice(0, 16)
      .replace('T', ' ')
      .replace(':', '-')
    const file = new File([blob], `Voice note ${stamp}.${extForMime(mime)}`, { type: mime })
    onRecorded(file)
    onClose()
  }, [onRecorded, onClose])

  // Keyboard: Enter stops while recording, then Enter again inserts the take.
  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Enter') return
      if (state === 'recording') {
        e.preventDefault()
        stopRecording()
      } else if (state === 'recorded') {
        e.preventDefault()
        handleInsert()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, state, stopRecording, handleInsert])

  return (
    <Modal open={open} onClose={onClose} title="Voice note" widthClass="max-w-sm">
      <div className="flex flex-col items-center gap-5 py-2">
        {state === 'requesting' && (
          <div className="flex flex-col items-center gap-3 py-4 text-muted-foreground">
            <Loader2 size={28} className="animate-spin" />
            <p className="text-sm">Requesting microphone…</p>
          </div>
        )}

        {state === 'recording' && (
          <>
            <div className="relative flex h-20 w-20 items-center justify-center">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-red-500/30" />
              <span className="relative inline-flex h-16 w-16 items-center justify-center rounded-full bg-red-500/15 text-red-500">
                <Mic size={28} />
              </span>
            </div>
            <p className="font-mono text-2xl tabular-nums">{formatTime(seconds)}</p>
            <Button onClick={stopRecording} variant="default" className="gap-2">
              <Square size={14} className="fill-current" />
              Stop
            </Button>
            <p className="text-[11px] text-muted-foreground">Enter to stop · Esc to cancel</p>
          </>
        )}

        {state === 'recorded' && previewUrl && (
          <>
            <audio src={previewUrl} controls className="w-full" />
            <div className="flex w-full items-center gap-2">
              <Button onClick={() => startRecording()} variant="outline" className="flex-1 gap-2">
                <RotateCcw size={14} />
                Re-record
              </Button>
              <Button onClick={handleInsert} variant="default" className="flex-1 gap-2">
                <Mic size={14} />
                Insert
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Enter to insert · Esc to cancel</p>
          </>
        )}

        {(state === 'denied' || state === 'nomic' || state === 'unsupported') && (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <span className="inline-flex h-14 w-14 items-center justify-center rounded-full bg-secondary text-muted-foreground">
              <MicOff size={24} />
            </span>
            <p className="text-sm font-medium">
              {state === 'denied' && 'Microphone access is blocked'}
              {state === 'nomic' && 'No microphone found'}
              {state === 'unsupported' && 'Recording is unavailable'}
            </p>
            <p className="max-w-[18rem] text-xs text-muted-foreground">
              {state === 'denied' &&
                'Allow microphone access for this site in your browser settings, then try again.'}
              {state === 'nomic' && 'Connect a microphone and try again.'}
              {state === 'unsupported' &&
                'Voice recording needs a supported browser on a secure (https) connection.'}
            </p>
            {state !== 'unsupported' && (
              <Button onClick={() => startRecording()} variant="outline" className="mt-1 gap-2">
                <RotateCcw size={14} />
                Try again
              </Button>
            )}
          </div>
        )}
      </div>
    </Modal>
  )
}
