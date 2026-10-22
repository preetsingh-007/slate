// Minimal types for the parts of pngjs the tests use (dev dependency without bundled types).
declare module 'pngjs' {
  export class PNG {
    constructor(opts?: { width?: number; height?: number });
    width: number;
    height: number;
    data: Uint8Array;
    static sync: {
      write(png: PNG): Uint8Array;
      read(buf: Uint8Array): PNG;
    };
  }
}
