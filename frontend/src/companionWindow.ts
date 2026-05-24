export type CompanionConfig = {
  roomId: string;
  serverUrl: string;
  mode: number;
};

export function openCompanionWindow(config: CompanionConfig): Window | null {
  const params = new URLSearchParams({
    companion: '1',
    room: config.roomId,
    server: config.serverUrl,
    mode: String(config.mode),
  });
  const base = `${window.location.origin}${window.location.pathname}`;
  const url = `${base}?${params.toString()}`;

  const w = window.open(
    url,
    'CloudControllerMini',
    'width=220,height=170,left=60,top=60,resizable=yes,scrollbars=no,menubar=no,toolbar=no,location=no,status=no'
  );

  if (!w) {
    return null;
  }
  return w;
}
