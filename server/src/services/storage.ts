import type { Context } from 'hono';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

export interface StorageService {
    get(c: Context, key: string): Promise<Response>;
    put(c: Context, key: string, data: any, contentType: string): Promise<void>;
    delete(c: Context, key: string): Promise<void>;
}

// Local File System Storage (Node.js)
export class LocalStorageService implements StorageService {
    private storageDir: string;

    constructor(storageDir: string) {
        this.storageDir = storageDir;
    }

    async get(c: Context, key: string): Promise<Response> {
        const { readFile } = await import('fs/promises');
        const { join } = await import('path');
        const buffer = await readFile(join(this.storageDir, key));
        return new Response(buffer, {
            headers: { 'Content-Type': 'image/jpeg' }
        });
    }

    async put(c: Context, key: string, data: any, contentType: string): Promise<void> {
        const { writeFile, mkdir } = await import('fs/promises');
        const { join, dirname } = await import('path');
        const path = join(this.storageDir, key);
        try {
            await mkdir(dirname(path), { recursive: true });
            const content = data instanceof ArrayBuffer ? Buffer.from(data) : data;
            await writeFile(path, content);
        } catch (e: any) {
            console.error(`[LocalStorage] Failed to put ${key}: ${e.message}`, e.stack);
            throw e;
        }
    }

    async delete(c: Context, key: string): Promise<void> {
        const { unlink } = await import('fs/promises');
        const { join } = await import('path');
        try {
            await unlink(join(this.storageDir, key));
        } catch (e) {}
    }
}

// Cloudflare R2 Storage
export class R2StorageService implements StorageService {
    private bindingName: string;

    constructor(bindingName: string = 'IMAGES') {
        this.bindingName = bindingName;
    }

    private getBucket(c: Context): any {
        const bucket = (c.env as any)[this.bindingName];
        if (!bucket) throw new Error(`R2 Bucket ${this.bindingName} not found in env`);
        return bucket;
    }

    async get(c: Context, key: string): Promise<Response> {
        const bucket = this.getBucket(c);
        const object = await bucket.get(key);
        if (!object) return new Response('Not Found', { status: 404 });

        const headers = new Headers();
        object.writeHttpMetadata(headers);
        headers.set('etag', object.httpEtag);

        return new Response(object.body, { headers });
    }

    async put(c: Context, key: string, data: any, contentType: string): Promise<void> {
        const bucket = this.getBucket(c);
        await bucket.put(key, data, {
            httpMetadata: { contentType: contentType }
        });
    }

    async delete(c: Context, key: string): Promise<void> {
        const bucket = this.getBucket(c);
        await bucket.delete(key);
    }
}

let storageInstance: StorageService | undefined;

export function getStorage(c: Context): StorageService {
    if (c.env?.IMAGES) {
        return new R2StorageService();
    }
    
    // In Node, we lazily initialize the local storage
    if (!storageInstance) {
        // Use an absolute path resolved from the project root to avoid CWD confusion
        const projectRoot = join(dirname(fileURLToPath(import.meta.url)), '../../../'); 
        let storageDir = process.env.STORAGE_DIR || join(projectRoot, 'local/server/data/images');
        storageInstance = new LocalStorageService(storageDir);
    }
    return storageInstance;
}
