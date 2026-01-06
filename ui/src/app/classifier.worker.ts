
import { Classifier } from './classifier';

let classifier: Classifier | null = null;
let currentModel = '';
let currentPrecision = '';

self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    try {
        if (type === 'init') {
            const { model, precision } = payload;
            
            // Only re-initialize if changed
            if (!classifier || currentModel !== model || currentPrecision !== precision) {
                classifier = new Classifier(model, precision);
                await classifier.initialize();
                currentModel = model;
                currentPrecision = precision;
            }
        
        } else if (type === 'classify-batch') {
            if (!classifier) {
                throw new Error("Classifier not initialized in worker");
            }
            
            const startTime = performance.now();
            const { imageBitmap, markers, dpt } = payload;
            const results: Record<string, string> = {};

            // imageBitmap is transferred, so we own it.
            // We need to keep it alive for the duration of all classifications.
            // Classifier.classify() uses it to extract patches.

            // Process sequentially or parallel?
            // Classifier.classify() puts requests in a Promise queue to avoid concurrency issues with onnxruntime session?
            // Actually `Classifier` has a `_queue`. So we can fire them all.
            
            const promises = Object.entries(markers).map(async ([id, point]: [string, any]) => {
                const label = await classifier!.classify(imageBitmap, point, dpt);
                results[id] = label;
            });

            await Promise.all(promises);
            
            const endTime = performance.now();
            const inferenceTimeMs = endTime - startTime;

            self.postMessage({
                type: 'results', 
                payload: {
                    results,
                    inferenceTimeMs,
                    executionProvider: classifier.executionProvider
                }
            });

            // Clean up the bitmap? 
            // In the main thread, `rr-live-view.ts` transferred it here.
            // We should close it to release memory.
            imageBitmap.close();
        }
    } catch (error: any) {
        console.error("[Worker] Error:", error);
        self.postMessage({
            type: 'error',
            error: error.message || String(error)
        });
        
        // Ensure cleanup on error too
        if (type === 'classify-batch' && payload.imageBitmap) {
             try { payload.imageBitmap.close(); } catch(e) {}
        }
    }
};

export {};
