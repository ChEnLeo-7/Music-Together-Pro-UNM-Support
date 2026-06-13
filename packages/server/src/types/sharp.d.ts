declare module 'sharp' {
  interface SharpInstance {
    rotate(): SharpInstance
    resize(width: number, height: number, options?: { fit?: 'cover'; position?: 'center' }): SharpInstance
    webp(options?: { quality?: number }): SharpInstance
    toBuffer(): Promise<Buffer>
  }

  export default function sharp(input: Buffer, options?: { failOn?: 'error' }): SharpInstance
}
