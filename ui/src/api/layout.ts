import { createContext } from "@lit/context";
import JSZip from "jszip";
// import { saveAs } from "file-saver";
import { type ApiLayout, type ApiImage, layoutClient } from "./client";
import { load_r49_v2 } from "./load_r49_v2";
import { LayoutImage } from "./layout-image";
import { DB_COMMIT_TIMEOUT_MS } from "../app/config";

export class Layout extends EventTarget {


    private _dataInternal: ApiLayout = {
        id: crypto.randomUUID(),
        userId: "",
        name: "New Layout",
        scale: "HO",
        images: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };
    
    // Local state for images (blobs/urls)
    public _images: LayoutImage[] = []; // Public for load_r49_v2

    // Commit Timers
    private _layoutCommitTimer: ReturnType<typeof setTimeout> | null = null;
    private _markersCommitTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

    constructor(data?: Partial<ApiLayout> | Layout) {
        super();
        if (data instanceof Layout) {
            this._dataInternal = { ...data._dataInternal };
            this._images = [...data._images];
            this._layoutCommitTimer = data._layoutCommitTimer;
            this._markersCommitTimers = new Map(data._markersCommitTimers);
        } else if (data) {
            this._dataInternal = { ...this._dataInternal, ...data };
        }
    }

    get id(): string { return this._dataInternal.id; }
    get layout(): ApiLayout { return this._dataInternal; }
    
    get name(): string { return this._dataInternal.name; }

    
    get calibration(): { p1: Point, p2: Point } { 
        return { 
            p1: { x: this._dataInternal.p1x || 0, y: this._dataInternal.p1y || 0 }, 
            p2: { x: this._dataInternal.p2x || 0, y: this._dataInternal.p2y || 0 } 
        }; 
    }
    
    get images(): LayoutImage[] { return this._images; }
    
    // Helper to expose ApiImage metadata aligned with _images array
    get apiImages(): ApiImage[] { return this._dataInternal.images; }

    get scale(): number { return Scale2Number[this._dataInternal.scale] || 87; }

    /**
     * Dots Per Track (DPT) Calculation
     * 
     * Formula:
     * DPT = (DistancePx / DistanceMm) * GaugeMm
     * 
     * where:
     * DistancePx = P2 - P1 distance in pixels
     * DistanceMm = referenceDistanceMm (which represents the physical distance between P1 and P2)
     * GaugeMm = Standard Gauge (1435mm) / Scale
     */
    get dots_per_track(): number {
        const p1 = { x: this._dataInternal.p1x || 0, y: this._dataInternal.p1y || 0 };
        const p2 = { x: this._dataInternal.p2x || 0, y: this._dataInternal.p2y || 0 };
        
        // If undefined markers, return default or error
        if (!this._dataInternal.p1x && !this._dataInternal.p1y && !this._dataInternal.p2x && !this._dataInternal.p2y) {
           return -1;
        }

        const distPx = Math.sqrt((p2.x - p1.x) ** 2 + (p2.y - p1.y) ** 2);
        const distMm = this._dataInternal.referenceDistanceMm; 

        if (!distMm || distMm <= 0) return -1;

        const gaugeMm = standard_gauge_mm / this.scale;
        
        // Pixel Density (px/mm) = distPx / distMm
        // DPT = (px/mm) * gaugeMm
        return (distPx / distMm) * gaugeMm;
    }

    setCalibration(p1: Point, p2: Point) {
        this._dataInternal = {
            ...this._dataInternal,
            p1x: p1.x,
            p1y: p1.y,
            p2x: p2.x,
            p2y: p2.y
        };
        
        this._emitChange();
        this._resetLayoutTimer();
    }
    
