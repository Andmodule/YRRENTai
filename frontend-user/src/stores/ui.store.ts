import { create } from 'zustand';

interface UiState {
  sidebarOpen: boolean;
  activePropertyId: string | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  setActivePropertyId: (id: string | null) => void;
}

export const useUiStore = create<UiState>((set) => ({
  sidebarOpen: true,
  activePropertyId: null,
  toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  setActivePropertyId: (id) => set({ activePropertyId: id }),
}));
