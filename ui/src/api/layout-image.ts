
export class LayoutImage {
    private _blob: Blob | null = null;
    private _url: string | null = null;
    private _objectURL: string | null = null;
    private _bitmap: ImageBitmap | null = null;
    private _width: number = 0;
    private _height: number = 0;
    public name: string;

    constructor(source: Blob | string, name: string) {
        if (source instanceof Blob) {
            this._blob = source;
        } else {
            this._url = source;
        }
        this.name = name;
    }

    async ensureBlob(): Promise<Blob> {
        if (this._blob) return this._blob;
        if (this._url) {
            const res = await fetch(this._url);
            if (!res.ok) throw new Error("Failed to fetch image");
            this._blob = await res.blob();
            return this._blob;
        }
        throw new Error("No image source");
    }

    get objectURL(): string {
       if (this._objectURL) return this._objectURL;
       if (this._blob) {
           this._objectURL = URL.createObjectURL(this._blob);
           return this._objectURL;
       }
       if (this._url) return this._url;
       return "";
    }
    
    async getBitmap(): Promise<ImageBitmap> {
        if (this._bitmap) return this._bitmap;
        const blob = await this.ensureBlob();
        this._bitmap = await createImageBitmap(blob);
        this._width = this._bitmap.width;
        this._height = this._bitmap.height;
        return this._bitmap;
    }

    get width(): number { return this._width; }
    get height(): number { return this._height; }
    
    dispose() {
        if (this._objectURL && this._blob) {
            URL.revokeObjectURL(this._objectURL);
            this._objectURL = null;
        }
        if (this._bitmap) {
            this._bitmap.close();
            this._bitmap = null;
        }
    }
}
