export type IconName = 'paw' | 'arrow' | 'heart' | 'bulb' | 'clock' | 'pause' | 'play' | 'home' | 'close' | 'check' | 'lock' | 'leaf' | 'flag' | 'settings' | 'help' | 'refresh' | 'cup' | 'volume' | 'muted' | 'fullscreen';
export function Icon({ name, size = 24 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, React.ReactNode> = {
    paw: <><ellipse cx="7" cy="7" rx="2" ry="3"/><ellipse cx="17" cy="7" rx="2" ry="3"/><ellipse cx="3" cy="12" rx="1.5" ry="2"/><ellipse cx="21" cy="12" rx="1.5" ry="2"/><path d="M6 18q6-13 12 0 2 5-6 2-8 3-6-2Z"/></>,
    arrow: <path d="M4 12h16m-6-6 6 6-6 6"/>,
    heart: <path d="M12 21 3 12C-2 4 8-1 12 6 16-1 26 4 21 12Z"/>,
    bulb: <><path d="M8 16C-2 4 9-2 15 3s5 9 1 13H8Zm1 4h6m-5 3h4"/><path d="M10 8h4m-2 0v8"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 6v6l4 2"/></>,
    pause: <><path d="M7 4h3v16H7Zm7 0h3v16h-3Z"/></>,
    play: <path d="m8 4 12 8-12 8Z"/>,
    home: <><path d="m2 11 10-9 10 9M5 9v12h14V9M9 21v-7h6v7"/></>,
    close: <path d="m6 6 12 12M6 18 18 6"/>,
    check: <path d="m4 12 5 5L20 6"/>,
    lock: <><rect x="5" y="10" width="14" height="11" rx="3"/><path d="M8 10V6a4 4 0 0 1 8 0v4m-4 5v2"/></>,
    leaf: <><path d="M20 3C2 0-2 17 8 20 19 24 22 11 20 3ZM3 22 15 10"/></>,
    flag: <><path d="M5 22V3q4-3 8 0t8 0v12q-4 3-8 0t-8 0"/></>,
    settings: <><path d="M4 6h16M4 12h16M4 18h16"/><circle cx="8" cy="6" r="2" fill="currentColor"/><circle cx="16" cy="12" r="2" fill="currentColor"/><circle cx="9" cy="18" r="2" fill="currentColor"/></>,
    help: <><circle cx="12" cy="12" r="9"/><path d="M9 8a3 3 0 1 1 4 3q-1 1-1 3m0 3h.01"/></>,
    refresh: <><path d="M20 8A9 9 0 1 0 21 15M20 2v7h-7"/></>,
    fullscreen: <path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5" />,
    volume: <><path d="m11 4-6 5H2v6h3l6 5ZM15 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
    muted: <><path d="m11 4-6 5H2v6h3l6 5Zm5 5 6 6m0-6-6 6"/></>,
    cup: <><path d="M7 3h10v8a5 5 0 0 1-10 0V3Zm0 2H3v3q0 4 4 4m10-7h4v3q0 4-4 4m-5 4v5m-5 0h10"/></>,
  };
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}
