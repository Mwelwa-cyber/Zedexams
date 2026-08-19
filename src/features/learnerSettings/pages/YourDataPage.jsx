// src/features/learnerSettings/pages/YourDataPage.jsx
//
// /settings/data — download a copy of your information, and the privacy
// choices attached to it.
//
// This exists as its own route because the two things on it used to sit
// underneath a learner's invoices and above an irreversible delete button, on
// a screen reached by a row labelled "Name & avatar". A child looking for a
// copy of their work had to scroll past their guardian's payment history to
// find it.
//
// The download is built entirely on the client from the profile already in
// memory — no callable, no export job, nothing queued. That is why it works
// offline and returns instantly, and it is the same mechanism the delete
// screen's "Download my work first" off-ramp uses.

import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import '../../../shared/styles/learnerTheme.css'
import { useAuth } from '../../../contexts/AuthContext'
import SeoHelmet from '../../../shared/components/SeoHelmet'
import { downloadMyData } from '../panels/AccountPanel'

export default function YourDataPage() {
  const navigate = useNavigate()
  const { currentUser, userProfile } = useAuth()
  const [toast, setToast] = useState('')
  const [error, setError] = useState('')

  const download = () => {
    setToast('')
    setError('')
    downloadMyData(currentUser, userProfile, (tone, msg) => {
      if (tone === 'success') setToast(msg)
      else setError(msg)
    })
  }

  return (
    <>
      <SeoHelmet title="Your data" path="/settings/data" noIndex />

      <div className="lhx-back-row">
        <button type="button" className="lhx-back-btn" aria-label="Back to Settings" onClick={() => navigate('/settings')}>‹</button>
        <div className="lhx-back-title">Your data</div>
      </div>

      <div className="lhx-av-card">
        <div className="lhx-av-bigname">Download a copy</div>
        <p className="lhx-del-intro" style={{ marginTop: 6 }}>
          Everything we hold about you, in one file you can keep. It saves
          straight to this device — nobody else is sent a copy.
        </p>
        <button type="button" className="lhx-btn lhx-btn-primary lhx-btn-block" onClick={download}>
          ⬇ Download my data
        </button>
        {toast && <p className="lhx-av-toast" role="status">✓ {toast}</p>}
        {error && <p className="lhx-av-error" role="alert">{error}</p>}
      </div>

      <div className="lhx-set-head">Your choices</div>
      <div className="lhx-set-group">
        <button type="button" className="lhx-set-row" onClick={() => navigate('/settings/guardian')}>
          <span className="lhx-set-ic" aria-hidden="true">🛡️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Who can see my progress</span>
            <span className="lhx-set-desc">Your grown-up, and the link you can switch off</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="lhx-set-row" onClick={() => navigate('/privacy')}>
          <span className="lhx-set-ic" aria-hidden="true">📄</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Privacy policy</span>
            <span className="lhx-set-desc">What we collect, and what we never do with it</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
        <button type="button" className="lhx-set-row lhx-set-danger" onClick={() => navigate('/settings/delete')}>
          <span className="lhx-set-ic" aria-hidden="true">🗑️</span>
          <span className="lhx-set-txt">
            <span className="lhx-set-title">Delete my account</span>
            <span className="lhx-set-desc">Read what happens first</span>
          </span>
          <span className="lhx-set-chev" aria-hidden="true">›</span>
        </button>
      </div>
    </>
  )
}
