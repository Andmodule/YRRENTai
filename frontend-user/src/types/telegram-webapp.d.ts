/** Injected by https://telegram.org/js/telegram-web-app.js inside Telegram Mini App WebView. */
export {};

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string;
        initDataUnsafe?: { start_param?: string };
        themeParams: Partial<Record<string, string>>;
        ready: () => void;
        expand: () => void;
      };
    };
  }
}
