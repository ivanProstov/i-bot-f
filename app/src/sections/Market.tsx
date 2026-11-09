import { fmtPrice } from '@/lib/api'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { PairRow } from '@/types'

export default function Market({ pairs }: { pairs: PairRow[] }) {
  return (
    <section>
      <h2 className="mb-4 text-lg font-semibold">
        Рынок — {pairs.length} пар по объёму
      </h2>
      {pairs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border py-14 text-center text-muted-foreground">
          Данные появятся после первого сканирования.
        </div>
      ) : (
        <div className="overflow-hidden rounded-xl border border-border">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10">#</TableHead>
                <TableHead>Пара</TableHead>
                <TableHead className="text-right">Цена</TableHead>
                <TableHead className="text-right">24ч</TableHead>
                <TableHead className="hidden text-right md:table-cell">Объём, $ млн</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pairs.map((p, i) => {
                const up = p.change_pct >= 0
                return (
                  <TableRow key={p.symbol} className="font-mono text-sm">
                    <TableCell className="text-muted-foreground">{i + 1}</TableCell>
                    <TableCell className="font-semibold">{p.symbol}</TableCell>
                    <TableCell className="text-right">{fmtPrice(p.price)}</TableCell>
                    <TableCell
                      className={`text-right ${
                        up ? 'text-[hsl(var(--long))]' : 'text-[hsl(var(--short))]'
                      }`}
                    >
                      {up ? '+' : ''}
                      {p.change_pct.toFixed(2)}%
                    </TableCell>
                    <TableCell className="hidden text-right text-muted-foreground md:table-cell">
                      {p.volume_m.toLocaleString('ru-RU')}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  )
}
