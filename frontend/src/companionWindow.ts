export type CompanionConfig = {
  roomId: string;
  serverUrl: string;
  mode: number;
};

export type OverlayKind = 'mini' | 'popout';

const OVERLAY_OPTS: Record<
  OverlayKind,
  { windowName: string; width: number; height: number }
> = {
  mini: { windowName: 'CloudControllerMini', width: 260, height: 200 },
  popout: { windowName: 'CloudControllerPopout', width: 280, height: 220 },
};

export function openOverlayWindow(
  config: CompanionConfig,
  kind: OverlayKind
): Window | null {
  const { windowName, width, height } = OVERLAY_OPTS[kind];
  const params = new URLSearchParams({
    companion: '1',
    room: config.roomId,
    server: config.serverUrl,
    mode: String(config.mode),
    overlay: kind,
  });
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = `${base}?${params.toString()}`;

  const w = window.open(
    url,
    windowName,
    `width=${width},height=${height},left=60,top=60,resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no`
  );

  return w ?? null;
}

/** @deprecated use openOverlayWindow(config, 'mini') */
export function openCompanionWindow(config: CompanionConfig): Window | null {
  return openOverlayWindow(config, 'mini');
}

export function openPopoutWindow(config: CompanionConfig): Window | null {
  return openOverlayWindow(config, 'popout');
}
