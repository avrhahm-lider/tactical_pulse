import { create } from 'zustand'
import { api } from '../services/api'
import type { User } from '../types'

interface AuthState {
  user: User | null
  isAuthenticated: boolean
  isLoading: boolean
  error: string | null
  login: (username: string, password: string) => Promise<boolean>
  logout: () => Promise<void>
  initAuth: () => Promise<void>
  clearError: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,
  error: null,

  login: async (username: string, password: string) => {
    set({ isLoading: true, error: null })
    try {
      const data = await api.auth.login(username, password)
      localStorage.setItem('access_token', data.access_token)
      localStorage.setItem('refresh_token', data.refresh_token)
      set({ user: data.user, isAuthenticated: true, isLoading: false, error: null })
      return true
    } catch (err: unknown) {
      const axiosErr = err as {
        message?: string
        code?: string
        response?: { status?: number; data?: { error?: { message?: string; code?: string } } }
      }

      console.group('%c[Tactical Pulse] Authentication Error Details', 'color: #ef4444; font-weight: bold; font-size: 12px;')
      console.error('Target Endpoint:', 'http://localhost:8000/api/v1/auth/login')
      console.error('Error Code:', axiosErr.code || 'UNKNOWN')
      console.error('Error Message:', axiosErr.message || 'No message')
      console.error('HTTP Status:', axiosErr.response?.status ?? 'None (No response received from server)')
      console.error('Server Response Data:', axiosErr.response?.data ?? 'None')
      console.error('Full Error Object:', err)
      console.groupEnd()

      let message = 'Login failed. Please check credentials.'

      if (!axiosErr.response) {
        // No HTTP response was received — server is offline, port is closed, or CORS failed
        message = `Cannot reach backend server at http://localhost:8000 (${axiosErr.code || 'ERR_CONNECTION_REFUSED'}). Is the FastAPI backend running?`
      } else if (axiosErr.response.data?.error?.message) {
        message = `${axiosErr.response.data.error.message} (${axiosErr.response.status})`
      } else if (axiosErr.response.status === 401) {
        message = 'Invalid username or password (401 Unauthorized).'
      } else if (axiosErr.response.status === 429) {
        message = 'Too many login attempts. Account temporarily locked (429 Rate Limited).'
      } else {
        message = `Server returned HTTP ${axiosErr.response.status}.`
      }

      set({ error: message, isLoading: false, isAuthenticated: false, user: null })
      return false
    }
  },

  logout: async () => {
    set({ isLoading: true })
    try {
      await api.auth.logout()
    } finally {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false, isLoading: false, error: null })
    }
  },

  initAuth: async () => {
    const token = localStorage.getItem('access_token')
    if (!token) {
      set({ isLoading: false, isAuthenticated: false, user: null })
      return
    }

    try {
      const user = await api.auth.getMe()
      set({ user, isAuthenticated: true, isLoading: false, error: null })
    } catch {
      localStorage.removeItem('access_token')
      localStorage.removeItem('refresh_token')
      set({ user: null, isAuthenticated: false, isLoading: false })
    }
  },

  clearError: () => set({ error: null }),
}))
