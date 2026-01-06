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
    labels?: Record<string, ApiMarker>;
    createdAt: string;
}

export interface ApiMarker {
    id: UUID,
    x: number, // Pixel coordinate
    y: number,
    type?: string,
}


const API_BASE = '/api';

export class LayoutClient {

    async listLayouts(): Promise<ApiLayout[]> {
        const res = await fetch(`${API_BASE}/layouts`);
        if (!res.ok) throw new Error(`Failed to fetch layouts: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.layouts;
    }

    async getLayout(id: string): Promise<ApiLayout> {
        const res = await fetch(`${API_BASE}/layouts/${id}`);
        if (!res.ok) throw new Error(`Failed to fetch layout: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.layout;
    }

    async createLayout(name: string, scale: string): Promise<ApiLayout> {
        const res = await fetch(`${API_BASE}/layouts`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, scale })
        });
        if (!res.ok) throw new Error(`Failed to create layout: ${res.statusText} (${res.status})`);
        const data = await res.json();

        return data.layout;
    }

    async updateLayout(id: string, updates: Partial<ApiLayout>): Promise<ApiLayout> {
        const res = await fetch(`${API_BASE}/layouts/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error(`Failed to update layout: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.layout;
    }

    async deleteLayout(id: string): Promise<void> {
        const res = await fetch(`${API_BASE}/layouts/${id}`, {
            method: 'DELETE'
        });
        if (!res.ok) throw new Error(`Failed to delete layout: ${res.statusText} (${res.status})`);
    }

    async uploadImage(layoutId: string, file: File, labels?: Record<string, any>): Promise<ApiImage> {
        const formData = new FormData();
        formData.append('file', file);
        if (labels) {
            formData.append('labels', JSON.stringify(labels));
        }

        const res = await fetch(`${API_BASE}/layouts/${layoutId}/images`, {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error(`Failed to upload image: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.image;
    }

    async updateImage(imageId: string, updates: Partial<ApiImage>): Promise<ApiImage> {
        const res = await fetch(`${API_BASE}/images/${imageId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        });
        if (!res.ok) throw new Error(`Failed to update image: ${res.statusText} (${res.status})`);
        const data = await res.json();
        return data.image;
    }

    getImageUrl(imageId: string): string {
        return `${API_BASE}/images/${imageId}`;
    }
}

export const layoutClient = new LayoutClient();
