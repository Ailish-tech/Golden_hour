// ============================================================================
// Incident record PDF — renders, and does not claim to be what it is not.
// ============================================================================

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import { generateLegalShieldPDF } from '../certificate';

/**
 * pdf-lib Flate-compresses page content streams and writes text as hex
 * strings, so drawn text is not visible in the raw bytes. Inflate every
 * stream, then decode the hex string operands back to text.
 */
function extractText(pdf: Buffer): string {
  let content = '';
  let idx = 0;

  while (true) {
    const start = pdf.indexOf('stream', idx);
    if (start === -1) break;
    if (start >= 3 && pdf.subarray(start - 3, start).toString('latin1') === 'end') {
      idx = start + 6;
      continue;
    }
    let dataStart = start + 'stream'.length;
    if (pdf[dataStart] === 0x0d) dataStart++;
    if (pdf[dataStart] === 0x0a) dataStart++;

    const end = pdf.indexOf('endstream', dataStart);
    if (end === -1) break;

    const chunk = pdf.subarray(dataStart, end);
    try {
      content += zlib.inflateSync(chunk).toString('latin1');
    } catch (_e) {
      content += chunk.toString('latin1');
    }
    idx = end + 'endstream'.length;
  }

  // Standard-14 fonts use single-byte encoding, so hex pairs map to characters.
  return (content.match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((token) => Buffer.from(token.slice(1, -1), 'hex').toString('latin1'))
    .join('\n');
}

const params = {
  userId: 'test-uid-001',
  lat: 26.9085,
  lng: 75.7328,
  timestamp: '2026-08-24T09:15:00.000Z',
  hash: 'a'.repeat(64),
  hospitalName: 'Sawai Man Singh (SMS) Government Trauma Hospital',
  verifyUrl: 'https://example.org/api/verify/' + 'a'.repeat(64),
};

async function renderText(overrides: Partial<typeof params> = {}): Promise<string> {
  const base64 = await generateLegalShieldPDF({ ...params, ...overrides });
  return extractText(Buffer.from(base64, 'base64'));
}

describe('incident record PDF', () => {
  test('produces a valid PDF', async () => {
    const base64 = await generateLegalShieldPDF(params);
    const buf = Buffer.from(base64, 'base64');
    assert.equal(buf.subarray(0, 5).toString(), '%PDF-');
    assert.ok(buf.length > 2000, `suspiciously small: ${buf.length} bytes`);
  });

  test('carries the digest and a verification URL', async () => {
    const text = await renderText();
    assert.ok(text.includes(params.hash), 'digest missing from the document');
    assert.ok(text.includes('VERIFY THIS RECORD'), 'verification prompt missing');
  });

  test('names the hospital it actually routed to', async () => {
    const text = await renderText({ hospitalName: 'Fortis Escorts Emergency & Trauma Department' });
    assert.ok(text.includes('Fortis Escorts'), 'routed hospital not printed');
    // The old build hardcoded this into every certificate regardless of routing.
    assert.ok(!text.includes('City Central Trauma Center'), 'hardcoded hospital is back');
  });

  test('says so when no hospital could be located', async () => {
    const text = await renderText({ hospitalName: undefined });
    assert.ok(text.includes('No facility located'), 'missing no-facility notice');
  });

  test('makes no claim of government issuance, sealing or signature', async () => {
    const text = await renderText();
    for (const claim of [
      'GOVERNMENT OF INDIA',
      'OFFICIAL DIGITAL SEAL',
      'IMMUNITY ACTIVE',
      'STATUTORY EMERGENCY RECORD',
    ]) {
      assert.ok(!text.includes(claim), `document still claims: ${claim}`);
    }
    assert.ok(text.includes('Not a government document'), 'disclaimer missing');
  });

  test('still states the responder\'s statutory rights', async () => {
    const text = await renderText();
    assert.ok(text.includes('134A'), 'Section 134A reference missing');
    assert.ok(text.includes('apply whether or not you hold this document'));
  });
});
