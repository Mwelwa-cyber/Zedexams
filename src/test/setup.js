/**
 * Vitest setup — runs before every `.spec` file (see vitest.config.js).
 *
 * - Pulls in jest-dom matchers (toBeInTheDocument, toHaveClass, …).
 * - Auto-unmounts React trees after each test so DOM state never leaks
 *   between specs.
 */
import '@testing-library/jest-dom/vitest'
import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'

afterEach(() => {
  cleanup()
})
