import Image from 'next/image'
import Link from 'next/link'
import { cn } from '@/lib/utils'

interface BrandProps {
  href?: string
  className?: string
  size?: 'sm' | 'md'
}

export function Brand({ href = '/', className, size = 'md' }: BrandProps) {
  const dim = size === 'sm' ? 24 : 28
  return (
    <Link
      href={href}
      aria-label="Blackcode Issues home"
      className={cn(
        'inline-flex items-center gap-2 font-semibold tracking-tight',
        size === 'sm' ? 'text-base' : 'text-lg',
        className,
      )}
    >
      <Image
        src="/logo.png"
        alt=""
        width={dim}
        height={dim}
        className="rounded-[6px]"
        priority
      />
      <span>Issues</span>
    </Link>
  )
}
