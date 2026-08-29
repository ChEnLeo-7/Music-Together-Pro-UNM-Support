import { create } from 'zustand'

export interface AccountMe {
  userId: string
  kind: 'guest' | 'account'
  username: string | null
  nickname: string
  avatarUrl: string | null
  role: 'user' | 'admin'
  mustChangePassword: boolean
  mustChangeUsername: boolean
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
