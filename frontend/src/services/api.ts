import axios from 'axios'
import type { AxiosError, InternalAxiosRequestConfig } from 'axios'
import type { AuthResponse, MapSnapshot, Threat, User, ApiError } from '../types'

export const API_BASE_URL = 'http://localhost:8000/api/v1'

export const apiClient = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
})

// Request interceptor to attach JWT token
apiClient.interceptors.request.use((config: InternalAxiosRequestConfig) => {
  const token = localStorage.getItem('access_token')
  if (token && config.headers) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

// Response interceptor for automatic token refresh on 401
apiClient.interceptors.response.use(
  (response) => response,
  async (error: AxiosError<ApiError>) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & { _retry?: boolean }

    if (error.response?.status === 401 && !originalRequest._retry) {
      originalRequest._retry = true
      const refreshToken = localStorage.getItem('refresh_token')

      if (refreshToken) {
        try {
          const res = await axios.post<{ access_token: string; refresh_token: string }>(
            `${API_BASE_URL}/auth/refresh`,
            { refresh_token: refreshToken }
          )

          localStorage.setItem('access_token', res.data.access_token)
          if (res.data.refresh_token) {
            localStorage.setItem('refresh_token', res.data.refresh_token)
          }

          if (originalRequest.headers) {
            originalRequest.headers.Authorization = `Bearer ${res.data.access_token}`
          }
          return apiClient(originalRequest)
        } catch {
          localStorage.removeItem('access_token')
          localStorage.removeItem('refresh_token')
          window.location.href = '/'
        }
      }
    }

    // Log all API errors to console for developer visibility
    console.error(
      `%c[Tactical Pulse API Error] ${error.config?.method?.toUpperCase() || 'REQUEST'} ${error.config?.url}`,
      'color: #ef4444; font-weight: bold;',
      {
        message: error.message,
        code: error.code,
        status: error.response?.status ?? 'No Response (Server unreachable)',
        data: error.response?.data,
      }
    )

    return Promise.reject(error)
  }
)

// API methods
export const api = {
  auth: {
    login: async (username: string, password: string): Promise<AuthResponse> => {
      const res = await apiClient.post<AuthResponse>('/auth/login', { username, password })
      return res.data
    },
    getMe: async (): Promise<User> => {
      const res = await apiClient.get<User>('/auth/me')
      return res.data
    },
    logout: async (): Promise<void> => {
      try {
        await apiClient.post('/auth/logout')
      } finally {
        localStorage.removeItem('access_token')
        localStorage.removeItem('refresh_token')
      }
    },
  },

  map: {
    getSnapshot: async (): Promise<MapSnapshot> => {
      const res = await apiClient.get<MapSnapshot>('/map/snapshot')
      return res.data
    },
  },

  threats: {
    create: async (payload: Partial<Threat>): Promise<Threat> => {
      const res = await apiClient.post<Threat>('/threats', payload)
      return res.data
    },
    update: async (threatId: string, payload: Partial<Threat>): Promise<Threat> => {
      const res = await apiClient.patch<Threat>(`/threats/${threatId}`, payload)
      return res.data
    },
  },

  admin: {
    getUsers: async (): Promise<User[]> => {
      const res = await apiClient.get<User[]>('/admin/users')
      return res.data
    },
    createUser: async (payload: unknown): Promise<User> => {
      const res = await apiClient.post<User>('/admin/users', payload)
      return res.data
    },
    updateStatus: async (userId: string, status: 'active' | 'inactive'): Promise<User> => {
      const res = await apiClient.patch<User>(`/admin/users/${userId}/status`, { status })
      return res.data
    },
  },
}
