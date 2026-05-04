'use client'

import { useState, useEffect, useCallback } from 'react'
import { X, ZoomIn, ZoomOut, Download } from 'lucide-react'

interface ImageLightboxProps {
  src: string
  alt?: string
  onClose: () => void
}

export function ImageLightbox({ src, alt, onClose }: ImageLightboxProps) {
  const [scale, setScale] = useState(1)

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      onClose()
    } else if (e.key === '+' || e.key === '=') {
      setScale((s) => Math.min(s + 0.25, 3))
    } else if (e.key === '-') {
      setScale((s) => Math.max(s - 0.25, 0.5))
    }
  }, [onClose])

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown)
    document.body.style.overflow = 'hidden'

    return () => {
      document.removeEventListener('keydown', handleKeyDown)
      document.body.style.overflow = ''
    }
  }, [handleKeyDown])

  const handleDownload = () => {
    const link = document.createElement('a')
    link.href = src
    link.download = alt || 'image'
    link.target = '_blank'
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Controls */}
      <div className="absolute top-4 right-4 flex items-center gap-2 z-10">
        <button
          onClick={(e) => {
            e.stopPropagation()
            setScale((s) => Math.max(s - 0.25, 0.5))
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
          title="Zoom out (-)"
        >
          <ZoomOut size={20} />
        </button>
        <span className="text-white text-sm font-medium px-2 min-w-[60px] text-center">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={(e) => {
            e.stopPropagation()
            setScale((s) => Math.min(s + 0.25, 3))
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
          title="Zoom in (+)"
        >
          <ZoomIn size={20} />
        </button>
        <button
          onClick={(e) => {
            e.stopPropagation()
            handleDownload()
          }}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
          title="Download"
        >
          <Download size={20} />
        </button>
        <button
          onClick={onClose}
          className="p-2 bg-white/10 hover:bg-white/20 rounded-lg transition-colors text-white"
          title="Close (Esc)"
        >
          <X size={20} />
        </button>
      </div>

      {/* Image */}
      <div
        className="relative max-w-[90vw] max-h-[90vh] overflow-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <img
          src={src}
          alt={alt || 'Image'}
          style={{
            transform: `scale(${scale})`,
            transformOrigin: 'center center',
            transition: 'transform 0.2s ease',
          }}
          className="max-w-none"
        />
      </div>

      {/* Instructions */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/60 text-sm">
        Press Esc to close, +/- to zoom
      </div>
    </div>
  )
}

// Hook to manage lightbox state
export function useImageLightbox() {
  const [lightboxImage, setLightboxImage] = useState<{ src: string; alt?: string } | null>(null)

  const openLightbox = useCallback((src: string, alt?: string) => {
    setLightboxImage({ src, alt })
  }, [])

  const closeLightbox = useCallback(() => {
    setLightboxImage(null)
  }, [])

  return {
    lightboxImage,
    openLightbox,
    closeLightbox,
    LightboxComponent: lightboxImage ? (
      <ImageLightbox
        src={lightboxImage.src}
        alt={lightboxImage.alt}
        onClose={closeLightbox}
      />
    ) : null,
  }
}
