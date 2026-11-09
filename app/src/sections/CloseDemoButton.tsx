import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { api } from '@/lib/api'

export default function CloseDemoButton({
  tradeId,
  closing = false,
  onClosed,
}: {
  tradeId: string
  closing?: boolean
  onClosed: () => void
}) {
  const [armed, setArmed] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const close = async () => {
    if (!armed) {
      setArmed(true)
      setError(null)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await api.closeDemoTrade(tradeId)
      onClosed()
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Не удалось закрыть демо-сделку')
      setArmed(false)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mt-3">
      <Button
        variant="outline"
        size="sm"
        onClick={close}
        disabled={busy || closing}
        className="cursor-pointer"
      >
        {busy || closing ? 'Закрываю…' : armed ? 'Подтвердить закрытие' : 'Закрыть демо'}
      </Button>
      {error ? <p className="mt-1 text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
