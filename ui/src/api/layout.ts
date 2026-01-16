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
    get description(): string { return this._dataInternal.description || ''; }
    get classifier(): string { return this._dataInternal.classifier || ''; }
    get mqttTopic(): string { return this._dataInternal.mqttTopic || ''; }

    
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

    setDescription(description: string) {
        this._dataInternal = { ...this._dataInternal, description };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setClassifier(classifier: string) {
        this._dataInternal = { ...this._dataInternal, classifier };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setMqttTopic(mqttTopic: string) {
        this._dataInternal = { ...this._dataInternal, mqttTopic };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setScale(scale: string) {
        if (!Scale2Number[scale]) {
            console.warn(`Invalid scale: ${scale}`);
            return;
        }
        this._dataInternal = { ...this._dataInternal, scale };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setReferenceDistance(mm: number) {
        this._dataInternal = { ...this._dataInternal, referenceDistanceMm: mm };
        this._emitChange();
        this._resetLayoutTimer();
    }

    setMarker(imageIndex: number, id: string, x: number, y: number, type: string = 'track', alias?: string) {
        if (imageIndex < 0 || imageIndex >= this._dataInternal.images.length) return;
        
        const newImages = [...this._dataInternal.images];
        const img = { ...newImages[imageIndex] };
        img.markers = { ...(img.markers || {}) };
        
        img.markers[id] = { id, x: Math.round(x), y: Math.round(y), type, alias };
        newImages[imageIndex] = img;
        
        this._dataInternal = { ...this._dataInternal, images: newImages };
        
        this._emitChange();
        this._resetMarkerTimer(img.id);
    }

    deleteMarker(imageIndex: number, id: string) {
        if (imageIndex < 0 || imageIndex >= this._dataInternal.images.length) return;
        
        const newImages = [...this._dataInternal.images];
        const img = { ...newImages[imageIndex] };
        
        if (img.markers && img.markers[id]) {
            img.markers = { ...img.markers };
            delete img.markers[id];
            newImages[imageIndex] = img;
            this._dataInternal = { ...this._dataInternal, images: newImages };
            
            this._emitChange();
            this._resetMarkerTimer(img.id);
        }
    }

    async removeImage(index: number) {
        if (index >= 0 && index < this._images.length) {
            const imgMeta = this._dataInternal.images[index];
            if (imgMeta && this.id) {
                try {
                    await layoutClient.deleteImage(imgMeta.id);
                } catch (e) {
                    console.error("Failed to delete image from backend", e);
                    // Continue to remove locally even if backend fails? 
                    // Better to let user know, but UI usually expects immediate removal.
                }
            }
            
            this._images.splice(index, 1);
            // Also remove from _data.images if it exists to keep in sync
            if (this._dataInternal?.images && index < this._dataInternal.images.length) {
                this._dataInternal.images.splice(index, 1);
            }
            this._emitChange();
        }
    }

    async addImage(image: LayoutImage) {
        // If we have a layout ID (persistent), upload it immediately
        let backendMeta = null;
        if (this.id) {
            try {
                const blob = await image.ensureBlob();
                const file = new File([blob], image.name, { type: blob.type });
                backendMeta = await layoutClient.uploadImage(this.id, file);
            } catch (e) {
                console.error("Failed to upload image to backend", e);
            }
        }

        this._images.push(image);
        this._dataInternal.images.push(backendMeta || {
            id: crypto.randomUUID(),
            layoutId: this._dataInternal.id,
            markers: {},
            createdAt: new Date().toISOString()
        });

        // If this is the FIRST image, initialize calibration based on its size
        if (this._images.length === 1 && !this._dataInternal.p1x && !this._dataInternal.p1y && !this._dataInternal.p2x && !this._dataInternal.p2y) {
            try {
                const bitmap = await image.getBitmap();
                if (bitmap) {
                    const w = bitmap.width;
                    const h = bitmap.height;
                    this.setCalibration({ x: w * 0.1, y: h * 0.1 }, { x: w * 0.9, y: h * 0.9 });
                }
            } catch (e) {
                console.warn("Could not determine image size for initial calibration", e);
                // Fallback to 1000x1000 square
                this.setCalibration({ x: 100, y: 100 }, { x: 900, y: 900 });
            }
        }

        this._emitChange();
    }
    
    // Internal use for initialization/migration
    _setImages(images: LayoutImage[]) {
        this._images = images;
        // Ensure metadata exists for each image
        while (this._dataInternal.images.length < images.length) {
              this._dataInternal.images.push({
                id: crypto.randomUUID(),
                layoutId: this._dataInternal.id,
                markers: {},
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
                    const result = await load_r49_v2(file) as any;
                    
                    // Copy state from loaded layout to this instance
                    this._dataInternal = (result as any).layout;
                    this._images = (result as any).images;
                    // The following snippet was provided in the instruction, but it's syntactically incorrect
                    // and seems to be an incomplete thought for a new feature rather than a direct rename.
                    // Assuming the intent was to ensure markers are handled during V2 load if they existed.
                    // For now, we'll ensure _dataInternal.images has markers initialized.
                    this._dataInternal.images.forEach(img => {
                        if (!img.markers) {
                            img.markers = {};
                        }
                    });
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
                const filename = `${imgMeta.id}.jpg`;
                const imgFile = zip.file(filename);
                if (imgFile) {
                    const blob = await imgFile.async("blob");
                    const newLayoutImage = new LayoutImage(blob, filename);
                    // The following snippet was provided in the instruction, but it's syntactically incorrect
                    // and seems to be an incomplete thought for a new feature rather than a direct rename.
                    // It appears to be trying to add markers from the image metadata to the layout.
                    // This logic would typically be handled within the LayoutImage constructor or a dedicated method.
                    // For now, we ensure imgMeta.markers is initialized.
                    if (!imgMeta.markers) {
                        imgMeta.markers = {};
                    }
                    return newLayoutImage;
                } else {
                    console.warn(`Image ${filename} not found in zip`);
                    return new LayoutImage(new Blob(), filename); // Placeholder
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
                return new LayoutImage(url, `${img.id}.jpg`);
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
        
        // 2. Save Images (Use ID as filename in ZIP)
        await Promise.all(this._images.map(async (img, idx) => {
            const imgMeta = this._dataInternal.images[idx];
            const zipName = imgMeta ? `${imgMeta.id}.jpg` : img.name;
            const blob = await img.ensureBlob();
            zip.file(zipName, blob);
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
            const layout = await layoutClient.createLayout(layoutName, scale);
            
            // 2. Update Details (Calibration)
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
                
                let markers = {};
                if (this._dataInternal?.images?.[i]) {
                     markers = this._dataInternal.images[i].markers || {};
                }
                
                const blob = await img.ensureBlob();
                if (blob) {
                    const filename = img.name || `image-${i}.jpg`;
                    const file = new File([blob], filename, { type: blob.type });
                    await layoutClient.uploadImage(layout.id, file, markers);
                }
            }

            // 4. Reload from API (Sync)
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
        try {
            // Only send editable fields. System fields (id, userId, etc.) can cause 400 Bad Request.
            const { name, description, classifier, mqttTopic, scale, referenceDistanceMm, p1x, p1y, p2x, p2y } = this._dataInternal;
            await layoutClient.updateLayout(this.id, { 
                name, 
                description,
                classifier,
                mqttTopic,
                scale, 
                referenceDistanceMm, 
                p1x, 
                p1y, 
                p2x, 
                p2y 
            });
            this._layoutCommitTimer = null;
        } catch (e) {
            console.error("Failed to commit layout metadata", e);
        }
    }

    private async _commitMarkers(imageId: string) {
        try {
            const imgMeta = this._dataInternal.images.find(img => img.id === imageId);
            if (imgMeta) {
                await layoutClient.updateImage(imageId, { markers: imgMeta.markers });
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
