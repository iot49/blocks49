import { LitElement, html, css, svg } from 'lit';
import { customElement, property, query, state } from 'lit/decorators.js';
import { consume } from '@lit/context';
import { MARKER_SIZE_PX, REF_LINE_COLOR } from './app/config.ts';
import { getMarkerDefs } from './styles/marker-defs.ts';
import { Classifier, classifierContext } from './app/classifier.ts';
import { type ApiMarker } from './api/client.js';
import { type Layout, layoutContext } from './api/layout.ts';

// Real-time marker updates with debounced commit (DB_COMMIT_TIMEOUT_MS) 
// ensure visual feedback is immediate while minimizing backend traffic.


interface ValidationResult {
  x: number;
  y: number;
  type: string;
  match: boolean;
  predicted?: string;
  comparison?: {
      label: string;
      match: boolean;
  };
}

type MarkerCategory = 'marker' | 'calibration';

/**
 * RrMarker is an interactive canvas for viewing and placing markers on layout images.
 * 
 * It manages:
 * - Rendering the layout image and overlaying markers (Track, Train, etc.).
 * - Calibration rectangle management for DPT calculation.
 * - Interactive marker placement and dragging.
 * - Real-time marker validation using the provided Classifier.
 * - Deep validation/debugging via a floating popup (Shift-click/Debug tool).
 */
@customElement('rr-marker')
export class RrMarker extends LitElement {
  static styles = css`
    :host {
      display: flex;
      flex-direction: column;
      width: 100%;
      height: 100%;
      min-height: 0;
      background-color: var(--sl-color-neutral-100);
    }

    .canvas-wrapper {
      flex: 1;
      min-height: 0;
      display: flex;
      align-items: center;
      justify-content: center;
      position: relative;
      overflow: hidden;
    }

    svg {
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      display: block;
    }

    symbol {
      overflow: visible;
      stroke-width: 0.3;
      cursor: pointer;
    }

    .validation-rect {
      fill: none;
      stroke-width: 2;
      pointer-events: none;
    }
    
    .debug-popup {
      display: none;
      position: fixed;
      z-index: 1000;
      background: white;
      border: 1px solid #ccc;
      box-shadow: 0 2px 5px rgba(0,0,0,0.2);
      padding: 8px;
      cursor: pointer;
    }
  `;

  @consume({ context: layoutContext, subscribe: true })
  layout!: Layout;

  @consume({ context: classifierContext, subscribe: true })
  @state()
  classifier: Classifier | undefined;



  // Helper to ensure we have resolution if possible
  get cameraResolution() {
      // Use first image if available?
      if (this.layout._images.length > 0) {
           // We might not have bitmap loaded constantly. 
           // We can't know resolution without loading image.
           // This logic was brittle in Manifest too.
           // For start, use default or try to get it from imageIndex.
      }
      return { width: 1000, height: 1000 };
  }

  // Derived from r49File context
  // get imageUrl removed, use r49File.getImageUrl(index) directly -> converted to layout.images[index].objectURL

  /** The currently selected image index. */
  @property({ type: Number })
  imageIndex: number = -1;

  /** The ImageBitmap of the currently selected image, used for classification. */
  @state()
  private _imageBitmap: ImageBitmap | null = null; 
  
  /** Current validation results (matches/mismatches) for all markers on this image. */
  @state()
  validationResults: Record<string, ValidationResult> = {};

  /** Tracking object to ignore stale async validation results. */
  private _markerValidationRequests: Record<string, number> = {};

  /** The marker currently being dragged. */
  @state()
  private dragHandle: { id: string; category: MarkerCategory } | null = null;

  /** The ID of the active tool from the editor sidebar. */
  @property({ attribute: false })
  activeTool: string | null = null;

  /** Relative size of markers in SVG units, scaled based on current container width. */
  @state()
  symbolSize: number = 48;

  private resizeObserver: ResizeObserver | null = null;

  @query('#svg')
  svg!: SVGGElement;

