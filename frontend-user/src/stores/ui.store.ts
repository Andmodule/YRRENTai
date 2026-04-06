import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UiState {
  sidebarOpen: boolean;
  /** Desktop (lg+): narrow rail with icons only */
  sidebarCollapsed: boolean;
  activePropertyId: string | null;
  /** Callback, зарегистрированный FilterBar — Header вызывает при нажатии на иконку фильтра календаря */
  openCalendarFilter: (() => void) | null;
  /** Страница «Объекты» / «Персонал» регистрируют — Header вызывает «+» в шапке */
  propertyCreateHandler: (() => void) | null;
  staffInviteHandler: (() => void) | null;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebarCollapsed: () => void;
  setSidebarCollapsed: (collapsed: boolean) => void;
  setActivePropertyId: (id: string | null) => void;
  setOpenCalendarFilter: (fn: (() => void) | null) => void;
  setPropertyCreateHandler: (fn: (() => void) | null) => void;
  setStaffInviteHandler: (fn: (() => void) | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      sidebarCollapsed: false,
      activePropertyId: null,
      openCalendarFilter: null,
      propertyCreateHandler: null,
      staffInviteHandler: null,
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleSidebarCollapsed: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
      setActivePropertyId: (id) => set({ activePropertyId: id }),
      setOpenCalendarFilter: (fn) => set({ openCalendarFilter: fn }),
      setPropertyCreateHandler: (fn) => set({ propertyCreateHandler: fn }),
      setStaffInviteHandler: (fn) => set({ staffInviteHandler: fn }),
    }),
    {
      name: 'rentai-ui',
      partialize: (state) => ({ sidebarCollapsed: state.sidebarCollapsed }),
    },
  ),
);
