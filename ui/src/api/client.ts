export type UUID = string;

export interface ApiLayout {
    id: UUID;
    userId: UUID;
    name: string;
    description?: string;
    scale: string;
    
    // Calibration Points
    p1x?: number;
    p1y?: number;
    p2x?: number;
    p2y?: number;
    referenceDistanceMm?: number;  // Distance between calibration points (mm)
    
    // Derived/Backend fields (standardGaugeMm excluded)
    images: ApiImage[];
    
    createdAt: string; // ISO Date
    updatedAt: string;
}

export interface ApiImage {
    id: UUID;
    layoutId: UUID;
    // TODO: remove field - this is id.jpg
    filename: string;
    labels?: Record<string, ApiMarker>;
    createdAt: string;
}

export interface ApiMarker {
    id: UUID,
    x: number,
    y: number,
    type?: string,
}


const API_BASE = '/api';

export class LayoutClient {

    async listLayouts(): Promise<ApiLayout[]> {
        const res = await fetch(`${API_BASE}/layouts`);
        if (!res.ok) throw new Error('Failed to fetch layouts');
        const data = await res.json();
        return data.layouts;
    }

    async getLayout(id: string): Promise<ApiLayout> {
        const res = await fetch(`${API_BASE}/layouts/${id}`);
        if (!res.ok) throw new Error('Failed to fetch layout');
        const data = await res.json();
        return data.layout;
    }

    async createLayout(name: string, scale: string): Promise<ApiLayout> {
        console.log("Creating layout", name, scale, `${API_BASE}/layouts`);
        const res = await fetch(`${API_BASE}/layouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, scale })
        });
        // TODO: more descriptive error message (also for other Errors in app)
        if (!res.ok) throw new Error('Failed to create layout');
        const data = await res.json();

        return data.layout;
    }

    async updateLayout(id: string, updates: Partial<ApiLayout>): Promise<ApiLayout> {
        const res = await fetch(`${API_BASE}/layouts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error('Failed to update layout');
        const data = await res.json();
        return data.layout;
    }

    async uploadImage(layoutId: string, file: File, labels?: Record<string, any>): Promise<ApiImage> {
        console.log(`[RailsClient] uploadImage labels:`, labels);
        const formData = new FormData();
        formData.append('file', file);
        if (labels) {
            formData.append('labels', JSON.stringify(labels));
        }

        const res = await fetch(`${API_BASE}/layouts/${layoutId}/images`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to upload image');
        const data = await res.json();
        return data.image;
    }

    getImageUrl(imageId: string): string {
        return `${API_BASE}/images/${imageId}`;
    }
}

export const layoutClient = new LayoutClient();
