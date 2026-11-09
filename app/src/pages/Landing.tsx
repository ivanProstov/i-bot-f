import { Link } from 'react-router'
import { Button } from '@/components/ui/button'
import Swarm from '@/sections/Swarm'

const NAV = [
  { href: '#market', label: 'Рынок' },
  { href: '#styles', label: 'Стили' },
  { href: '#signal', label: 'Карточка' },
  { href: '#accounts', label: 'Счета' },
  { href: '#enter', label: 'Вход' },
]

export default function Landing() {
  return (
    <div className="relative z-0">
      <Swarm variant="field" running scanning={false} offline={false} />
      <header className="sticky top-0 z-20 border-b border-border/80 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 md:px-8">
          <a href="#top" className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">
            Локатор
          </a>
          <nav className="hidden items-center gap-5 text-sm text-muted-foreground md:flex">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="hover:text-foreground">
                {item.label}
              </a>
            ))}
          </nav>
          <Button asChild size="sm" className="cursor-pointer">
            <Link to="/app">Войти</Link>
          </Button>
        </div>
      </header>

      <section id="top" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">Binance USDT-M</p>
        <div className="mt-6 grid items-center gap-12 lg:grid-cols-[1.15fr_0.85fr]">
          <div>
            <h1 className="max-w-3xl text-4xl font-semibold leading-[1.05] md:text-6xl">
              Сигналы по фьючерсам. Сделку открывает только кнопка.
            </h1>
            <p className="mt-6 max-w-xl text-lg text-muted-foreground">
              Локатор смотрит бессрочные пары, сверяет закрытые свечи и кладёт на карточку вход, тейк и стоп.
              Демо и реал разделены. Ордер сам не уходит, пока вы не нажмёте «Открыть демо» или «Открыть реал».
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Button asChild size="lg" className="cursor-pointer">
                <Link to="/app">Войти в локатор</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="cursor-pointer">
                <a href="#styles">Как устроен сигнал</a>
              </Button>
            </div>
          </div>
          <SampleCard />
        </div>
        <dl className="mt-12 grid gap-4 border-t border-border pt-8 sm:grid-cols-3">
          <Fact k="Пары" v="Только USDT-perpetual в статусе TRADING." />
          <Fact k="Свечи" v="Текущая, ещё не закрытая, отбрасывается." />
          <Fact k="Сторона" v="Если подошли и лонг, и шорт, остаётся лонг." />
        </dl>
      </section>

      <section id="market" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">02 · Рынок</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
          Сначала отбор, потом карточка
        </h2>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          Скан идёт по публичным свечам и тикерам. Ключи биржи для поиска сигнала не нужны:
          они нужны только в момент, когда вы сами открываете сделку.
        </p>
        <ol className="mt-10 grid gap-4 md:grid-cols-2">
          <Panel
            n="01"
            title="Объём"
            text="В работу попадают самые объёмные пары. Сколько их брать, задаётся в настройках локатора. По умолчанию это топ списка."
          />
          <Panel
            n="02"
            title="Закрытые свечи"
            text="Запрашивается 160 свечей. Формирующаяся свеча не участвует, чтобы сигнал не прыгал внутри ещё не закрытого бара."
          />
          <Panel
            n="03"
            title="Индикаторы"
            text="EMA20 и EMA50 задают сторону тренда. RSI смотрит, не зажат ли импульс в край. ATR меряет ход. Объём сравнивается со средней предыдущих 20 баров."
          />
          <Panel
            n="04"
            title="Один сигнал на свечу"
            text="Повтор той же пары, стороны и времени открытия свечи не выдаётся. Карточка не дублируется на каждом проходе сканера."
          />
        </ol>
      </section>

      <section id="styles" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">03 · Стили</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
          Два разных характера входа
        </h2>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          Смешанный режим сначала ищет консервативный сигнал. Если его нет, пробует агрессивный.
          Шорт — зеркало лонга, локатор его не прячет.
        </p>
        <div className="mt-10 grid gap-4 lg:grid-cols-2">
          <article className="rounded-2xl border border-border p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[hsl(var(--long))]">Консервативный</p>
            <h3 className="mt-3 text-2xl font-semibold">Вход по уже живому тренду</h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>EMA20 выше EMA50, цена выше EMA50. Для шорта — наоборот.</li>
              <li>Low касается зоны EMA20, close остаётся по свою сторону средней.</li>
              <li>RSI лонга в коридоре 45–68, шорта — 32–55.</li>
              <li>Цена не ушла от EMA20 дальше чем на 1.5 ATR.</li>
              <li>Объём не ниже 1.2× средней предыдущих 20 свечей.</li>
              <li>Тейк 2.5 ATR, стоп 1.2 ATR, отношение не ниже 1.8.</li>
            </ul>
          </article>
          <article className="rounded-2xl border border-border p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-[hsl(var(--short))]">Агрессивный</p>
            <h3 className="mt-3 text-2xl font-semibold">Вход на сломе</h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>EMA20 пересекла EMA50 в сторону сигнала.</li>
              <li>Либо RSI развернулся из зоны ниже 32 вверх, или из зоны выше 68 вниз.</li>
              <li>Объём не ниже 1.5× средней предыдущих 20 свечей.</li>
              <li>Тейк 1.3 ATR, стоп 0.7 ATR, отношение не ниже 1.4.</li>
              <li>Ход короче. Исход карточки считается по тем же правилам пути цены.</li>
            </ul>
          </article>
        </div>
      </section>

      <section id="signal" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">04 · Карточка</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
          Что происходит с сигналом после появления
        </h2>
        <div className="mt-10 grid gap-10 lg:grid-cols-[1.05fr_0.95fr] lg:items-center">
          <ol className="space-y-8">
            <Step
              n="1"
              title="Появилась карточка"
              text="На ней сторона, цена входа, тейк, стоп и отношение хода. Это ещё не ордер. Активных карточек одновременно немного: лимит задаётся в настройках."
            />
            <Step
              n="2"
              title="Цена идёт после входа"
              text="Исход считается по пути цены и по свечам, открытым не раньше сигнала. High и low за 24 часа из тикера не используются: узкий тейк за сутки почти всегда уже был пробит."
            />
            <Step
              n="3"
              title="Тейк, стоп или срок"
              text="Оба уровня в одном промежутке — это минус. Плюс пишется как процент тейка, минус как процент стопа. Истёкший сигнал хранит знак движения и в сумму шапки не входит."
            />
          </ol>
          <div className="rounded-2xl border border-border bg-card p-6 md:p-8">
            <p className="text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Кнопка «Обновить»</p>
            <p className="mt-3 text-2xl font-semibold leading-snug">Перепроверяет карточку и не открывает сделку.</p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Локатор заново берёт свечи и последнюю цену. Для консервативного сигнала сверяет живой тренд,
              сторону EMA20 и отношение от текущей цены до исходных тейка и стопа. Для агрессивного —
              держится ли пересечение средних и не вернулся ли RSI в край.
            </p>
            <p className="mt-4 text-sm leading-relaxed text-muted-foreground">
              Ответ на карточке: «Можно открывать», «Сейчас лучше не открывать», либо карточка закрывается,
              если тейк, стоп или срок уже случились.
            </p>
          </div>
        </div>
      </section>

      <section id="accounts" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">05 · Счета</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
          Демо и реал не смешиваются
        </h2>
        <p className="mt-5 max-w-2xl text-muted-foreground">
          Два разных хоста, два разных набора ключей, две разные кнопки. Ключ наружу не возвращается:
          кабинет показывает только, сохранён он или нет.
        </p>
        <div className="mt-10 grid gap-4 md:grid-cols-2">
          <article className="rounded-2xl border border-border p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Демо</p>
            <h3 className="mt-3 text-2xl font-semibold">Отдельный счёт Demo Futures</h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>Кнопка «Открыть демо» ставит сделку только по этой карточке.</li>
              <li>Автоторговля, если её включить, работает только здесь и открывает каждый сигнал один раз.</li>
              <li>Тейк и стоп уходят как условные алго-ордера: рынок по триггеру и закрытие всей позиции.</li>
            </ul>
          </article>
          <article className="rounded-2xl border border-border p-6 md:p-8">
            <p className="font-mono text-[11px] uppercase tracking-[0.22em] text-muted-foreground">Реал</p>
            <h3 className="mt-3 text-2xl font-semibold">Живой фьючерсный счёт</h3>
            <ul className="mt-5 space-y-3 text-sm leading-relaxed text-muted-foreground">
              <li>Кнопка «Открыть реал» не нажимается сама и не связана с демо-ключом.</li>
              <li>Автоторговля на реал не переносится.</li>
              <li>Токен просмотра видит локатор, но настройки и обе кнопки сделок для него закрыты.</li>
            </ul>
          </article>
        </div>
      </section>

      <section id="enter" className="mx-auto flex min-h-dvh scroll-mt-16 max-w-6xl flex-col justify-center px-4 py-16 md:px-8">
        <p className="text-[11px] uppercase tracking-[0.28em] text-muted-foreground">06 · Кабинет</p>
        <h2 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight md:text-5xl">
          Вход по токену, дальше — живой список
        </h2>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          <Panel n="01" title="Токен" text="Токен доступа открывает настройки и сделки. Токен просмотра оставляет кабинет только для чтения." />
          <Panel n="02" title="Список" text="Активные карточки, история исходов, обзор пар и демо-сделки. Интерфейс обновляется сам, примерно раз в несколько секунд." />
          <Panel n="03" title="Решение" text="Сигнал можно обновить, отключить или открыть сделку. Без кнопки ордер не ставится." />
        </div>
        <div className="mt-12 flex flex-col gap-6 border-t border-border pt-10 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-lg font-semibold">Локатор показывает, где условия сошлись.</p>
            <p className="mt-2 max-w-md text-sm text-muted-foreground">
              Он не обещает результат сделки. Срок жизни карточки, число пар и стиль входа меняются в кабинете.
            </p>
          </div>
          <Button asChild size="lg" className="cursor-pointer">
            <Link to="/app">Войти в локатор</Link>
          </Button>
        </div>
      </section>
    </div>
  )
}

