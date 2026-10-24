import { createWorker } from 'tesseract.js';

export async function recognizePages(pdf, numbers, onProgress, signal) {
  let worker;
  const cancel = () => worker?.terminate();
  signal?.addEventListener('abort', cancel, { once: true });
  try {
    worker = await createWorker('eng', 1, {
      workerPath: new URL('./ocr/worker.min.js', document.baseURI).href,
      corePath: new URL('./ocr/core/', document.baseURI).href,
      langPath: new URL('./ocr/lang/', document.baseURI).href,
      cacheMethod: 'none', workerBlobURL: false,
      logger: item => onProgress(`Recognizing text: ${Math.round((item.progress || 0) * 100)}%`),
    });
    if (signal?.aborted) throw new Error('OCR canceled.');
    const result = {};
    for (const number of numbers) {
      if (signal?.aborted) throw new Error('OCR canceled.');
      onProgress(`Reading page ${number} of ${pdf.numPages}…`);
      const page = await pdf.getPage(number), base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, Math.sqrt(16_000_000 / (base.width * base.height)));
      const viewport = page.getViewport({ scale }), canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
      await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
      const { data } = await worker.recognize(canvas);
      result[number] = { text: data.text, confidence: data.confidence };
      canvas.width = canvas.height = 0;
    }
    return result;
  } finally { signal?.removeEventListener('abort', cancel); await worker?.terminate().catch(() => {}); }
}
