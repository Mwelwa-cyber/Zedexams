/**
 * Behaviour tests for useAssessmentExport — the dup-click guard and the
 * client-side fallback. The network client is mocked so no firebase loads.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'

// Mock the client module BEFORE importing the hook. The vi.mock factory is
// hoisted, so everything it references must be defined inside it.
const startBrandedDownload = vi.fn()
vi.mock('../utils/assessmentExportClient.js', () => {
  class AssessmentExportError extends Error {
    constructor(message, code) { super(message); this.name = 'AssessmentExportError'; this.code = code }
  }
  return {
    startBrandedDownload: (...args) => startBrandedDownload(...args),
    AssessmentExportError,
  }
})

import { useAssessmentExport } from './useAssessmentExport.js'
import { AssessmentExportError } from '../utils/assessmentExportClient.js'

describe('useAssessmentExport', () => {
  beforeEach(() => { startBrandedDownload.mockReset() })

  it('runs a branded download and reports ready', async () => {
    startBrandedDownload.mockResolvedValue({ status: 'ready', cacheHit: true })
    const { result } = renderHook(() => useAssessmentExport('asmt1'))
    await act(async () => { await result.current.run('paper-docx') })
    expect(startBrandedDownload).toHaveBeenCalledTimes(1)
    expect(result.current.states['paper-docx'].status).toBe('ready')
  })

  it('refuses a second concurrent click for the same export type (dup-click guard)', async () => {
    let resolve
    startBrandedDownload.mockImplementation(() => new Promise((r) => { resolve = () => r({ status: 'ready' }) }))
    const { result } = renderHook(() => useAssessmentExport('asmt1'))
    // Fire twice in the same tick, before the first resolves.
    let p1; let p2
    await act(async () => {
      p1 = result.current.run('paper-docx')
      p2 = result.current.run('paper-docx')
      resolve()
      await Promise.all([p1, p2])
    })
    // Only the first click launched a job.
    expect(startBrandedDownload).toHaveBeenCalledTimes(1)
    expect(await p2).toBe(false)
  })

  it('allows different export types concurrently', async () => {
    startBrandedDownload.mockResolvedValue({ status: 'ready' })
    const { result } = renderHook(() => useAssessmentExport('asmt1'))
    await act(async () => {
      await Promise.all([result.current.run('paper-docx'), result.current.run('paper-pdf')])
    })
    expect(startBrandedDownload).toHaveBeenCalledTimes(2)
  })

  it('runs the fallback and records failureCode when the branded path throws', async () => {
    startBrandedDownload.mockRejectedValue(new AssessmentExportError('nope', 'TIMEOUT'))
    const onFallback = vi.fn()
    const { result } = renderHook(() => useAssessmentExport('asmt1'))
    let ok
    await act(async () => { ok = await result.current.run('paper-docx', { onFallback }) })
    expect(ok).toBe(false)
    expect(onFallback).toHaveBeenCalledTimes(1)
    expect(result.current.states['paper-docx'].status).toBe('failed')
    expect(result.current.states['paper-docx'].code).toBe('TIMEOUT')
  })
})
