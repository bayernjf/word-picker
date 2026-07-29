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
    }
  ): Promise<TesseractWorker>;
}

declare const Tesseract: TesseractNamespace;

declare const chrome: {
  runtime: {
    onMessage: {
      addListener(callback: (message: unknown, sender: unknown, sendResponse: (response: unknown) => void) => boolean): void;
    };
  };
};

interface OcrMessage {
  type: string;
  id?: string;
  imageData?: string;
}

let worker: TesseractWorker | null = null;
let workerReady = false;
let workerPromise: Promise<TesseractWorker> | null = null;

function getWorker(): Promise<TesseractWorker> {
  if (worker && workerReady) {
    return Promise.resolve(worker);
  }
  if (workerPromise) {
    return workerPromise;
  }

  workerPromise = (async () => {
    const w = await Tesseract.createWorker('eng', 1, {
      langPath: 'https://tessdata.projectnaptha.com/4.0.0',
    });
    worker = w;
    workerReady = true;
    workerPromise = null;
    return w;
  })();

  return workerPromise;
}

async function processOcr(imageData: string): Promise<{
  words: Array<{ text: string; confidence: number; bbox: { x0: number; y0: number; x1: number; y1: number } }>;
  imageWidth: number;
  imageHeight: number;
}> {
  const w = await getWorker();
  const result = await w.recognize(imageData);

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

chrome.runtime.onMessage.addListener((message: unknown, _sender: unknown, sendResponse: (response: unknown) => void) => {
  const msg = message as OcrMessage;
  if (msg.type !== 'OCR_PROCESS') {
    return false;
  }

  const id = msg.id || '';
  const imageData = msg.imageData || '';

  if (!imageData) {
    sendResponse({ id, error: 'no_image_data' });
    return false;
  }

  processOcr(imageData)
    .then((result) => {
      sendResponse({ id, ...result });
    })
    .catch((error) => {
      sendResponse({ id, error: error instanceof Error ? error.message : String(error) });
    });

  return true;
});
