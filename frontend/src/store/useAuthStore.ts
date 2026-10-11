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
      let message = 'Login failed. Please check credentials.'
      if (err && typeof err === 'object' && 'response' in err) {
        const axiosErr = err as { response?: { data?: { error?: { message?: string } } } }
        message = axiosErr.response?.data?.error?.message || message
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
