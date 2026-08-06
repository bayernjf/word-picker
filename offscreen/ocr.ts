interface TesseractWord {
  text: string;
  confidence: number;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
}

interface TesseractResult {
  data: {
    words: TesseractWord[];
    text: string;
  };
}

interface TesseractWorker {
  recognize(image: string | HTMLImageElement | HTMLCanvasElement): Promise<TesseractResult>;
  terminate(): Promise<void>;
}

interface TesseractNamespace {
  createWorker(
    lang: string,
    oem?: number,
    options?: {
      logger?: (msg: { status: string; progress?: number }) => void;
      workerPath?: string;
      corePath?: string;
      langPath?: string;
      workerBlobURL?: boolean;
      cacheMethod?: string;
    }
  ): Promise<TesseractWorker>;
}

declare const Tesseract: TesseractNamespace;

declare const chrome: {
  runtime: {
    getURL(path: string): string;
    onConnect: {
      addListener(callback: (port: {
        name: string;
        onMessage: { addListener(cb: (msg: unknown) => void): void };
        onDisconnect: { addListener(cb: () => void): void };
        postMessage(msg: unknown): void;
      }) => void): void;
    };
  };
};

interface OcrMessage {
  type: string;
  id?: string;
  imageData?: string;
  languages?: string[];
}

let worker: TesseractWorker | null = null;
let workerReady = false;
let workerPromise: Promise<TesseractWorker> | null = null;
let currentWorkerLang = '';

function getTesseractBase(): string {
  return chrome.runtime.getURL('assets/tesseract');
}

function getWorker(languages: string[] = ['eng']): Promise<TesseractWorker> {
  const langStr = languages.join('+');
  if (worker && workerReady && currentWorkerLang === langStr) {
    console.log('[OCR] Reusing existing worker for', langStr);
    return Promise.resolve(worker);
  }
  if (workerPromise && currentWorkerLang === langStr) {
    console.log('[OCR] Worker already being created for', langStr);
    return workerPromise;
  }

  if (worker) {
    console.log('[OCR] Terminating old worker');
    worker.terminate().catch(() => {});
    worker = null;
    workerReady = false;
    workerPromise = null;
  }

  const base = getTesseractBase();
  console.log('[OCR] Creating worker for', langStr, { base, workerPath: `${base}/worker.min.js`, corePath: `${base}/`, langPath: `${base}/tessdata/` });

  workerPromise = (async () => {
    try {
      console.log('[OCR] Calling Tesseract.createWorker with workerBlobURL: false');
      const w = await Tesseract.createWorker(langStr, 1, {
        workerPath: `${base}/worker.min.js`,
        corePath: `${base}/`,
        langPath: `${base}/tessdata/`,
        workerBlobURL: false,
        logger: (m) => {
          if (m.status === 'recognizing text') {
            console.log(`[OCR] Recognizing: ${Math.round((m.progress || 0) * 100)}%`);
          } else {
            console.log(`[OCR] ${m.status}`, m.progress != null ? `${Math.round(m.progress * 100)}%` : '');
          }
        },
      });
      console.log('[OCR] Worker created successfully');
      worker = w;
      workerReady = true;
      currentWorkerLang = langStr;
      workerPromise = null;
      return w;
    } catch (e) {
      console.error('[OCR] createWorker failed:', e);
      workerPromise = null;
      throw e;
    }
  })();

  return workerPromise;
}

async function processOcr(imageData: string, languages: string[] = ['eng']): Promise<{
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  imageWidth: number;
  imageHeight: number;
}> {
  console.log('[OCR] processOcr start, languages:', languages);
  const w = await getWorker(languages);
  console.log('[OCR] Worker ready, starting recognize');
  const result = await w.recognize(imageData);
  console.log('[OCR] Recognition complete, words found:', result.data.words?.length || 0);

  const words = (result.data.words || [])
    .filter((word) => word.text && word.text.trim().length > 0)
    .map((word) => ({
      text: word.text.trim(),
      confidence: word.confidence,
      bbox: {
        x0: word.bbox.x0,
        y0: word.bbox.y0,
        x1: word.bbox.x1,
        y1: word.bbox.y1,
      },
    }));

  const img = await loadImage(imageData);
  return {
    words,
    imageWidth: img.naturalWidth,
    imageHeight: img.naturalHeight,
  };
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('failed_to_load_image'));
    img.src = src;
  });
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'wordpicker-ocr') return;
  console.log('[OCR] Offscreen document connected');

  port.onMessage.addListener((message: unknown) => {
    const msg = message as OcrMessage;
    console.log('[OCR] Received message:', msg.type);
    if (msg.type !== 'OCR_PROCESS') return;

    const id = msg.id || '';
    const imageData = msg.imageData || '';
    const languages = msg.languages || ['eng'];

    if (!imageData) {
      port.postMessage({ id, error: 'no_image_data' });
      return;
    }

    processOcr(imageData, languages)
      .then((result) => {
        port.postMessage({ id, ...result });
      })
      .catch((error) => {
        console.error('[OCR] processOcr failed:', error);
        port.postMessage({ id, error: error instanceof Error ? error.message : String(error) });
      });
  });
});
