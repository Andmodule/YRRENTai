import { create } from 'zustand';

interface InboxSearchState {
  query: string;
  searchOpen: boolean;
  setQuery: (query: string) => void;
  setSearchOpen: (open: boolean) => void;
  toggleSearch: () => void;
}

export const useInboxSearchStore = create<InboxSearchState>((set) => ({
  query: '',
  searchOpen: false,
  setQuery: (query) => set({ query }),
  setSearchOpen: (searchOpen) => set({ searchOpen }),
  toggleSearch: () => set((s) => ({ searchOpen: !s.searchOpen })),
}));
