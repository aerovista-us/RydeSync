const VERSION = 5;
const SIZE = 17 + VERSION * 4;
const DATA_CODEWORDS = 108;
const ECC_CODEWORDS = 26;
const MAX_BYTES = 106;

function gfMultiply(x, y) {
  let z = 0;
  while (y) {
    if (y & 1) z ^= x;
    y >>>= 1;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  return z;
}

function rsGenerator(degree) {
  let poly = [1];
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    const out = new Array(poly.length + 1).fill(0);
    for (let j = 0; j < poly.length; j += 1) {
      out[j] ^= poly[j];
      out[j + 1] ^= gfMultiply(poly[j], root);
    }
    poly = out;
    root = gfMultiply(root, 2);
  }
  return poly;
}

function reedSolomon(data, degree = ECC_CODEWORDS) {
  const generator = rsGenerator(degree);
  let remainder = new Array(degree).fill(0);
  for (const byte of data) {
    const factor = byte ^ remainder[0];
    remainder = remainder.slice(1);
    remainder.push(0);
    for (let i = 0; i < degree; i += 1) remainder[i] ^= gfMultiply(generator[i + 1], factor);
  }
  return remainder;
}

function dataCodewords(text) {
  const bytes = [...new TextEncoder().encode(String(text))];
  if (bytes.length > MAX_BYTES) throw new RangeError(`RydeSync QR payload exceeds ${MAX_BYTES} UTF-8 bytes`);

  const bits = [];
  const append = (value, count) => {
    for (let i = count - 1; i >= 0; i -= 1) bits.push((value >>> i) & 1);
  };
  append(0b0100, 4); // byte mode
  append(bytes.length, 8); // version 1-9 character count
  for (const byte of bytes) append(byte, 8);

  const capacity = DATA_CODEWORDS * 8;
  for (let i = 0; i < Math.min(4, capacity - bits.length); i += 1) bits.push(0);
  while (bits.length % 8) bits.push(0);

  const result = [];
  for (let i = 0; i < bits.length; i += 8) {
    let byte = 0;
    for (let j = 0; j < 8; j += 1) byte |= bits[i + j] << (7 - j);
    result.push(byte);
  }
  for (let pad = 0; result.length < DATA_CODEWORDS; pad += 1) result.push(pad % 2 ? 0x11 : 0xec);
  return result;
}

function formatBits(mask = 0) {
  const data = (1 << 3) | mask; // error correction L = 01
  let remainder = data;
  for (let i = 0; i < 10; i += 1) remainder = (remainder << 1) ^ ((remainder >>> 9) * 0x537);
  return ((data << 10) | remainder) ^ 0x5412;
}

export function makeQrMatrix(text) {
  const modules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));
  const functionModules = Array.from({ length: SIZE }, () => new Array(SIZE).fill(false));

  const setFunction = (x, y, value) => {
    if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return;
    modules[y][x] = Boolean(value);
    functionModules[y][x] = true;
  };

  const finder = (cx, cy) => {
    for (let dy = -4; dy <= 4; dy += 1) {
      for (let dx = -4; dx <= 4; dx += 1) {
        const distance = Math.max(Math.abs(dx), Math.abs(dy));
        setFunction(cx + dx, cy + dy, distance !== 2 && distance !== 4);
      }
    }
  };

  const alignment = (cx, cy) => {
    for (let dy = -2; dy <= 2; dy += 1) {
      for (let dx = -2; dx <= 2; dx += 1) setFunction(cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  };

  for (let i = 8; i < SIZE - 8; i += 1) {
    setFunction(6, i, i % 2 === 0);
    setFunction(i, 6, i % 2 === 0);
  }
  finder(3, 3);
  finder(SIZE - 4, 3);
  finder(3, SIZE - 4);
  alignment(30, 30);

  const format = formatBits(0);
  const bit = (i) => (format >>> i) & 1;
  for (let i = 0; i <= 5; i += 1) setFunction(8, i, bit(i));
  setFunction(8, 7, bit(6));
  setFunction(8, 8, bit(7));
  setFunction(7, 8, bit(8));
  for (let i = 9; i < 15; i += 1) setFunction(14 - i, 8, bit(i));
  for (let i = 0; i < 8; i += 1) setFunction(SIZE - 1 - i, 8, bit(i));
  for (let i = 8; i < 15; i += 1) setFunction(8, SIZE - 15 + i, bit(i));
  setFunction(8, SIZE - 8, true);

  const data = dataCodewords(text);
  const codewords = [...data, ...reedSolomon(data)];
  let dataBit = 0;
  for (let right = SIZE - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    const upward = ((right + 1) & 2) === 0;
    for (let vertical = 0; vertical < SIZE; vertical += 1) {
      const y = upward ? SIZE - 1 - vertical : vertical;
      for (let j = 0; j < 2; j += 1) {
        const x = right - j;
        if (functionModules[y][x]) continue;
        let value = dataBit < codewords.length * 8
          ? (codewords[dataBit >>> 3] >>> (7 - (dataBit & 7))) & 1
          : 0;
        if ((x + y) % 2 === 0) value ^= 1; // mask 0
        modules[y][x] = Boolean(value);
        dataBit += 1;
      }
    }
  }
  return modules;
}

export function qrSvg(text, { border = 4 } = {}) {
  const matrix = makeQrMatrix(text);
  const quiet = Math.max(4, Number(border) || 4);
  const viewSize = SIZE + quiet * 2;
  const path = [];
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      if (matrix[y][x]) path.push(`M${x + quiet} ${y + quiet}h1v1h-1z`);
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${viewSize} ${viewSize}" role="img" aria-label="RydeSync join QR code" shape-rendering="crispEdges"><rect width="${viewSize}" height="${viewSize}" fill="#fff"/><path d="${path.join('')}" fill="#000"/></svg>`;
}
