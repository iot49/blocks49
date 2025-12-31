import JSZip from 'jszip';
import { saveAs } from 'file-saver';
import { createContext } from '@lit/context';
import { Manifest } from './manifest.ts';
import { railsClient } from '../api/client.js';

export const r49FileContext = createContext<R49File>('r49File');


/**
 * R49File serves as the root container for a project's state.
 * 
 * It manages:
 * 1. The `Manifest`: JSON metadata for layout, calibration, and labels.
 * 2. The `R49Image` list: Binary image data managed as blobs.
 * 
 * Lifecycle & Reactivity:
 * This class uses an immutable-update pattern for Lit integration.
 * - When `manifest` or `images` change, it emits `r49-file-changed`.
 * - To trigger a full UI refresh (because Lit detects changes by reference),
 *   the `RrMain` component creates a NEW `R49File` instance using the copy-constructor.
 * 
 * Resource Sharing:
 * When copying to a new instance, the underlying `Manifest` and `R49Image` objects
 * are SHARED/TRANSFERRED, not cloned.
 * The `detach()` method is used to remove listeners from the old instance WITHOUT
 * closing the images, preventing double-free errors.
 * 
 * `dispose()` should only be called when completely closing the file/APP.
 */
export class R49File extends EventTarget {
    private _manifest: Manifest;
    private _images: R49Image[];

    /**
     * Creates a new R49File.
     * @param other Optional previous instance to copy state from.
     *              If provided, resources (images) are shared/transferred.
     */
    constructor(other?: R49File) {
        super();
        
        let m: Manifest | undefined;
        try {
             m = other?.manifest;
        } catch (e) {
             console.warn("Failed to retrieve manifest from previous R49File instance", e);
        }

        this._manifest = m || new Manifest();
        // Shallow copy of image list (transferring ownership of the array container).
        // The Images themselves are reference types and are shared between the old and new instances.
        this._images = (other && other.images) ? [...other.images] : [];
        this._attachManifestListener();
    }

    // =========================================================================
    // Public API
    // =========================================================================

    public get manifest(): Manifest {
        return this._manifest;
    }

    /**
     * Detaches internal listeners, preparing this instance for garbage collection,
     * BUT leaves the underlying resources (images) alive.
     * Use this when transferring state to a new `R49File` instance.
     */
    public detach() {
        this._detachManifestListener();
    }

    /**
     * Fully disposes of this file and ALL its resources.
     * Use this only when closing the application or loading a completely new file.
     */
    public dispose() {
        this._detachManifestListener();
        this._images.forEach(img => img.dispose());
    }

    public getImageUrl(index: number): string | undefined {
        if (index < 0 || index >= this._images.length) return undefined;
        return this._images[index].objectURL;
    }

    public getImageBitmap(index: number): Promise<ImageBitmap | undefined> {
        if (index < 0 || index >= this._images.length) return Promise.resolve(undefined);
        return this._images[index].bitmap;
    }

