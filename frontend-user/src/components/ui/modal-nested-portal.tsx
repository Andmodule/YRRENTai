'use client';

import * as React from 'react';

const ModalNestedPortalContext = React.createContext<HTMLElement | null>(null);
const InsideModalNestedPortalContext = React.createContext(false);

/** DOM node inside Radix modal content — portaled overlays must mount here or Radix disables pointer events on `document.body` children. */
export function useModalNestedPortalContainer(): HTMLElement | null {
  return React.useContext(ModalNestedPortalContext);
}

/** True when rendered inside Drawer/Sheet/Dialog that wrap `ModalNestedPortalProvider`. */
export function useInsideModalNestedPortal(): boolean {
  return React.useContext(InsideModalNestedPortalContext);
}

/**
 * Wrap modal body (drawer / sheet / dialog). Renders an in-modal mount point as the last child so nested `createPortal` UIs receive taps on mobile.
 */
export function ModalNestedPortalProvider({ children }: { children: React.ReactNode }) {
  const [portalNode, setPortalNode] = React.useState<HTMLDivElement | null>(null);

  return (
    <InsideModalNestedPortalContext.Provider value={true}>
      <ModalNestedPortalContext.Provider value={portalNode}>
        {children}
        <div
          ref={setPortalNode}
          className="pointer-events-none absolute inset-0 z-[400] overflow-visible [&>*]:pointer-events-auto"
          aria-hidden
        />
      </ModalNestedPortalContext.Provider>
    </InsideModalNestedPortalContext.Provider>
  );
}
