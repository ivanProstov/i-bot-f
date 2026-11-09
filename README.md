# i-bot-f

Сигналы по Binance USDT-M futures. Бот сам сделки не открывает: демо и реал — отдельные кнопки.

Контекст для следующего чата лежит в [AGENTS.md](AGENTS.md).

## Запуск сигнального бота

```bash
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
cd app && npm install && cd ..
npm run dev
```

Интерфейс: http://localhost:3000. API: http://127.0.0.1:8100.

Ключи Binance вводятся в настройках и пишутся в `server/keys.json`. Этот файл в git не входит.