    setName(name: string) {
        this._dataInternal = { ...this._dataInternal, name };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setScale(scale: string) {
        // TODO: Validate scale
        this._dataInternal = { ...this._dataInternal, scale };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setReferenceDistance(mm: number) {
        this._dataInternal = { ...this._dataInternal, referenceDistanceMm: mm };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setMarker(imageIndex: number, id: string, x: number, y: number, type: string = 'track') {
        if (imageIndex < 0 || imageIndex >= this._dataInternal.images.length) return;
        
        const newImages = [...this._dataInternal.images];
        const img = { ...newImages[imageIndex] };
        img.labels = { ...(img.labels || {}) };
        
        img.labels[id] = { id, x: Math.round(x), y: Math.round(y), type };
        newImages[imageIndex] = img;
        
        this._dataInternal = { ...this._dataInternal, images: newImages };
        
        this._emitChange();
        this._resetMarkerTimer(img.id);
    }

    deleteMarker(imageIndex: number, id: string) {
        if (imageIndex < 0 || imageIndex >= this._dataInternal.images.length) return;
        
        const newImages = [...this._dataInternal.images];
        const img = { ...newImages[imageIndex] };
        
        if (img.labels && img.labels[id]) {
            img.labels = { ...img.labels };
            delete img.labels[id];
            newImages[imageIndex] = img;
            this._dataInternal = { ...this._dataInternal, images: newImages };
            
            this._emitChange();
            this._resetMarkerTimer(img.id);
        }
    }

    removeImage(index: number) {
        if (index >= 0 && index < this._images.length) {
            this._images.splice(index, 1);
            // Also remove from _data.images if it exists to keep in sync
            if (this._dataInternal?.images && index < this._dataInternal.images.length) {
                this._dataInternal.images.splice(index, 1);
            }
            this._emitChange();
        }
    }

    addImage(image: LayoutImage) {
        this._images.push(image);
        this._dataInternal.images.push({
            id: crypto.randomUUID(),
            layoutId: this._dataInternal.id,
            filename: image.name,

            labels: {},
            createdAt: new Date().toISOString()
        });
        this._emitChange();
    }
    
    // Internal use for initialization/migration
    _setImages(images: LayoutImage[]) {
        this._images = images;
        // Ensure metadata exists for each image
        while (this._dataInternal.images.length < images.length) {
             const i = this._dataInternal.images.length;
             this._dataInternal.images.push({
                id: crypto.randomUUID(),
                layoutId: this._dataInternal.id,
                filename: images[i].name,
                labels: {},
                createdAt: new Date().toISOString()
             });
        }
        this._emitChange();
    }

    async load(file: File) {
         try {
            const zip = await JSZip.loadAsync(file);
            const manifestFile = zip.file("manifest.json");
            
            // Legacy V2 check
            if (manifestFile) {
                const jsonText = await manifestFile.async("string");
                const json = JSON.parse(jsonText);
                if (json.version === 2) {
                    console.log("Loading Legacy V2 File...");
                    const result = await load_r49_v2(file) as any;
                    
                    // Copy state from loaded layout to this instance
                    this._dataInternal = (result as any).layout;
                    this._images = (result as any).images;
                    this._emitChange();
                    return;
                }
            }
            
            // V3 Load
            const layoutFile = zip.file("layout.json");
            if (!layoutFile) throw new Error("Invalid .r49 file (missing layout.json)");
            
            const layoutJson = await layoutFile.async("string");
            this._dataInternal = JSON.parse(layoutJson);
            
            // Load Images
            this._images = [];
            const imgPromises = this._dataInternal.images.map(async (imgMeta) => {
                const imgFile = zip.file(imgMeta.filename);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    return new LayoutImage(blob, imgMeta.filename);
                } else {
                    console.warn(`Image ${imgMeta.filename} not found in zip`);
                    return new LayoutImage(new Blob(), imgMeta.filename); // Placeholder
                }
            });
            
            this._images = await Promise.all(imgPromises);
            this._emitChange();
            
         } catch (e) {
             console.error("Failed to load file", e);
             throw e;
         }
    }

    async loadFromApi(layoutId: string) {
        try {
            const layout = await layoutClient.getLayout(layoutId);
            this._dataInternal = layout;
            
            // Reconstruct Images
            this._images = layout.images.map(img => {
                const url = layoutClient.getImageUrl(img.id);
                // Use filename or ID as name
                return new LayoutImage(url, img.filename || 'image.jpg');
            });

            this._emitChange();
        } catch (e) {
            console.error("Failed to load layout from API", e);
            throw e;
        }
    }

    async save() {
        const zip = new JSZip();
        
        // 1. Save layout.json (V3)
        const exportData = { ...this._dataInternal, version: 3 }; 
        zip.file("layout.json", JSON.stringify(exportData, null, 2));
        
        // 2. Save Images
        await Promise.all(this._images.map(async (img) => {
            const blob = await img.ensureBlob();
            zip.file(img.name, blob);
        }));
        
        // 3. Generate Blob & Save
        const content = await zip.generateAsync({ type: "blob" });
        const cleanName = (this._dataInternal.name || "layout").replace(/[^a-z0-9]/gi, '_').toLowerCase();
        const { saveAs } = await import("file-saver");
        saveAs(content, `${cleanName}.r49`);
    }

    async migrateToBackend(): Promise<string> {
        const layoutName = this.name || 'Imported Layout';
        const scale = this._dataInternal.scale || 'HO'; // Use internal string scale
        
        try {
            // 1. Create Layout
            console.log("Migrating: Creating layout...");
            const layout = await layoutClient.createLayout(layoutName, scale);
            
            // 2. Update Details (Dimensions & Calibration)
            // TODO: remove width/height, replace with referenceDistanceMm !!!
            // p1/p2 are used for calibration, they have a distance of referenceDistanceMm, no width/height
            const calibration = this.calibration;
            if (calibration && this._dataInternal.referenceDistanceMm) {
                 await layoutClient.updateLayout(layout.id, {
                     referenceDistanceMm: this._dataInternal.referenceDistanceMm,
                     // Use explicit keys matching ApiLayout
                     p1x: calibration.p1.x,
                     p1y: calibration.p1.y,
                     p2x: calibration.p2.x,
                     p2y: calibration.p2.y
                 });
            }

            // 3. Upload Images
            console.log(`Migrating: Uploading ${this._images.length} images...`);
            for (let i = 0; i < this._images.length; i++) {
                const img = this._images[i];
                // We don't have local labels easily accessible unless we look at _dataInternal
                // or if we kept them in apiImages (which are derived).
                // If loaded from .r49 v2, we have this._dataInternal.manifest.images[i].labels
                // But Layout structure flattens things.
                // Let's assume apiImages has the labels if loaded properly.
                // But apiImages are constructed from _data.images
                // Wait, load() populates _dataInternal.
                // loadFromApi populates _data.
                
                // If migrating, we assume we loaded from FILE (load()).
                // load() sets this._images = LayoutImage[]
                // It also sets this._dataInternal = { manifest: m, ... }
                // So labels are in this._dataInternal.manifest.images[i].labels
                
                let labels = {};
                if (this._dataInternal?.images?.[i]) {
                     labels = this._dataInternal.images[i].labels || {};
                }

                console.log(`[Layout] Image ${i} labels before upload:`, labels);
                
                const blob = await img.ensureBlob();
                if (blob) {
                    const filename = img.name || `image-${i}.jpg`;
                    const file = new File([blob], filename, { type: blob.type });
                    await layoutClient.uploadImage(layout.id, file, labels);
                }
            }

            // 4. Reload from API (Sync)
            console.log("Migrating: Syncing...");
            await this.loadFromApi(layout.id);
            
            return layout.id;
        } catch (e) {
            console.error("Migration failed", e);
            throw e;
        }
    }

    private _emitChange() {
        this.dispatchEvent(
            new CustomEvent('rr-layout-changed', {
                detail: { ...this._dataInternal },
            }),
        );
    }

    private _resetLayoutTimer() {
        if (this._layoutCommitTimer) clearTimeout(this._layoutCommitTimer);
        this._layoutCommitTimer = setTimeout(() => this._commitLayout(), DB_COMMIT_TIMEOUT_MS);
    }

    private _resetMarkerTimer(imageId: string) {
        const existing = this._markersCommitTimers.get(imageId);
        if (existing) clearTimeout(existing);
        
        const timer = setTimeout(() => this._commitMarkers(imageId), DB_COMMIT_TIMEOUT_MS);
        this._markersCommitTimers.set(imageId, timer);
    }

    private async _commitLayout() {
        console.log(`[Layout] Committing layout metadata...`);
        try {
            const { images, ...metadata } = this._dataInternal;
            await layoutClient.updateLayout(this.id, metadata);
            this._layoutCommitTimer = null;
        } catch (e) {
            console.error("Failed to commit layout metadata", e);
        }
    }

    private async _commitMarkers(imageId: string) {
        console.log(`[Layout] Committing markers for image ${imageId}...`);
        try {
            const imgMeta = this._dataInternal.images.find(img => img.id === imageId);
            if (imgMeta) {
                await layoutClient.updateImage(imageId, { labels: imgMeta.labels });
            }
            this._markersCommitTimers.delete(imageId);
        } catch (e) {
            console.error(`Failed to commit markers for image ${imageId}`, e);
        }
    }

}

export interface Point {
    x: number;
    y: number;
}

export const Scale2Number: Record<string, number> = {
  G: 25,
  O: 48,
  S: 64,
  HO: 87,
  T: 72,
  N: 160,
  Z: 96,
};

export const standard_gauge_mm = 1435; // Standard gauge in millimeters

export const layoutContext = createContext<Layout>('layout');
