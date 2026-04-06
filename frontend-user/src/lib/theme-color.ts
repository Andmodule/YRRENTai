/** Browser chrome: light; dark matches sidebar/logo row (slate-900, same as globals --card in dark). */
export const THEME_COLOR_LIGHT = '#ffffff';
export const THEME_COLOR_DARK = '#0f172a';

/**
 * Runs before paint: reads next-themes storage (`theme`) + system preference.
 * Removes any existing theme-color metas (including Next viewport), appends one.
 */
export function buildThemeColorInitScript(): string {
  const L = JSON.stringify(THEME_COLOR_LIGHT);
  const D = JSON.stringify(THEME_COLOR_DARK);
  return `(function(){var L=${L},D=${D};function c(){try{var t=localStorage.getItem('theme');if(t==='dark')return D;if(t==='light')return L;return window.matchMedia('(prefers-color-scheme:dark)').matches?D:L;}catch(e){return L;}}var x=c();document.querySelectorAll('meta[name="theme-color"]').forEach(function(m){m.remove();});var e=document.createElement('meta');e.setAttribute('name','theme-color');e.setAttribute('content',x);document.head.appendChild(e);})();`;
}
