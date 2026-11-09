import { Routes, Route } from 'react-router'
import AuthGate from './lib/auth'
import Home from './pages/Home'
import Landing from './pages/Landing'

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route
        path="/app"
        element={
          <AuthGate>
            <Home />
          </AuthGate>
        }
      />
    </Routes>
  )
}
