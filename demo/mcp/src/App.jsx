import { useState, useEffect, useCallback } from 'react'
import './App.css'

function BalanceCard({ balance, address, onRefresh }) {
  const formatAddress = (addr) => {
    if (!addr) return '...'
    return `${addr.slice(0, 6)}...${addr.slice(-4)}`
  }

  return (
    <div className="balance-card">
      <div className="balance-left">
        <span className="balance-label">USDT0 Balance</span>
        <div className="balance-value">
          {balance !== null ? balance.toFixed(6) : '--'}
          <span className="currency">USDT0</span>
        </div>
        <div className="wallet-addr">{address || 'loading...'}</div>
      </div>
      <div className="balance-right">
        <span className="chain-badge">Plasma &middot; 9745</span>
        <button className="refresh-btn" onClick={onRefresh}>Refresh</button>
      </div>
    </div>
  )
}

function SummaryRow({ calls }) {
  const successful = calls.filter(c => c.status === 'success').length
  const failed = calls.filter(c => c.status === 'failed').length
  const totalSpent = calls
    .filter(c => c.status === 'success')
    .reduce((sum, c) => sum + (c.amount || 0), 0)

  return (
    <div className="summary-row">
      <div className="summary-stat">
        <div className="stat-label">Total Calls</div>
        <div className="stat-value blue">{calls.length}</div>
      </div>
      <div className="summary-stat">
        <div className="stat-label">Successful</div>
        <div className="stat-value green">{successful}</div>
      </div>
      <div className="summary-stat">
        <div className="stat-label">Failed</div>
        <div className="stat-value red">{failed}</div>
      </div>
      <div className="summary-stat">
        <div className="stat-label">Total Spent</div>
        <div className="stat-value yellow">{totalSpent.toFixed(6)} USDT0</div>
      </div>
    </div>
  )
}

function CallHistory({ calls }) {
  const reversed = [...calls].reverse()

  return (
    <div className="table-section">
      <div className="table-header">
        <h2>Tool Call History</h2>
      </div>
      <table>
        <thead>
          <tr>
            <th>Tool</th>
            <th>Amount</th>
            <th>Status</th>
            <th>Time</th>
          </tr>
        </thead>
        <tbody>
          {reversed.length === 0 ? (
            <tr>
              <td colSpan="4" className="empty-state">
                No tool calls yet. Run the MCP server to see data here.
              </td>
            </tr>
          ) : (
            reversed.map((call, i) => (
              <tr key={i}>
                <td className="td-tool">{call.tool}</td>
                <td className="td-amount">
                  {call.amount != null ? call.amount.toFixed(6) : '--'} USDT0
                </td>
                <td>
                  <span className={`td-status ${call.status === 'success' ? 'success' : 'failed'}`}>
                    {call.status === 'success' ? '\u2713' : '\u2717'} {call.status}
                  </span>
                </td>
                <td className="td-time">
                  {new Date(call.timestamp).toLocaleString()}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  )
}

function App() {
  const [balance, setBalance] = useState(null)
  const [address, setAddress] = useState(null)
  const [calls, setCalls] = useState([])

  const load = useCallback(async () => {
    try {
      const [balRes, callsRes] = await Promise.all([
        fetch('/api/balance'),
        fetch('/api/calls')
      ])
      const bal = await balRes.json()
      const callsData = await callsRes.json()

      setBalance(bal.balance)
      setAddress(bal.address)
      setCalls(Array.isArray(callsData) ? callsData : [])
    } catch (err) {
      console.error('Failed to load data:', err)
    }
  }, [])

  useEffect(() => {
    load()
    const interval = setInterval(load, 5000)
    return () => clearInterval(interval)
  }, [load])

  return (
    <div className="shell">
      <header>
        <h1><span className="logo">x402</span> MCP Dashboard</h1>
        <p className="subtitle">USDT0 on Plasma &middot; Tool call history</p>
      </header>

      <BalanceCard balance={balance} address={address} onRefresh={load} />
      <SummaryRow calls={calls} />
      <CallHistory calls={calls} />
    </div>
  )
}

export default App
