import * as ort from "onnxruntime-web";
import { createContext } from "@lit/context";

// Use jsDelivr CDN for WASM files to ensure they work in both local and production (Pages) environments
// without needing to bundle them or manually upload to R2.
ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.23.2/dist/';

import type { Point } from '../api/layout';

export type ModelPrecision = 'fp32' | 'fp16' | 'int8';

interface ClassifierConfig {
  labels: string[];
  dpt: number;
  cropSize: number;
}

/**
 * Handles model inference using onnxruntime-web.
 * Responsible for loading model configurations, managing inference sessions,
 * and performing image preprocessing/postprocessing.
 * 
 * Public Interface:
 * - classify(): Performs inference on a single marker.
 * - patch(): Extracts a patch from the source image.
 */
export class Classifier {
  private _session: any = null;
  private _config: ClassifierConfig | null = null;
  private _initPromise: Promise<void> | null = null;
  private _queue: Promise<any> = Promise.resolve();
  
  readonly model: string;
  readonly precision: ModelPrecision;

  /**
   * @param modelName Name of the model directory in /public/models
   * @param precision Numeric precision format ('fp32', 'fp16', or 'int8')
   */
  constructor(modelName: string, precision: ModelPrecision) {
    this.model = modelName;
    this.precision = precision;
  }

  /**
   * Returns the name of the active execution provider (e.g. WebGPU, WebNN, WASM).
   */
  get executionProvider(): string {
    if (!this._session) return 'None';
    
    const sessionAny = this._session as any;
    const handler = sessionAny.handler || sessionAny._handler;
    const handlerName = handler?.constructor?.name || '';
    
    // 1. Direct identify by constructor name (unminified)
    if (handlerName.includes('WebGpu')) return 'WebGPU';
    if (handlerName.includes('WebNN')) return 'WebNN';
    if (handlerName.includes('Wasm')) return 'WASM';
    
    // 2. Identify by internal properties (robust against minification)
    // Most hardware backends store unique handles
    if (handler?.device || handler?.adapter || handler?.gpuContext) return 'WebGPU';
    if (handler?.context || handler?.mlContext || handler?.nnContext) return 'WebNN';
    if (handler?.worker || sessionAny._sessionID || handler?._wasm) return 'WASM';
    
    // 3. Heuristic: if it's minified but not identifies, and we have many markers for acceleration
    if (handlerName === 'hn' || handlerName === 'on') return 'Accel';
    
    // Fallback to name or CPU
    if (handlerName && handlerName.length <= 3) return handlerName;
    return handlerName || 'CPU';
  }

  /**
   * Ensures the model configuration and session are loaded.
   * Can be called explicitly for pre-loading, but is handled lazily by classify() and patch().
   */
  async initialize(modelData?: Uint8Array): Promise<void> {
    if (this._initPromise) return this._initPromise;
    this._initPromise = this._doInitialize(modelData);
    return this._initPromise;
  }

  private async _doInitialize(modelData?: Uint8Array): Promise<void> {
    const baseUrl = `/public/models/${this.model}`;
    
    // 1. Load configuration
    try {
        const response = await fetch(`${baseUrl}/model.config`);
        if (!response.ok) {
            throw new Error(`Failed to load model config for ${this.model}: ${response.statusText}`);
        }
        const configData = await response.json();
        
        this._config = {
            labels: configData.labels || ["track", "train", "other"],
            dpt: configData.dpt || 28,
            cropSize: configData.crop_size || configData.size || 96
        };
    } catch (e) {
        console.error(`[Classifier] Config Load Failed:`, e);
        throw e;
    }

    // 2. Initialize ONNX runtime session
    try {
        let input: any = modelData;
        if (!input) {
            const modelUrl = `${baseUrl}/model_${this.precision}.ort`;
            const response = await fetch(modelUrl);
            if (!response.ok) {
                throw new Error(`Failed to load model binary from ${modelUrl}: ${response.statusText}`);
            }
            input = new Uint8Array(await response.arrayBuffer());
        }

        const options: any = {
            // Prioritize WASM for stability. Current WebGPU (JSEP) implementation has issues 
            // with specific quantized operators (like Cast) in this model.
            executionProviders: ['wasm'],
            graphOptimizationLevel: 'all'
        };

        this._session = await ort.InferenceSession.create(input, options);
    } catch (e) {
        console.error(`[Classifier] Session Init Failed:`, e);
        throw e;
    }
  }

  /**
   * Internal helper to ensure initialization before any public action.
   */
  private async _ensureInitialized() {
    await this.initialize();
    if (!this._session || !this._config) {
        throw new Error("Classifier failed to initialize");
    }
  }

  /**
   * Classifies a marker in the given image.
   * 
   * @param image Source image
   * @param center Coordinates of the marker
   * @param img_dpt Dots-per-track of the source image
   */
  async classify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    const result = this._queue.then(async () => {
        await this._ensureInitialized();
        return await this._doClassify(image, center, img_dpt);
    });

    // Update queue but don't block current call
    this._queue = result.catch(() => {}); 
    
