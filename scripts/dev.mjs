/**
 * Запускает вместе Python-бэкенд бота и Vite-интерфейс.
 * Аргументы командной строки (--host, --port и т.п.) передаются в Vite.
 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const py = path.join(root, '.venv', 'bin', 'python')

// Экран может погаснуть. Пока жив этот процесс, Mac не уходит в сон,
// иначе сканер замирает. Закрытая крышка ноутбука всё равно усыпляет систему.
if (process.platform === 'darwin') {
  spawn('caffeinate', ['-i', '-w', String(process.pid)], { stdio: 'ignore' })
}

const server = spawn(py, ['-m', 'uvicorn', 'server.main:app', '--host', '127.0.0.1', '--port', '8100'], {
  cwd: root,
  stdio: ['ignore', 'inherit', 'inherit'],
})

// аргументы CLI (--host/--port и пр.) передаём Vite, чтобы хост/порт управлялись снаружи
const vite = spawn('npx', ['vite', ...process.argv.slice(2)], {
  cwd: path.join(root, 'app'),
  stdio: 'inherit',
  shell: false,
})

function shutdown(code = 0) {
  server.kill('SIGTERM')
  vite.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}
process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))
server.on('exit', (c) => { if (c) shutdown(c) })
vite.on('exit', (c) => shutdown(c ?? 0))
