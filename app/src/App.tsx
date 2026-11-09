import { Routes, Route } from 'react-router'
import AuthGate from './lib/auth'
import Home from './pages/Home'

export default function App() {
  return (
    <AuthGate>
      <Routes>
        <Route path="/" element={<Home />} />
      </Routes>
    </AuthGate>
  )
}