    return result;
  }

  /**
   * Extracts a square patch from the source image, centered at `center`.
   * The patch is scaled such that the resulting features match the model's DPT.
   * 
   * @param image Source image
   * @param center Center point in source coordinates
   * @param img_dpt Dots-per-track of the source image
   */
  async patch(image: CanvasImageSource, center: Point, img_dpt: number): Promise<HTMLCanvasElement | OffscreenCanvas | null> {
    await this._ensureInitialized();

    const scaleFactor = this._config!.dpt / img_dpt; 
    const dstSize = this._config!.cropSize;
    const srcSize = dstSize / scaleFactor;
    
    const sx = center.x - srcSize / 2;
    const sy = center.y - srcSize / 2;

    let canvas: HTMLCanvasElement | OffscreenCanvas;
    let ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;

    if (typeof document !== 'undefined') {
        canvas = document.createElement('canvas');
        canvas.width = dstSize;
        canvas.height = dstSize;
        ctx = canvas.getContext('2d', { willReadFrequently: true });
    } else {
        canvas = new OffscreenCanvas(dstSize, dstSize);
        ctx = canvas.getContext('2d') as any; // Cast to any to avoid potential type mismatch issues in stricter envs
    }

    if (!ctx) return null;

    // Background color (if patch goes out of bounds)
    ctx.fillStyle = 'black';
    ctx.fillRect(0, 0, dstSize, dstSize);

    try {
        ctx.drawImage(image, sx, sy, srcSize, srcSize, 0, 0, dstSize, dstSize);
    } catch (e) {
        // Silently handle "detached" image sources (happens if ImageBitmap is closed 
        // while a request is pending in the queue).
        if (e instanceof Error && (e.name === 'InvalidStateError' || e.message.includes('detached'))) {
            console.debug("[Classifier] Skipping patch: Image source detached");
            return null;
        }
        console.error("[Classifier] Failed to draw image patch", e);
        return null;
    }
    
    return canvas;
  }

  /**
   * Internal implementation of classification.
   * Performs patch extraction, preprocessing, inference, and postprocessing.
   * 
   * @param image Source image
   * @param center Center point for classification
   * @param img_dpt Source image dots-per-track
   */
  private async _doClassify(image: ImageBitmap, center: Point, img_dpt: number): Promise<string> {
    // 1. Extract patch (reusing our own public patch logic internally)
    const patchCanvas = await this.patch(image, center, img_dpt);
    if (!patchCanvas) {
        throw new Error("Failed to extract patch");
    }

    // 2. Preprocess
    const tensor = await this._preprocess(patchCanvas);

    // 3. Inference
    const feeds: Record<string, any> = {};
    const inputNames = this._session!.inputNames;
    feeds[inputNames[0]] = tensor;

    const results = await this._session!.run(feeds);
    const outputNames = this._session!.outputNames;
    const output = results[outputNames[0]];

    // 4. Postprocess (Argmax)
    const probs = output.data;
    let maxIdx = 0;
    let maxProb = -Infinity;
    
    for (let i = 0; i < probs.length; i++) {
        const val = Number(probs[i]);
        if (val > maxProb) {
            maxProb = val;
            maxIdx = i;
        }
    }

    return this._config!.labels[maxIdx] || 'unknown';
  }

  /**
   * Converts a canvas-based image patch into an ONNX tensor.
   * Performs ImageNet normalization and channel-first (NCHW) reordering.
   * 
   * @param canvas The extracted image patch
   */
  private async _preprocess(canvas: HTMLCanvasElement | OffscreenCanvas): Promise<any> {
      const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
      if (!ctx) throw new Error("No context");
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const { data, width, height } = imageData;
      
      // Standard ImageNet normalization
      const mean = [0.485, 0.456, 0.406];
      const std = [0.229, 0.224, 0.225];

      const float32Data = new Float32Array(3 * width * height);
      
      for (let i = 0; i < width * height; i++) {
           const r = data[i * 4] / 255.0;
           const g = data[i * 4 + 1] / 255.0;
           const b = data[i * 4 + 2] / 255.0;
           
           // Channel 0 (R)
           float32Data[i] = (r - mean[0]) / std[0];
           // Channel 1 (G)
           float32Data[width * height + i] = (g - mean[1]) / std[1];
           // Channel 2 (B)
           float32Data[2 * width * height + i] = (b - mean[2]) / std[2];
      }

      if (this.precision === 'fp16') {
          return new ort.Tensor('float16', float32ToFloat16(float32Data), [1, 3, height, width]);
      } else {
          return new ort.Tensor('float32', float32Data, [1, 3, height, width]);
      }
  }
}

/**
 * Converts a Float32Array to a Uint16Array containing IEEE 754 half-precision floats.
 * Required for onnxruntime-web 'float16' tensors.
 */
function float32ToFloat16(float32Array: Float32Array): Uint16Array {
    const float16Array = new Uint16Array(float32Array.length);
    const floatView = new Float32Array(1);
    const int32View = new Int32Array(floatView.buffer);

    for (let i = 0; i < float32Array.length; i++) {
        floatView[0] = float32Array[i];
        const x = int32View[0];

        const s = (x >> 16) & 0x8000; // sign
        let e = ((x >> 23) & 0xff) - 127 + 15; // exponent
        let m = (x >> 13) & 0x03ff; // mantissa (10 bits)

        if (e <= 0) {
            // Underflow/Denormal
            float16Array[i] = s;
        } else if (e >= 31) {
            // Overflow/Infinity/NaN
            float16Array[i] = s | 0x7c00;
        } else {
            float16Array[i] = s | (e << 10) | m;
        }
    }
    return float16Array;
}

export const classifierContext = createContext<Classifier | undefined>('classifier');