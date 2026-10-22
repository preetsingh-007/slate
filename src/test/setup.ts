import 'fake-indexeddb/auto';

// jsdom's Blob lacks arrayBuffer()/text(); content hashing (sha256Hex) needs them.
if (typeof Blob !== 'undefined' && !Blob.prototype.arrayBuffer && typeof FileReader !== 'undefined') {
  const read = (b: Blob, as: 'buffer' | 'text') =>
    new Promise<ArrayBuffer | string>((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result as ArrayBuffer | string);
      r.onerror = () => reject(r.error);
      if (as === 'buffer') r.readAsArrayBuffer(b);
      else r.readAsText(b);
    });
  Blob.prototype.arrayBuffer = function (this: Blob) {
    return read(this, 'buffer') as Promise<ArrayBuffer>;
  };
  Blob.prototype.text = function (this: Blob) {
    return read(this, 'text') as Promise<string>;
  };
}
