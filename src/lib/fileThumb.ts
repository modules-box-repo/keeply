// IndexedDB storage for full-resolution original media and attachments
const DB_NAME = "keeply_media_db";
const STORE_NAME = "media_files";

function getDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function saveMediaBlob(id: string, file: File | Blob): Promise<string> {
  const db = await getDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    const store = tx.objectStore(STORE_NAME);
    store.put({ id, blob: file, type: file.type });
    tx.oncomplete = () => resolve(id);
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMediaBlobUrl(id: string): Promise<string | null> {
  try {
    const db = await getDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(id);
      req.onsuccess = () => {
        if (req.result?.blob) {
          resolve(URL.createObjectURL(req.result.blob));
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export type Attachment = {
  id?: string;
  name: string;
  type: string;
  size: number;
  thumb?: string; // High quality thumbnail / original preview URL
};

export async function processFileAttachment(file: File): Promise<Attachment> {
  const fileId = "att_" + Math.random().toString(36).slice(2, 11) + "_" + Date.now();
  await saveMediaBlob(fileId, file);

  const isImage = file.type.startsWith("image/");
  const isVideo = file.type.startsWith("video/");

  if (isImage) {
    try {
      // 1280px high-definition crisp preview
      const thumb = await resizeImage(file, 1280);
      return { id: fileId, name: file.name, type: file.type, size: file.size, thumb };
    } catch {
      return { id: fileId, name: file.name, type: file.type, size: file.size };
    }
  }

  if (isVideo) {
    try {
      // 1280px high-definition crisp video poster frame
      const thumb = await captureVideoFrame(file, 1280);
      return { id: fileId, name: file.name, type: file.type, size: file.size, thumb };
    } catch {
      return { id: fileId, name: file.name, type: file.type, size: file.size };
    }
  }

  return {
    id: fileId,
    name: file.name,
    type: file.type || "application/octet-stream",
    size: file.size,
  };
}

function resizeImage(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let w = img.width, h = img.height;
        if (w > maxDim || h > maxDim) {
          if (w > h) {
            h = Math.round((h * maxDim) / w);
            w = maxDim;
          } else {
            w = Math.round((w * maxDim) / h);
            h = maxDim;
          }
        }
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return resolve(e.target?.result as string);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(img, 0, 0, w, h);
        // High quality 0.92
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      };
      img.onerror = reject;
      img.src = e.target?.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function captureVideoFrame(file: File, maxDim: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    const url = URL.createObjectURL(file);
    video.src = url;
    video.muted = true;
    video.playsInline = true;
    video.currentTime = 0.3;

    let captured = false;
    const capture = () => {
      if (captured) return;
      captured = true;
      let w = video.videoWidth || 640, h = video.videoHeight || 480;
      if (w > maxDim || h > maxDim) {
        if (w > h) {
          h = Math.round((h * maxDim) / w);
          w = maxDim;
        } else {
          w = Math.round((w * maxDim) / h);
          h = maxDim;
        }
      }
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(video, 0, 0, w, h);
        URL.revokeObjectURL(url);
        resolve(canvas.toDataURL("image/jpeg", 0.92));
      } else {
        URL.revokeObjectURL(url);
        resolve("");
      }
    };

    video.onseeked = capture;
    video.onloadeddata = () => {
      if (!captured) {
        video.currentTime = 0.1;
      }
    };
    video.onerror = () => {
      URL.revokeObjectURL(url);
      reject();
    };

    setTimeout(() => {
      if (!captured) capture();
    }, 1500);
  });
}
