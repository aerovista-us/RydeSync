import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { makeQrMatrix, qrSvg } from '../qr-lite.js';

function matrixHash(matrix) {
  const bits = matrix.flat().map((value) => value ? '1' : '0').join('');
  return crypto.createHash('sha256').update(bits).digest('hex');
}

test('invite QR matches the locked version-5-L mask-0 reference matrix', () => {
  const matrix = makeQrMatrix('https://rydesync.aerovista.us/join/ABCD2345');
  assert.equal(matrix.length, 37);
  assert.ok(matrix.every((row) => row.length === 37));
  assert.equal(matrixHash(matrix), 'a62b830203e5f6337234813b95869387e6454e328c008e5f935b914fb2134396');
});

test('QR SVG includes a four-module quiet zone and rejects oversized payloads', () => {
  const svg = qrSvg('https://rydesync.aerovista.us/join/ABCD2345');
  assert.match(svg, /viewBox="0 0 45 45"/);
  assert.match(svg, /fill="#fff"/);
  assert.throws(() => makeQrMatrix('x'.repeat(107)), RangeError);
});
