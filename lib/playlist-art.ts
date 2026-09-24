export const ART_SIZE = 1024;

export type ArtEffect = "none" | "mono" | "sepia" | "bright" | "contrast";

export type ArtLayer = {
  id: string;
  kind: "image" | "text" | "sticker" | "draw";
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
  hidden: boolean;
  locked: boolean;
  src?: string;
  text?: string;
  fontSize?: number;
  fontFamily?: string;
  color?: string;
  effect?: ArtEffect;
  points?: number[];
  strokeWidth?: number;
};

export type ArtProject = {
  backgroundColor: string;
  backgroundSrc?: string;
  backgroundEffect: ArtEffect;
  layers: ArtLayer[];
};

export function newArtProject(coverDataUrl?: string): ArtProject {
  return { backgroundColor: "#f7f3ec", backgroundSrc: coverDataUrl, backgroundEffect: "none", layers: [] };
}

const DB_NAME = "umroos-playlist-art";
const STORE = "projects";

function openProjectDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function readArtProject(id: string): Promise<ArtProject | undefined> {
  const db = await openProjectDb();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction(STORE, "readonly").objectStore(STORE).get(id);
      request.onsuccess = () => resolve(request.result as ArtProject | undefined);
      request.onerror = () => reject(request.error);
    });
  } finally { db.close(); }
}

export async function storeArtProject(id: string, project: ArtProject): Promise<void> {
  const db = await openProjectDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, "readwrite");
      transaction.objectStore(STORE).put(project, id);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
