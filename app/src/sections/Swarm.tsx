import { useEffect, useRef } from 'react'
import { cn } from '@/lib/utils'

export type SwarmMood = 'search' | 'think' | 'wait' | 'pause' | 'offline'

const COPY: Record<SwarmMood, { title: string; hint: string }> = {
  search: { title: 'Ищет', hint: 'смотрит рынок' },
  think: { title: 'Думает', hint: 'сверяет условия' },
  wait: { title: 'Ждёт', hint: 'до следующего прохода' },
  pause: { title: 'Пауза', hint: 'сканер остановлен' },
  offline: { title: 'Тишина', hint: 'нет связи с ботом' },
}

interface Dot {
  x: number
  y: number
  vx: number
  vy: number
  seed: number
  ax: number
  ay: number
  az: number
  depth: number
}

function smoothstep(value: number): number {
  const t = Math.max(0, Math.min(1, value))
  return t * t * (3 - 2 * t)
}

/** Мягкий горб: нарастает и спадает, без скачка на границах. */
function smoothPulse(cycle: number, start: number, end: number, ramp: number): number {
  if (cycle <= start - ramp || cycle >= end + ramp) return 0
  if (cycle < start) return smoothstep((cycle - (start - ramp)) / ramp)
  if (cycle > end) return 1 - smoothstep((cycle - end) / ramp)
  return 1
}

function waveRgb(crest: number, offline: boolean): string {
  if (offline) return '132, 128, 122'
  const r = Math.round(12 + crest * 102)
  const g = Math.round(132 - crest * 58)
  const b = Math.round(148 + crest * 64)
  return `${r}, ${g}, ${b}`
}

function makeDots(count: number, width: number, height: number): Dot[] {
  return Array.from({ length: count }, () => {
    const ax = Math.random()
    const ay = Math.random() * 2 - 1
    return {
      x: ax * width,
      y: height * 0.36,
      vx: 0,
      vy: 0,
      seed: Math.random() * Math.PI * 2,
      ax,
      ay,
      az: Math.random() * 2 - 1,
      depth: ay,
    }
  })
}