    /**
     * Loads an .r49 (zip) file.
     * Extracts `manifest.json` and images, creating new `Manifest` and `R49Image` objects.
     */
    public async load(file: File) {
        const reader = new FileReader();
    
        return new Promise<void>((resolve, reject) => {
            reader.onload = async (e) => {
                try {
                    const zip = await JSZip.loadAsync(e.target?.result as ArrayBuffer);
                    const imagePromiseList: Promise<R49Image>[] = [];
                    let manifestFileContent: Promise<string> | undefined;
                    
                    zip.forEach((relativePath, zipEntry) => {
                        if (relativePath.startsWith('image')) {
                            // Extract extension, infer mime type
                            const parts = relativePath.split('.');
                            const extension = parts.length > 1 ? parts[parts.length - 1] : 'jpeg';
                            const mimeType = `image/${extension}`;
                            
                            const imagePromise = zipEntry.async('blob').then(blob => {
                                const typedBlob = new Blob([blob], { type: mimeType });
                                return new R49Image(typedBlob, relativePath);
                            });
                            imagePromiseList.push(imagePromise);
                        } else if (relativePath === 'manifest.json') {
                            manifestFileContent = zipEntry.async('string');
                        }
                    });

                    if (imagePromiseList.length > 0 && manifestFileContent) {
                        const manifestJson = await manifestFileContent;
                        const manifestData = JSON.parse(manifestJson);
                        
                        const images = await Promise.all(imagePromiseList);
                        
                        // Robust sort by filename
                        images.sort((a, b) => {
                            const numA = parseInt(a.name.match(/image-(\d+)/)?.[1] || '0');
                            const numB = parseInt(b.name.match(/image-(\d+)/)?.[1] || '0');
                            return numA - numB;
                        });

                        this._detachManifestListener();
                        this._manifest = new Manifest(manifestData);
                        this._attachManifestListener();
                        
                        // Dispose old images
                        this._images.forEach(img => img.dispose());
                        this._images = images;
                        
                        this._emitChange('load');
                        resolve();
                    } else {
                        reject(new Error('Invalid .r49 file: missing image or manifest.json'));
                    }
                } catch (err) {
                    reject(err);
                }
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsArrayBuffer(file);
        });
    }

    /**
     * Saves the current state as an .r49 (zip) file.
     * Bundles `manifest.json` and all image blobs.
     */
    public async save() {
        if (this._images.length === 0) return;

        const zip = new JSZip();
        
        // Parallel fetch blobs
        const imageEntries = await Promise.all(this._images.map(async (img, i) => {
             const blob = await img.ensureBlob();
             
             let extension = 'jpeg';
             const parts = img.name.split('.');
             if (parts.length > 1) extension = parts[parts.length - 1];
             else if (blob.type) {
                const typeParts = blob.type.split('/');
                if (typeParts.length > 1) extension = typeParts[1];
             }
             
             const imageName = `image-${i}.${extension}`;
             return { name: imageName, blob };
        }));
        
        const imageFilenames: string[] = [];
        imageEntries.forEach(entry => {
            zip.file(entry.name, entry.blob);
            imageFilenames.push(entry.name);
        });

        const images = imageFilenames.map((filename, index) => {
            const existingImage = this._manifest.images[index];
            return {
                filename: filename,
                labels: existingImage ? existingImage.labels : {},
            };
        });

        this._manifest.setImages(images);
        zip.file('manifest.json', this._manifest.toJSON());

        const content = await zip.generateAsync({ type: 'blob' });
        const name = this._manifest.layout.name || 'layout';
        const filename = `${name}.r49`;
        saveAs(content, filename);
    }

    public async syncFromApi(layoutId: string) {
        try {
            const layout = await railsClient.getLayout(layoutId);

            // Dispose old images
            this._images.forEach(img => img.dispose());

            // Create new images from URLs
            this._images = layout.images.map(imgData => {
                const url = railsClient.getImageUrl(imgData.id);
                // We use the ID as name or original filename?
                return new R49Image(url, imgData.filename || 'image.jpg');
            });

            // Update Manifest
            this._detachManifestListener();
            console.log("[R49File] syncFromApi raw layout:", JSON.stringify(layout, null, 2));
            
            // Map Layout Props
            this._manifest.setLayout({
                id: layout.id,
                name: layout.name,
                description: layout.description,
                scale: layout.scale as any,
                size: { width: layout.width, height: layout.height } // Load dimensions from API
            });
            
            // Map Calibration
            if (layout.calibration) {
                // We iterate and set markers because Manifest uses internal reactivity
                // Or just overwrite _data.calibration? 
                // Manifest doesn't expose a bulk setter for calibration, but it exposes the getter.
                // We should add a method or iterate key/values.
                // The current manifest public API has setMarker.
                // Or we can manipulate the private _manifest if we really want, but let's be clean.
                // Manifest constructor accepts data, but we already created it.
                // Let's iterate.
                Object.entries(layout.calibration).forEach(([key, point]) => {
                     this._manifest.setMarker('calibration', key, point.x, point.y);
                });
            }
            
            // Map Images Metadata
            const newManifestImages = layout.images.map((img, idx) => {
                console.log(`[R49File] syncFromApi Image ${idx} labels from API:`, JSON.stringify(img.labels));
                return {
                    filename: img.filename || 'image.jpg',
                    labels: img.labels || {} 
                };
            });
            this._manifest.setImages(newManifestImages);

            this._attachManifestListener();
            this._emitChange('load');
            this._emitChange('manifest'); // Ensure UI updates name/scale
            this._emitChange('images'); 
            
        } catch (e) {
            console.error("Sync failed", e);
            throw e;
        }
    }

    /**
     * Migrates the current client-side state (Manifest + Images) to the Backend.
     * Creates a new Layout, sets dimensions, and uploads images.
     * Then syncs the R49File with the new remote record.
     */
    public async migrateToBackend(): Promise<string> {
        const layoutName = this._manifest.layout.name || 'Imported Layout';
        const scale = this._manifest.layout.scale;
        
        try {
            // 1. Create Layout
            console.log("Migrating: Creating layout...");
            const layout = await railsClient.createLayout(layoutName, scale);
            
            // 2. Update Details (Dimensions)
            // Note: API field is width/height. Manifest is size.width/size.height
            if (this._manifest.layout.size.width) {
                 await railsClient.updateLayout(layout.id, {
                     width: this._manifest.layout.size.width,
                     height: this._manifest.layout.size.height,
                     calibration: this._manifest.calibration,
                 });
            }

            // 3. Upload Images
            console.log(`Migrating: Uploading ${this._images.length} images...`);
            for (let i = 0; i < this._images.length; i++) {
                const img = this._images[i];
                const labels = this._manifest.images[i]?.labels || {};
                console.log(`[R49File] Image ${i} labels before upload:`, labels);
                
                const blob = await img.ensureBlob();
                if (blob) {
                    const filename = img.name || `image-${i}.jpg`;
                    const file = new File([blob], filename, { type: blob.type });
                    await railsClient.uploadImage(layout.id, file, labels);
                }
            }

            // 4. Reload from API (Sync)
            console.log("Migrating: Syncing...");
            await this.syncFromApi(layout.id);
            
            return layout.id;
        } catch (e) {
            console.error("Migration failed", e);
            throw e;
        }
    }

    /**
     * Adds an image file with validation.
     * 
     * Validates that the image dimensions match existing images (or sets dimensions if first image).
     * Extracts the name from the file.
     * 
     * @throws Error if dimensions do not match.
     */
    public async addImageValidated(file: File): Promise<void> {
        return new Promise((resolve, reject) => {
            const objectURL = URL.createObjectURL(file);
            const img = new Image();
            
            img.onload = async () => {
                // Validation: Only if we already have images
                // Note: If we are syncing from API, we trust API images are consistent?
                // But if user uploads a new one, we should validate against existing.
                if (this._images.length > 0) {
                    const currentWidth = this._manifest.camera.resolution.width;
                    const currentHeight = this._manifest.camera.resolution.height;
                    
                    // If resolution is set, check match
                    if (currentWidth && currentHeight && (img.width !== currentWidth || img.height !== currentHeight)) {
                        URL.revokeObjectURL(objectURL);
                        reject(new Error(
                            `New image dimensions (${img.width}x${img.height}) must match existing images (${currentWidth}x${currentHeight}).`
                        ));
                        return;
                    }
                }

                // Cloud Mode: Upload to API
                if (this._manifest.layout.id) {
                    try {
                        const layoutId = this._manifest.layout.id;
                        await railsClient.uploadImage(layoutId, file);
                        
                        // If this is the FIRST image, we might want to set layout dimensions on backend?
                        if (this._images.length === 0) {
                             await railsClient.updateLayout(layoutId, {
                                 width: img.width,
                                 height: img.height
                             });
                        }
                        
                        await this.syncFromApi(layoutId);
                        
                        URL.revokeObjectURL(objectURL);
                        resolve();
                        return;
                    } catch (e) {
                         URL.revokeObjectURL(objectURL);
                         reject(e);
                         return;
                    }
                }

                // Legacy Local Mode:
                // Update manifest dimensions (idempotent if already set)
                this._manifest.setImageDimensions(img.width, img.height);

                // Use filename without extension as name
                const name = file.name.substring(0, file.name.lastIndexOf('.')) || file.name;
                
                this.add_image(file, name);
                
                // Cleanup temp url
                URL.revokeObjectURL(objectURL);
                resolve();
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectURL);
                reject(new Error("Failed to load image for validation."));
            };

            img.src = objectURL;
        });
    }

    /**
     * Adds a new image Blob to the file.
     * Updates the manifest to include the new image metadata.
     */
    public add_image(blob: Blob, name: string) {
        const newImage = new R49Image(blob, name);
        this._images.push(newImage);
        
        // Sync manifest
        const currentImages = this._manifest.images;
        const newIndex = this._images.length - 1; // 0-based index matches array length - 1
        // We use a placeholder filename which will be fixed on save
        const newImageEntry = { filename: `image-${newIndex}`, labels: {} };
        this._manifest.setImages([...currentImages, newImageEntry]);
        
        this._emitChange('images');
    }

    /**
     * Removes an image by index.
     * Disposes of the image resources and updates the manifest.
     */
    public remove_image(index: number) {
        if (index < 0 || index >= this._images.length) return;
        
        const removed = this._images.splice(index, 1);
        removed.forEach(img => img.dispose());

        // Sync manifest
        const currentImages = [...this._manifest.images];
        if (index < currentImages.length) {
            currentImages.splice(index, 1);
            this._manifest.setImages(currentImages);
        }
        this._emitChange('images');
    }

    // =========================================================================
    // Private Details
    // =========================================================================

    // Internal getter for copy-constructor usage
    private get images(): R49Image[] {
        return this._images;
    }

    private set manifest(m: Manifest) {
        this._detachManifestListener();
        this._manifest = m;
        this._attachManifestListener();
        this._emitChange('manifest');
    }

    private set images(imgs: R49Image[]) {
        this._images = imgs;
        this._emitChange('images');
    }

    private _attachManifestListener() {
        this._manifest.addEventListener('rr-manifest-changed', this._onManifestChange);
    }

    private _detachManifestListener() {
        this._manifest.removeEventListener('rr-manifest-changed', this._onManifestChange);
    }

    private _onManifestChange = (e: Event) => {
        // Forward event
        this.dispatchEvent(new CustomEvent('r49-file-changed', {
            detail: { type: 'manifest', originalEvent: e }
        }));
    }

    private _emitChange(type: string) {
        this.dispatchEvent(new CustomEvent('r49-file-changed', {
            detail: { type }
        }));
    }
}

/**
 * R49Image wraps raw image data (Blob) and manages its lifecycle.
 * 
 * It provides lazy access to:
 * - `objectURL`: synchronous URL string for `<img>` tags.
 * - `bitmap`: asynchronous ImageBitmap for canvas drawing / inference.
 * 
 * Resources must be manually released via `dispose()`.
 */
class R49Image {
    private _blob: Blob | null = null;
    private _url: string | null = null;
    private _name: string;
    private _objectURL: string | null = null;
    private _bitmap: ImageBitmap | null = null;

    constructor(source: Blob | string, name: string) {
        if (source instanceof Blob) {
            this._blob = source;
        } else {
            this._url = source;
        }
        this._name = name;
    }

    get name(): string { return this._name; }

    /**
     * The raw Blob data.
     * Returns null if initialized with URL and not yet fetched.
     */
    get blob(): Blob | null { return this._blob; }
    
    /**
     * Ensures blob is available (fetching if necessary).
     */
    async ensureBlob(): Promise<Blob> {
        if (this._blob) return this._blob;
        if (this._url) {
            const res = await fetch(this._url);
            if (!res.ok) throw new Error(`Failed to fetch image ${this._url}`);
            this._blob = await res.blob();
            return this._blob;
        }
        throw new Error("No source for image");
    }

    get objectURL(): string {
        if (this._url) return this._url;
        
        if (!this._objectURL && this._blob) {
            this._objectURL = URL.createObjectURL(this._blob);
        }
        return this._objectURL || '';
    }

    get bitmap(): Promise<ImageBitmap> {
        if (this._bitmap) return Promise.resolve(this._bitmap);
        
        const sourcePromise = this.ensureBlob(); // Consistent way: fetch blob then make bitmap
        // Alternatively, createImageBitmap(img) but we need to load img.
        
        return sourcePromise.then(blob => createImageBitmap(blob)).then(bm => {
            this._bitmap = bm;
            return bm;
        });
    }

    /**
     * Cleans up valid browser resources.
     */
    dispose() {
        if (this._objectURL && this._blob) { // Only revoke if WE created it from Blob
            URL.revokeObjectURL(this._objectURL);
            this._objectURL = null;
        }
        if (this._bitmap) {
            this._bitmap.close();
            this._bitmap = null;
        }
    }
}
