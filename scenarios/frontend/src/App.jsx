import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import HomePage from './pages/HomePage'
import SimulationPage from './pages/SimulationPage'
import Pillar1Page from './pages/Pillar1Page'
import Pillar2Page from './pages/Pillar2Page'
import Pillar3Page from './pages/Pillar3Page'
import Pillar4Page from './pages/Pillar4Page'
import OOBPage from './pages/OOBPage'
import './index.css'

function TopNav() {
  return (
    <nav className="topnav">
      <NavLink to="/" className="nav-brand">⚡ AURA SSD</NavLink>
      <NavLink to="/pillar1" className={({isActive}) => isActive?'active':''}>P1 · FTL</NavLink>
      <NavLink to="/pillar2" className={({isActive}) => isActive?'active':''}>P2 · BBT</NavLink>
      <NavLink to="/pillar3" className={({isActive}) => isActive?'active':''}>P3 · ECC</NavLink>
      <NavLink to="/pillar4" className={({isActive}) => isActive?'active':''}>P4 · Logic</NavLink>
      <div className="nav-right">
        <NavLink to="/oob" className={({isActive}) => isActive?'active':''}>🔐 OOB</NavLink>
        <NavLink to="/simulation" className="btn btn-primary btn-sm">▶ Simulate</NavLink>
      </div>
    </nav>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <TopNav />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/simulation" element={<SimulationPage />} />
        <Route path="/pillar1" element={<Pillar1Page />} />
        <Route path="/pillar2" element={<Pillar2Page />} />
        <Route path="/pillar3" element={<Pillar3Page />} />
        <Route path="/pillar4" element={<Pillar4Page />} />
        <Route path="/oob" element={<OOBPage />} />
      </Routes>
    </BrowserRouter>
  )
}
