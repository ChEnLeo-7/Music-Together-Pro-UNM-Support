import { create } from 'zustand'

export interface AccountMe {
  id: string
  nickname: string
  avatarUrl: string | null
  hasPassword: boolean
  role: 'user' | 'admin'
}

interface AccountState {
  me: AccountMe | null
  loading: boolean
  setMe: (me: AccountMe | null) => void
  setLoading: (loading: boolean) => void
}

export const useAccountStore = create<AccountState>((set) => ({
  me: null,
  loading: false,
  setMe: (me) => set({ me }),
  setLoading: (loading) => set({ loading }),
}))