function SampleCard() {
  return (
    <article className="rounded-2xl border border-border bg-card p-5 md:p-6">
      <div className="flex items-center justify-between gap-3">
        <p className="font-mono text-xs uppercase tracking-[0.18em] text-muted-foreground">Пример карточки</p>
        <span className="rounded-full border border-[hsl(var(--long))]/40 px-2 py-0.5 text-xs text-[hsl(var(--long))]">
          LONG
        </span>
      </div>
      <p className="mt-4 font-display text-3xl font-semibold">BTCUSDT</p>
      <p className="mt-1 text-sm text-muted-foreground">Консервативный · 15m · ещё не ордер</p>
      <dl className="mt-6 grid grid-cols-3 gap-3 text-sm">
        <div>
          <dt className="text-muted-foreground">Вход</dt>
          <dd className="mt-1 font-mono">64 200</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Тейк</dt>
          <dd className="mt-1 font-mono text-[hsl(var(--long))]">65 140</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Стоп</dt>
          <dd className="mt-1 font-mono text-[hsl(var(--short))]">63 750</dd>
        </div>
      </dl>
      <p className="mt-5 text-xs leading-relaxed text-muted-foreground">
        Цифры нарисованы для экрана. Живая карточка появляется только после входа в локатор.
      </p>
    </article>
  )
}

function Fact({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-sm font-semibold">{k}</dt>
      <dd className="mt-1 text-sm text-muted-foreground">{v}</dd>
    </div>
  )
}

function Panel({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="rounded-2xl border border-border bg-card p-6">
      <p className="font-mono text-[11px] tracking-[0.18em] text-muted-foreground">{n}</p>
      <h3 className="mt-2 text-xl font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{text}</p>
    </li>
  )
}

function Step({ n, title, text }: { n: string; title: string; text: string }) {
  return (
    <li className="flex gap-4">
      <span className="font-mono text-sm text-muted-foreground">{n}</span>
      <div>
        <h3 className="text-lg font-semibold">{title}</h3>
        <p className="mt-1 text-sm leading-relaxed text-muted-foreground">{text}</p>
      </div>
    </li>
  )
}
