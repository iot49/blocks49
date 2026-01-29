export class DriveClient {
    private clientId: string;
    private clientSecret: string;
    private refreshToken: string;
    private accessToken: string | null = null;
    private tokenExpiry: number = 0;

    constructor(clientId: string, clientSecret: string, refreshToken: string) {
        this.clientId = clientId;
        this.clientSecret = clientSecret;
        this.refreshToken = refreshToken;
    }

    private async getAccessToken() {
        if (this.accessToken && Date.now() < this.tokenExpiry) {
            return this.accessToken;
        }

        const params = new URLSearchParams();
        params.append('client_id', this.clientId);
        params.append('client_secret', this.clientSecret);
        params.append('refresh_token', this.refreshToken);
        params.append('grant_type', 'refresh_token');

        const res = await fetch('https://oauth2.googleapis.com/token', {
            method: 'POST',
            body: params,
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' }
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Failed to refresh token: ${res.status} ${txt}`);
        }

        const data = await res.json() as any;
        this.accessToken = data.access_token;
        this.tokenExpiry = Date.now() + (data.expires_in * 1000) - 60000; // 1 min buffer
        return this.accessToken;
    }

    async findFolder(name: string) {
        const token = await this.getAccessToken();
        const q = `mimeType='application/vnd.google-apps.folder' and name='${name}' and trashed=false`;
        const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}`, {
            headers: { Authorization: `Bearer ${token}` }
        });
        
        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Find Folder failed: ${res.status} ${txt}`);
        }

        const data = await res.json() as any;
        if (data.files && data.files.length > 0) {
            return data.files[0].id;
        }
        return null;
    }

    async createFolder(name: string) {
        const token = await this.getAccessToken();
        const res = await fetch('https://www.googleapis.com/drive/v3/files', {
            method: 'POST',
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                name,
                mimeType: 'application/vnd.google-apps.folder'
            })
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Create Folder failed: ${res.status} ${txt}`);
        }

        const data = await res.json() as any;
        return data.id;
    }

    async uploadFile(filename: string, content: string | Blob | ArrayBuffer, mimeType: string, parentId?: string) {
        const token = await this.getAccessToken();
        const metadata: any = {
            name: filename,
            mimeType: mimeType
        };
        if (parentId) {
            metadata.parents = [parentId];
        }

        const form = new FormData();
        form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
        // Blob constructor accepts ArrayBuffer, Blob, or string[]
        form.append('file', content instanceof Blob ? content : new Blob([content], { type: mimeType }));

        const res = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` },
            body: form
        });

        if (!res.ok) {
            const txt = await res.text();
            throw new Error(`Upload failed: ${res.status} ${txt}`);
        }
        return await res.json();
    }
    async listFiles(folderId: string): Promise<Set<string>> {
        const token = await this.getAccessToken();
        const names = new Set<string>();
        let pageToken: string | null = null;

        do {
            const q = `'${folderId}' in parents and trashed=false`;
            const url = new URL('https://www.googleapis.com/drive/v3/files');
            url.searchParams.append('q', q);
            url.searchParams.append('fields', 'nextPageToken, files(name)');
            url.searchParams.append('pageSize', '1000'); // Max page size
            if (pageToken) {
                url.searchParams.append('pageToken', pageToken);
            }

            const res = await fetch(url.toString(), {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (!res.ok) {
                throw new Error(`List files failed: ${res.status}`);
            }

            const data = await res.json() as any;
            if (data.files) {
                for (const f of data.files) {
                    names.add(f.name);
                }
            }
            pageToken = data.nextPageToken;
        } while (pageToken);

        return names;
    }
}
