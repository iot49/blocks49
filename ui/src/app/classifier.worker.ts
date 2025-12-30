/**
 * Classifier Web Worker
 * 
 * This worker performs model inference in a background thread to keep the 
 * main UI responsive. It maintains a persistent instance of the Classifier
 * and handles batch classification requests.
 */
import * as ort from 'onnxruntime-web';
import { Classifier } from './classifier';

let classifier: Classifier | null = null;
let isBusy = false;

/**
 * Main message handler for the worker.
 * Supports 'init' and 'classify-batch' message types.
 */
self.onmessage = async (e: MessageEvent) => {
    const { type, payload } = e.data;

    switch (type) {
        case 'init': {
            /** Initialize or update the underlying Classifier model and requested precision (e.g. 'fp16' or 'int8'). */
            const { model, precision } = payload;
            try {
                classifier = new Classifier(model, precision);
                // Trigger lazy initialization immediately
                await classifier.initialize();
                self.postMessage({ type: 'init-ok' });
            } catch (err) {
                self.postMessage({ type: 'error', error: (err as Error).message });
            }
            break;
        }

        case 'classify-batch': {
            /** 
             * Performs classification on a set of markers within a single image frame.
             * Transfers findings back to main thread via 'results' message.
             */
            if (!classifier || isBusy) return;
            isBusy = true;

            const { imageBitmap, markers, dpt } = payload;
            
            try {
                const results: Record<string, string> = {};
                const start = performance.now();

                const promises = Object.entries(markers).map(async ([id, pos]: [string, any]) => {
                    try {
                        const prediction = await classifier!.classify(imageBitmap, pos, dpt);
                        results[id] = prediction;
                    } catch (e) {
                        console.error(`[Worker] Classification failed for ${id}:`, e);
                    }
                });

                await Promise.all(promises);
                const duration = performance.now() - start;
                
                // Close the bitmap on our side as we're done with it
                imageBitmap.close();

                // console.log(`[Worker] Classification completed for ${Object.keys(markers).length} markers in ${Math.round(duration)}ms, results: ${JSON.stringify(results)}`);

                self.postMessage({ 
                    type: 'results', 
                    payload: { 
                        results, 
                        timestamp: payload.timestamp,
                        inferenceTimeMs: Math.round(duration)
                    } 
                });
            } catch (err) {
                self.postMessage({ type: 'error', error: (err as Error).message });
            } finally {
                isBusy = false;
            }
            break;
        }
    }
};
