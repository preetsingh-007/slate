// Minimal types for pngjs (dev dependency, used to make test images).
declare module 'pngjs' {
  export class PNG {
    constructor(opts: { width: number; height: number });
    data: Buffer;
    static sync: { write(png: PNG): Buffer };
  }
}
