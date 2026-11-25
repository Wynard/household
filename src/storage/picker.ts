// Google Picker (4.4). With the drive.file scope, picking a file or folder is
// what gives this phone access to it. Picking a folder doesn't grant access to
// the files inside, so joining picks the folder and then its files.
import { config } from '../config';
import { loadScript } from '../auth/google';
import { FOLDER_MIME } from './drive';

const GAPI_SRC = 'https://apis.google.com/js/api.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
type PickerNS = any;
declare global {
  interface Window {
    gapi?: { load(name: string, cb: () => void): void };
  }
}

let pickerReady: Promise<PickerNS> | null = null;
function loadPicker(): Promise<PickerNS> {
  if (!pickerReady)
    pickerReady = loadScript(GAPI_SRC).then(
      () =>
        new Promise<PickerNS>((resolve, reject) => {
          if (!window.gapi) return reject(new Error("Couldn't load the Google Picker."));
          window.gapi.load('picker', () => resolve((window as any).google.picker));
        }),
    );
  return pickerReady;
}

export interface Picked {
  id: string;
  name: string;
  mimeType: string;
}

async function open(
  token: string,
  build: (p: PickerNS) => any[],
  opts: { title: string; multi?: boolean },
): Promise<Picked[] | null> {
  if (!config.pickerApiKey || !config.googleProjectNumber)
    throw new Error('The Google Picker is not set up yet. See SETUP.md.');
  const p = await loadPicker();
  return new Promise((resolve) => {
    let b = new p.PickerBuilder()
      .setOAuthToken(token)
      .setDeveloperKey(config.pickerApiKey)
      .setAppId(config.googleProjectNumber)
      .setTitle(opts.title)
      .setOrigin(window.location.origin)
      .setCallback((data: any) => {
        const action = data[p.Response.ACTION];
        if (action === p.Action.PICKED) {
          const docs = (data[p.Response.DOCUMENTS] ?? []) as any[];
          resolve(
            docs.map((d) => ({
              id: d[p.Document.ID],
              name: d[p.Document.NAME],
              mimeType: d[p.Document.MIME_TYPE],
            })),
          );
        } else if (action === p.Action.CANCEL) resolve(null);
      });
    for (const v of build(p)) b = b.addView(v);
    if (opts.multi) b = b.enableFeature(p.Feature.MULTISELECT_ENABLED);
    b.build().setVisible(true);
  });
}

/** Step 1 of joining: pick the shared household folder. */
export function pickFolder(token: string): Promise<Picked[] | null> {
  return open(
    token,
    (p) => [
      new p.DocsView(p.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME)
        .setOwnedByMe(false),
      new p.DocsView(p.ViewId.FOLDERS)
        .setIncludeFolders(true)
        .setSelectFolderEnabled(true)
        .setMimeTypes(FOLDER_MIME),
    ],
    { title: 'Pick the household folder your partner shared with you' },
  );
}

/** Step 2: pick the data files inside the folder (all of them). */
export function pickFilesIn(token: string, folderId: string): Promise<Picked[] | null> {
  return open(
    token,
    (p) => [
      new p.DocsView(p.ViewId.DOCS)
        .setParent(folderId)
        .setIncludeFolders(false)
        .setMimeTypes('application/json,image/jpeg'),
    ],
    { title: 'Select every file in the folder, then tap Select', multi: true },
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */
