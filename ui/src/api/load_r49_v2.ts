import JSZip from 'jszip';
import { Layout } from './layout';
import { LayoutImage } from './layout-image';
import type { ApiLayout, ApiImage, ApiMarker } from './client';

export async function load_r49_v2(file: File): Promise<Layout> {
    const zip = await JSZip.loadAsync(file);
    const manifestFile = zip.file("manifest.json");

    if (!manifestFile) {
        throw new Error("Invalid .r49 file (missing manifest.json)");
    }

    const jsonText = await manifestFile.async("string");
    const manifest = JSON.parse(jsonText);

    if (manifest.version !== 2) {
        throw new Error(`Unsupported legacy version: ${manifest.version}`);
    }

    // --- Migrate Manifest V2 Data to V3 ApiLayout ---
    
    // 1. Dimensions & Reference Distance
    // Manifest: layout.size { width, height }
    let width = manifest.layout.size?.width;
    let height = manifest.layout.size?.height;
    
    // If undefined, we might infer from calibration, but v2 spec relies on size.
    // We assume they exist or default to 0 to avoid crashes, but should warn.
    if (!width || !height) {
        console.warn("Legacy layout missing dimensions.");
        width = 0;
        height = 0;
    }
    
    // Reference Distance = Diagonal of the layout board
    const referenceDistanceMm = Math.sqrt(width * width + height * height);

    // 2. Calibration Markers
    // V2: rect-0 (Top-Left), rect-3 (Bottom-Right)
    const rect0 = manifest.calibration?.['rect-0'];
    const rect3 = manifest.calibration?.['rect-3'];

    if (!rect0 || !rect3) {
        const missing = [];
        if (!rect0) missing.push('rect-0');
        if (!rect3) missing.push('rect-3');
        throw new Error(`Legacy layout missing required calibration markers: ${missing.join(', ')}`);
    }

    // 3. Images (load blobs)
    const images: LayoutImage[] = [];
    const imageMeta: ApiImage[] = [];
    
    // Iterate manifest images to preserve order and load files
    if (manifest.images && Array.isArray(manifest.images)) {
        for (let i = 0; i < manifest.images.length; i++) {
            const entry = manifest.images[i];
            const filename = entry.filename;
            
            const fileInZip = zip.file(filename);
            let blob: Blob;
            
            if (fileInZip) {
                // Infer type? JSZip gives blob, we can try to guess mime or use generic.
                const zipBlob = await fileInZip.async("blob");
                // basic mime guess from extension
                const ext = filename.split('.').pop()?.toLowerCase();
                const type = ext === 'png' ? 'image/png' : 'image/jpeg';
                blob = new Blob([zipBlob], { type });
            } else {
                console.warn(`Image file ${filename} missing in zip.`);
                blob = new Blob([]);
            }

            const layoutImage = new LayoutImage(blob, filename);
            images.push(layoutImage);
            
            // Map Labels (Filtering out 'train-end' as it is no longer supported)
            const labels: Record<string, ApiMarker> = {};
            if (entry.labels) {
                Object.entries(entry.labels)
                    .filter(([_, m]: [string, any]) => m.type !== 'train-end')
                    .forEach(([id, m]: [string, any]) => {
                        labels[id] = {
                            id,
                            x: m.x,
                            y: m.y,
                            type: m.type || 'track'
                        };
                    });
            }

            imageMeta.push({
                id: crypto.randomUUID(),
                layoutId: "", // Set later
                labels: labels,
                createdAt: new Date().toISOString()
            });
        }
    }

    // Construct Layout Data
    const layoutData: ApiLayout = {
        id: crypto.randomUUID(),
        userId: "",
        name: manifest.layout.name || "Imported Layout",
        description: manifest.layout.description,
        scale: manifest.layout.scale || "HO",
        referenceDistanceMm: Math.round(referenceDistanceMm),
        // Map Calibration
        p1x: rect0.x,
        p1y: rect0.y,
        p2x: rect3.x,
        p2y: rect3.y,
        
        images: imageMeta,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
    };

    // Correct layoutIDs in images
    layoutData.images.forEach(img => img.layoutId = layoutData.id);

    // Initialise and return Layout
    const layout = new Layout(layoutData);
    layout._setImages(images);

    return layout;
}