  firstUpdated() {
    this.resizeObserver = new ResizeObserver(() => {
      this.updateSymbolSize();
    });
    this.resizeObserver.observe(this);
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
    }
  }

  /**
   * Recalculates the SVG symbol size based on the current component width.
   * This ensures markers remain a consistent physical size regardless of resizing.
   */
  private updateSymbolSize() {
    const width = this.offsetWidth;
    if (width === 0) return; // not visible yet

    const imageWidth = this._imageBitmap?.width || 1000;
    // The SVG viewBox width matches imageWidth.
    // So the number of SVG units per screen pixel is imageWidth / screenWidth.
    const scale = imageWidth / width;

    this.symbolSize = MARKER_SIZE_PX * scale;
  }

  willUpdate(changedProperties: Map<string, any>) {
    // Recalculate symbol size if layout or file changes
    if (changedProperties.has('layout') || changedProperties.has('imageIndex') || changedProperties.has('classifier')) {
      this.updateSymbolSize();
      
      // If the image index or classifier changed, clear validation results.
      if (changedProperties.has('imageIndex') || changedProperties.has('classifier')) {
        this.validationResults = {};
        if (changedProperties.has('imageIndex')) {
            this._imageBitmap = null;
        }
      }
      this._updateImage();
    }
  }

  // When image loads or manifest changes, we might need to recalculate if resolution changed
  updated(changedProperties: Map<string, any>) {
    // Re-validate markers if the classifier, bitmap, or dragging state changes.

    if (
        changedProperties.has('classifier') || 
        changedProperties.has('_imageBitmap') ||
        changedProperties.has('layout') || // Added to handle marker movements
        changedProperties.has('dragHandle')
    ) {
        if (this._imageBitmap && !this.dragHandle) {
            this.validateMarkers();
        }
    }
  }

  private async _updateImage() {
    if (this.imageIndex < 0 || !this.layout) {
        this.validationResults = {};
        this._imageBitmap = null;
        return;
    }

    try {
        const layoutImg = this.layout.images[this.imageIndex];
        if (layoutImg) {
            const bitmap = await layoutImg.getBitmap();
            this._imageBitmap = bitmap || null;
        } else {
            this._imageBitmap = null;
        }
    } catch (e) {
        console.error("Failed to load image bitmap", e);
        this._imageBitmap = null;
    }
  }

  /**
   * Performs real-time classification for all markers on the current image.
   * Results are batched and updated in a single state change to minimize re-renders.
   */
  private async validateMarkers() {
    if (this.dragHandle) return;
    const layout = this.layout;
    if (!layout) return;
    const currentImageIndex = this.imageIndex;
    const currentImage = layout.apiImages[currentImageIndex];
    if (!currentImage?.markers || !this._imageBitmap || !this.classifier) return;
    
    const img_dpt = layout.dots_per_track;
    if (img_dpt <= 0) return; 

    const markers = Object.entries(currentImage.markers);
    let resultsChanged = false;
    const newResults = { ...this.validationResults };

    // Identify which markers need (re)validation
    const tasks = markers.map(async ([id, m]) => {
        const marker = m as ApiMarker;
        // Skip if we already have a valid result for this exact biomarker (type + pos)
        const prev = this.validationResults[id];
        if (prev && prev.x === marker.x && prev.y === marker.y && prev.type === marker.type) {
            return;
        }

        const requestId = (this._markerValidationRequests[id] || 0) + 1;
        this._markerValidationRequests[id] = requestId;

        try {
            const predictedLabel = await this.classifier!.classify(
                this._imageBitmap!,
                { x: marker.x, y: marker.y },
                img_dpt
            );

            // Guard against stale results
            if (this.imageIndex !== currentImageIndex || 
                this._markerValidationRequests[id] !== requestId) return;
            
            newResults[id] = { 
               x: marker.x, 
               y: marker.y, 
               type: marker.type || 'track',
               match: predictedLabel === (marker.type || 'track'),
               predicted: predictedLabel,
               comparison: undefined 
            };
            resultsChanged = true;
        } catch (e) {
            // We already added a silent catch in classifier.ts for detatched bitmaps,
            // so we don't need to do much here except avoid crashing.
            console.debug(`[rr-marker] Classification skipped for ${id}:`, e);
        }
    });

    await Promise.all(tasks);

    // If marker set changed (some markers deleted), prune them from results
    const markerIds = new Set(markers.map(([id]) => id));
    for (const id in newResults) {
        if (!markerIds.has(id)) {
            delete newResults[id];
            resultsChanged = true;
        }
    }

    // Only update state if something actually changed to avoid cycles
    if (resultsChanged && this.imageIndex === currentImageIndex && !this.dragHandle) {
        this.validationResults = newResults;
    }
  }

  render() {
    // Calculate the SVG viewBox to match image dimensions
    // Use bitmap resolution if available, otherwise fallback/shim
    const imageWidth = this._imageBitmap?.width || 1000;
    const imageHeight = this._imageBitmap?.height || 1000;
    const viewBox = `0 0 ${imageWidth} ${imageHeight}`;
    // Also use this for scale shim in updateSymbolSize if needed

    return html`
      <div class="canvas-wrapper" @mousedown=${this.handleMouseDown}>
        <svg
          id="svg"
          viewBox=${viewBox}
          style="aspect-ratio: ${imageWidth} / ${imageHeight};"
          @mousemove=${this.handleMouseMove}
          @click=${this.handleClick}
        >
          ${getMarkerDefs(this.symbolSize)}
          <image
            id="image"
            href=${this.layout?.images?.[this.imageIndex]?.objectURL}
            x="0"
            y="0"
            width=${imageWidth}
            height=${imageHeight}
          ></image>
          ${this.markerTemplate('marker')} ${this.imageIndex === 0 ? this.calibrationTemplate() : svg``}
        </svg>
        <div id="debug-popup-container" 
             class="debug-popup"
             @click=${(e: Event) => {(e.target as HTMLElement).style.display = 'none';}}
        ></div>
      </div>
    `;
  }

  private markerTemplate(category: MarkerCategory) {
    if (!this.layout || !this.layout.apiImages[this.imageIndex]) return svg``;
    const markers = this.layout.apiImages[this.imageIndex].markers || {};
    // console.log(`[rr-marker] Rendering ${Object.keys(markers).length} markers for image ${this.imageIndex}`, markers);
    return svg`
      ${Object.entries(markers).map(([markerId, m]) => {
        const marker = m as ApiMarker; 
        const validation = this.validationResults[markerId];
        const color = validation
          ? validation.match 
            ? (validation.comparison && !validation.comparison.match ? 'orange' : 'green') 
            : 'red'
          : 'gray';
        
        let strokeDasharray = "0";
        if (validation && validation.comparison && validation.predicted !== validation.comparison.label) {
            strokeDasharray = "4"; // Dashed line for model disagreement
        }
        
        return svg`
          <g id=${markerId} class=${category}
             style="cursor: grab">
             
            <use class=${category} href="#${marker.type}" x=${marker.x} y=${marker.y}></use>
            <rect 
                x=${marker.x - this.symbolSize / 2} 
                y=${marker.y - this.symbolSize / 2} 
                width=${this.symbolSize} 
                height=${this.symbolSize} 
                class="validation-rect"
                stroke=${color}
                stroke-dasharray=${strokeDasharray}
                stroke-width="2"
                vector-effect="non-scaling-stroke"
            />
          </g>
        `;
      })}
    `;
  }

  private calibrationTemplate(handles = true) {
    if (!this.layout) return svg``;

    const { p1, p2 } = this.layout.calibration;
    // Check for valid points check? Assuming layout provides {p1, p2}
    if (!p1 || !p2) return svg``;

    return svg`
      <line x1=${p1.x} y1=${p1.y} x2=${p2.x} y2=${p2.y} stroke=${REF_LINE_COLOR} stroke-width="3" vector-effect="non-scaling-stroke" style="pointer-events: none;" />
      ${
        handles
          ? svg`
            <use id="p1" class="calibration" href="#drag-handle" x=${p1.x} y=${p1.y} />
            <use id="p2" class="calibration" href="#drag-handle" x=${p2.x} y=${p2.y} />
          `
          : svg``
      }
    `;
  }

  private toSVGPoint(x: number, y: number) {
    const p = new DOMPoint(x, y);
    const ctm = this.svg.getScreenCTM();
    if (!ctm) {
      throw new Error('Unable to get screen CTM from SVG element');
    }
    return p.matrixTransform(ctm.inverse());
  }

  /**
   * Opens a debug popup at the clicked location, showing a scaled image patch
   * and the model's classification result.
   */
  private async debugClick(event: MouseEvent) {
    const screenCoords = this.toSVGPoint(event.clientX, event.clientY);

    if (!this._imageBitmap || !this.classifier) {
        console.warn("Classifier or ImageBitmap not ready for debugging");
        return;
    }

    const img = this._imageBitmap;
    if (!this.layout) return;
    const img_dpt = this.layout.dots_per_track;
    
    // --- Scaled Patch via Classifier.patch ---
    const img_patch = await this.classifier.patch(img, screenCoords, img_dpt);

    if (img_patch) {
      // Setup Popup Container
      const mainContainer = this.shadowRoot?.querySelector('#debug-popup-container');
      if (mainContainer) {
        mainContainer.replaceChildren();
        (mainContainer as HTMLElement).style.display = 'block';
        (mainContainer as HTMLElement).style.left = `${event.clientX + 20}px`;
        (mainContainer as HTMLElement).style.top = `${event.clientY + 20}px`;
      }

      const classifyPromise = this.classifier.classify(img, screenCoords, img_dpt);
      
      classifyPromise.then((label: string) => {
        const resultDiv = document.createElement('div');
        resultDiv.style.background = '#e8f5e9';
        resultDiv.style.padding = '4px';
        resultDiv.innerHTML = label;
        this.shadowRoot?.querySelector('#debug-popup-container')?.appendChild(resultDiv);
      });

      if (img_patch instanceof Node) {
        this.shadowRoot?.querySelector('#debug-popup-container')?.appendChild(img_patch);
      }
    }
  }

  /**
   * Handles click events for marker placement (Label mode) or debugging.
   */
  private handleClick = (event: MouseEvent) => {
    // do not create label after dragging
    if (this.dragHandle === null) {
      // create a new marker
      const tool = this.activeTool;
      // Cannot create with delete tool or calibrate tool.
      // Calibrate tool is effectively "move only" for calibration handles.
      if (!tool || tool === 'delete') return;

      // check for debug tool
      if (tool === 'debug') {
        this.debugClick(event);
        return;
      }
      
      const type = this.activeTool || 'track';
      const id = crypto.randomUUID();

      const screenCoords = this.toSVGPoint(event.clientX, event.clientY);
      this.layout.setMarker(this.imageIndex, id, screenCoords.x, screenCoords.y, type);
    } else {
      // finished dragging
      this.dragHandle = null;
    }
  };

  private handleMouseDown = (event: MouseEvent) => {
    const target = event.target as HTMLElement | SVGElement;
    const marker = target.closest('[id].marker, [id].calibration');
    
    if (!marker) return;

    const id = marker.id;
    const classList = marker.classList;

    if (this.activeTool === 'delete') {
      if (classList.contains('marker')) {
        this.layout.deleteMarker(this.imageIndex, id);
      }
    } else {
      if (classList.contains('marker')) {
        this.dragHandle = { id, category: 'marker' };
      } else if (classList.contains('calibration')) {
        this.dragHandle = { id, category: 'calibration' };
      }
    }
  };

  // Removed showDebugPopup



  private handleMouseMove = (event: MouseEvent) => {
    // BUG: marker position is not updated when dragging 
    if (!this.dragHandle) return;
    const screenCoords = this.toSVGPoint(event.clientX, event.clientY);

    if (this.dragHandle.category === 'calibration') {
      const { p1, p2 } = this.layout.calibration;
      if (this.dragHandle.id === 'p1') {
          this.layout.setCalibration({ x: screenCoords.x, y: screenCoords.y }, p2);
      } else if (this.dragHandle.id === 'p2') {
          this.layout.setCalibration(p1, { x: screenCoords.x, y: screenCoords.y });
      }
    } else {
      let type = 'track';
      const img = this.layout.apiImages?.[this.imageIndex];
      
      if (img?.markers?.[this.dragHandle.id]) {
        type = img.markers[this.dragHandle.id].type || 'track';
      }
      
      this.layout.setMarker(
        this.imageIndex,
        this.dragHandle.id,
        screenCoords.x,
        screenCoords.y,
        type
      );
    }
  };
}
