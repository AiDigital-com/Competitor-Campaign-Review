/**
 * Mobile intake — normalized landing form: email → organization → brand URL/name.
 * Matches AIO mobile shape so lead capture is consistent across products.
 */
import { useState } from 'react'

interface Props {
  onSubmit: (email: string, org: string, brandInput: string) => void
}

export function MobileIntake({ onSubmit }: Props) {
  const [email, setEmail] = useState('')
  const [org, setOrg] = useState('')
  const [brand, setBrand] = useState('')

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!email.trim() || !org.trim() || !brand.trim()) return
    onSubmit(email.trim(), org.trim(), brand.trim())
  }

  return (
    <div className="ccr-m-intake">
      <h1 className="ccr-m-intake-title">Campaign Intelligence</h1>
      <p className="ccr-m-intake-desc">
        Enter a brand name or URL to analyze competitor campaigns, creative
        strategies, and ad spend.
      </p>

      <form onSubmit={handleSubmit} className="ccr-m-intake-form">
        <div className="ccr-m-field">
          <label className="ccr-m-field-label" htmlFor="ccr-email">Your work email</label>
          <input
            id="ccr-email"
            type="email"
            className="ccr-m-input"
            placeholder="you@company.com"
            value={email}
            onChange={e => setEmail(e.target.value)}
            required
            autoFocus
          />
        </div>

        <div className="ccr-m-field">
          <label className="ccr-m-field-label" htmlFor="ccr-org">Your organization</label>
          <input
            id="ccr-org"
            type="text"
            className="ccr-m-input"
            placeholder="e.g. Acme Corp"
            value={org}
            onChange={e => setOrg(e.target.value)}
            required
          />
        </div>

        <div className="ccr-m-field">
          <label className="ccr-m-field-label" htmlFor="ccr-brand">Brand to analyze</label>
          <input
            id="ccr-brand"
            type="text"
            className="ccr-m-input"
            placeholder="e.g. coca cola, equitable.com"
            value={brand}
            onChange={e => setBrand(e.target.value)}
            required
          />
        </div>

        <button
          type="submit"
          className="ccr-m-btn"
          disabled={!email.trim() || !org.trim() || !brand.trim()}
        >
          Analyze
        </button>

        <p className="ccr-m-intake-privacy">
          We'll only use your email to send you the report. No spam.
        </p>
      </form>
    </div>
  )
}
