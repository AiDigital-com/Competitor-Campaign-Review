/**
 * Mobile intake — single brand URL input.
 */
import { useState } from 'react'

interface Props {
  onSubmit: (brandDomain: string) => void
}

export function MobileIntake({ onSubmit }: Props) {
  const [value, setValue] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const domain = value.trim().replace(/^https?:\/\//, '').replace(/\/.*$/, '').toLowerCase()
    if (domain) onSubmit(domain)
  }

  return (
    <div className="ccr-m-intake">
      <h1 className="ccr-m-intake-title">Campaign Intelligence</h1>
      <p className="ccr-m-intake-desc">Enter a brand URL to analyze competitor campaigns, creative strategies, and ad spend.</p>
      <form onSubmit={handleSubmit} className="ccr-m-intake-form">
        <input
          type="text"
          className="ccr-m-input"
          placeholder="e.g. equitable.com"
          value={value}
          onChange={e => setValue(e.target.value)}
          autoFocus
        />
        <button type="submit" className="ccr-m-btn" disabled={!value.trim()}>
          Analyze
        </button>
      </form>
    </div>
  )
}
