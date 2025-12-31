export interface ApiLayout {
    id: string;
    userId: string;
    name: string;
    description?: string;
    scale: string;
    width?: number;
    height?: number;
    // Calibration
    calibration?: Record<string, any>;
    // Legacy/Alternative Calibration (backend managed)
    calibrationX1?: number;
    calibrationY1?: number;
    calibrationX2?: number;
    calibrationY2?: number;
    referenceDistanceMm?: number;
    standardGaugeMm?: number; // Derived on backend, but we might want it here if returned
    images: ApiImage[];
    createdAt: string; // ISO Date
    updatedAt: string;
}

export interface ApiImage {
    id: string;
    layoutId: string;
    filename: string;
    width: number;
    height: number;
    labels?: Record<string, any>;
    createdAt: string;
}

const API_BASE = '/api';

export class RailsClient {
    
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

export const railsClient = new RailsClient();
