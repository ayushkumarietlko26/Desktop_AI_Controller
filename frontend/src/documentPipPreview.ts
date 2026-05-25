import { MODE_COLORS, MODE_NAMES, TRACK_HEIGHT, TRACK_WIDTH } from './gestureEngine';

type DocumentPictureInPictureApi = {
  requestWindow: (options?: { width?: number; height?: number }) => Promise<Window>;
  window: Window | null;
};

let pipWindow: Window | null = null;
let pipCanvas: HTMLCanvasElement | null = null;
let pipCtx: CanvasRenderingContext2D | null = null;
let pipModeLabel: HTMLSpanElement | null = null;
let onCloseCallback: (() => void) | null = null;

function getApi(): DocumentPictureInPictureApi | null {
  const w = window as unknown as { documentPictureInPicture?: DocumentPictureInPictureApi };
  return w.documentPictureInPicture ?? null;
}

export function isDocumentPipSupported(): boolean {
  return getApi() != null;
}

export function isDocumentPipOpen(): boolean {
  return !!(pipWindow && !pipWindow.closed);
}

function cleanup(): void {
  pipWindow = null;
  pipCanvas = null;
  pipCtx = null;
  pipModeLabel = null;
  const cb = onCloseCallback;
  onCloseCallback = null;
  cb?.();
}

export async function openDocumentPipPreview(
  mode: number,
  onClosed?: () => void
): Promise<boolean> {
  const api = getApi();
  if (!api) return false;

  if (pipWindow && !pipWindow.closed) {
    pipWindow.focus();
    updateDocumentPipMode(mode);
    return true;
  }

  try {
    const w = await api.requestWindow({ width: 320, height: 280 });
    pipWindow = w;
    onCloseCallback = onClosed ?? null;

    const doc = w.document;
    doc.body.style.margin = '0';
    doc.body.style.background = '#0a0a0a';
    doc.body.style.overflow = 'hidden';
    doc.body.style.fontFamily = 'system-ui, sans-serif';

    const header = doc.createElement('div');
    header.style.cssText =
      'padding:4px 8px;font-size:10px;color:#0f0;background:rgba(0,0,0,0.9);display:flex;flex-direction:column;gap:2px;';

    pipModeLabel = doc.createElement('span');
    pipModeLabel.style.fontWeight = '700';
    pipModeLabel.style.fontSize = '11px';
    header.appendChild(pipModeLabel);

    const hint = doc.createElement('span');
    hint.style.color = '#aaa';
    hint.textContent = 'Stays on top · use with PowerPoint & other apps';
    header.appendChild(hint);

    const wrap = doc.createElement('div');
    wrap.style.cssText = 'width:100%;height:calc(100% - 40px);';

    pipCanvas = doc.createElement('canvas');
    pipCanvas.width = TRACK_WIDTH;
    pipCanvas.height = TRACK_HEIGHT;
    pipCanvas.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    wrap.appendChild(pipCanvas);

    doc.body.appendChild(header);
    doc.body.appendChild(wrap);

    pipCtx = pipCanvas.getContext('2d');
    updateDocumentPipMode(mode);

    w.addEventListener('pagehide', cleanup);
    return true;
  } catch (err) {
    console.error('Document PiP failed:', err);
    cleanup();
    return false;
  }
}

export function updateDocumentPipMode(mode: number): void {
  if (!pipModeLabel) return;
  const name = MODE_NAMES[mode] ?? 'MODE';
  const color = MODE_COLORS[mode] ?? '#0f0';
  pipModeLabel.textContent = name;
  pipModeLabel.style.color = color;
}

export function syncPreviewToDocumentPip(source: HTMLCanvasElement): void {
  if (!pipCtx || !pipCanvas || !pipWindow || pipWindow.closed) return;
  pipCtx.drawImage(source, 0, 0, pipCanvas.width, pipCanvas.height);
}

export function closeDocumentPipPreview(): void {
  if (pipWindow && !pipWindow.closed) {
    pipWindow.close();
  }
  cleanup();
}
