import { create } from 'zustand'
import type { MyPlatformAuth, PlatformAuthStatus } from '@music-together/shared'

interface AuthState {
  platformStatus: PlatformAuthStatus[]
  myStatus: MyPlatformAuth[]
  statusLoaded: boolean
  setPlatformStatus: (status: PlatformAuthStatus[]) => void
  setMyStatus: (status: MyPlatformAuth[]) => void
  resetAuthStatus: () => void
}

export const useAuthStore = create<AuthState>((set) => ({
  platformStatus: [],
  myStatus: [],
  statusLoaded: false,
  setPlatformStatus: (platformStatus) => set({ platformStatus }),
  setMyStatus: (myStatus) => set({ myStatus, statusLoaded: true }),
  resetAuthStatus: () => set({ platformStatus: [], myStatus: [], statusLoaded: false }),
}))
