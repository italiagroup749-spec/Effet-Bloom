export function createMatcapDataUri(): string {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';
  }

  const img = ctx.createImageData(size, size);
  const data = img.data;

  // Light direction from upper-left-front
  const lx = -0.45;
  const ly = -0.55;
  const lz = 0.70;
  const lLen = Math.hypot(lx, ly, lz);
  const Lx = lx / lLen;
  const Ly = ly / lLen;
  const Lz = lz / lLen;

  // Halfway vector with view = (0, 0, 1)
  const hx = Lx;
  const hy = Ly;
  const hz = Lz + 1.0;
  const hLen = Math.hypot(hx, hy, hz);
  const Hx = hx / hLen;
  const Hy = hy / hLen;
  const Hz = hz / hLen;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = ((x + 0.5) / size) * 2 - 1;
      const ny = ((y + 0.5) / size) * 2 - 1;
      const r2 = nx * nx + ny * ny;

      let v = 0;
      if (r2 <= 1.0) {
        const nz = Math.sqrt(1.0 - r2);
        const ndotl = Math.max(0, nx * Lx + ny * Ly + nz * Lz);
        const ndoth = Math.max(0, nx * Hx + ny * Hy + nz * Hz);
        const spec = Math.pow(ndoth, 18.0) * 0.35;
        const fresnel = Math.pow(1.0 - nz, 2.5) * 0.16;
        const base = 0.18 + 0.62 * ndotl + spec + fresnel;
        const edgeFade = Math.min(1, (1.0 - Math.sqrt(r2)) * 8.0);
        v = Math.round(Math.min(1, Math.max(0, base * (0.45 + 0.55 * edgeFade))) * 255);
      } else {
        // Soft outer bleed so rotated/filtered texels never sample harsh black borders
        const falloff = Math.max(0, 1 - (Math.sqrt(r2) - 1.0) * 6.0);
        v = Math.round(falloff * 42);
      }

      const idx = (y * size + x) * 4;
      data[idx] = v;
      data[idx + 1] = v;
      data[idx + 2] = v;
      data[idx + 3] = 255;
    }
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png');
}