export default function Swarm({
  running,
  scanning,
  offline,
  variant = 'instrument',
  className,
}: {
  running: boolean
  scanning: boolean
  offline: boolean
  variant?: 'instrument' | 'field'
  className?: string
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const titleRef = useRef<HTMLSpanElement>(null)
  const hintRef = useRef<HTMLSpanElement>(null)
  const state = useRef({ running, scanning, offline })
  state.current = { running, scanning, offline }

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const context = canvas.getContext('2d')
    if (!context) return

    const field = variant === 'field'
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    let dots: Dot[] = []
    let width = 0
    let height = 0
    let frame = 0
    let lastMood: SwarmMood | null = null
    let gather = 0
    let sweep = 0
    let calm = 1

    const resize = () => {
      const rect = canvas.getBoundingClientRect()
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      width = Math.max(1, rect.width)
      height = Math.max(1, rect.height)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      const count = field ? Math.round(Math.min(180, Math.max(70, (width * height) / 11000))) : 420
      if (dots.length !== count) dots = makeDots(count, width, height)
    }

    const paint = (time: number) => {
      const { running: isRunning, scanning: isScanning, offline: isOffline } = state.current
      const seconds = time / 1000
      const cycle = seconds % 14
      const think = isOffline || !isRunning ? 0 : isScanning ? 0.22 : smoothPulse(cycle, 9.2, 12.4, 1.8)
      const wantSweep = isScanning && !isOffline ? 1 : 0
      const wantCalm = isOffline ? 0 : isRunning ? 1 : 0.22
      gather += (think - gather) * 0.012
      sweep += (wantSweep - sweep) * 0.012
      calm += (wantCalm - calm) * 0.012

      const shown: SwarmMood = isOffline
        ? 'offline'
        : !isRunning
          ? 'pause'
          : sweep > 0.45
            ? 'search'
            : gather > 0.45
              ? 'think'
              : 'wait'
      if (!field && shown !== lastMood) {
        lastMood = shown
        if (titleRef.current) titleRef.current.textContent = COPY[shown].title
        if (hintRef.current) hintRef.current.textContent = COPY[shown].hint
      }

      if (field) {
        context.clearRect(0, 0, width, height)
      } else {
        context.fillStyle = 'rgba(255,252,247,0.2)'
        context.fillRect(0, 0, width, height)
      }

      const speed = (0.7 + sweep * 1.15 - gather * 0.15) * Math.max(calm, 0.2)
      const amp = Math.min(height * 0.2, 38) * (1 + gather * 0.28)

      for (const dot of dots) {
        let tx: number
        let ty: number
        if (field) {
          const along = dot.ax
          const swell = Math.sin(along * Math.PI * 3 - seconds * 0.25 + dot.seed)
          tx = along * width
          ty = height * (0.5 + swell * 0.28)
          dot.depth = (swell + 1) / 2
        } else {
          const span = 0.94 - gather * 0.06
          const along = 0.5 + (dot.ax - 0.5) * span
          const phase = along * Math.PI * 4.6 - seconds * speed
          const swell = Math.sin(phase) * 0.74 + Math.sin(phase * 0.45 + 0.8) * 0.26
          dot.depth = (swell + 1) / 2
          tx = along * width + dot.az * 10
          ty = height * 0.34 + swell * amp + dot.ay * (8 + gather * 3)
        }
        const pull = field ? 0.008 : 0.03
        dot.vx = dot.vx * 0.9 + (tx - dot.x) * pull
        dot.vy = dot.vy * 0.9 + (ty - dot.y) * pull
        if (!reduced && !isOffline) {
          dot.x += dot.vx * calm
          dot.y += dot.vy * calm
        }
      }

      if (!field) {
        const linkReach = 22 + (1 - gather) * 10
        context.lineWidth = 1
        for (let i = 0; i < dots.length; i += 1) {
          let nearest = -1
          let nearestDist = linkReach
          for (let j = i + 1; j < dots.length; j += 1) {
            const dist = Math.hypot(dots[i].x - dots[j].x, dots[i].y - dots[j].y)
            if (dist < nearestDist) {
              nearestDist = dist
              nearest = j
            }
          }
          if (nearest >= 0) {
            const fade = (1 - nearestDist / linkReach) * 0.22
            context.strokeStyle = `rgba(${waveRgb(dots[i].depth, isOffline)}, ${fade})`
            context.beginPath()
            context.moveTo(dots[i].x, dots[i].y)
            context.lineTo(dots[nearest].x, dots[nearest].y)
            context.stroke()
          }
        }
      }

      for (const dot of dots) {
        const crest = dot.depth
        const alpha = field
          ? isOffline ? 0.08 : 0.16
          : (isOffline ? 0.35 : 0.55 + crest * 0.4)
        context.fillStyle = `rgba(${waveRgb(crest, isOffline)}, ${alpha})`
        const size = field ? 1.3 : 1.15 + crest * 1.15
        context.beginPath()
        context.arc(dot.x, dot.y, size, 0, Math.PI * 2)
        context.fill()
      }
    }

    resize()
    paint(performance.now())
    const onResize = () => resize()
    window.addEventListener('resize', onResize)
    if (!reduced) {
      const loop = (time: number) => {
        paint(time)
        frame = requestAnimationFrame(loop)
      }
      frame = requestAnimationFrame(loop)
    }

    return () => {
      window.removeEventListener('resize', onResize)
      if (frame) cancelAnimationFrame(frame)
    }
  }, [variant])

  if (variant === 'field') {
    return <canvas ref={canvasRef} aria-hidden className="pointer-events-none fixed inset-0 -z-10 h-full w-full" />
  }

  return (
    <div className={cn('swarm-well relative h-28 overflow-hidden rounded-2xl', className)}>
      <canvas ref={canvasRef} aria-hidden className="absolute inset-0 h-full w-full" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between px-3.5 py-2.5">
        <div>
          <span ref={titleRef} className="font-display block text-sm leading-none tracking-tight text-foreground">
            Ждёт
          </span>
          <span ref={hintRef} className="mt-1 block text-[11px] text-muted-foreground">
            до следующего прохода
          </span>
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.22em] text-muted-foreground">рой</span>
      </div>
    </div>
  )
}
