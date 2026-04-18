/**
 * Test Setup - linear-jira-sync
 *
 * This file runs before each test file.
 * Add global test utilities and mocks here.
 */

import { beforeAll, afterAll, vi } from 'vitest'

// Mock console methods to capture log output in tests
beforeAll(() => {
  vi.spyOn(console, 'debug').mockImplementation(() => {})
  vi.spyOn(console, 'info').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterAll(() => {
  vi.restoreAllMocks()
})

// Add any global test utilities here
export {}
