// ============================================================================
// SAMARITAN SHIELD — Incident Record PDF
//
// This document is NOT government-issued and is NOT digitally signed. It is a
// timestamped account of assistance rendered, carrying a digest that can be
// checked against the stored record. The Section 134A protections it
// summarises apply by law whether or not anyone holds this paper.
// ============================================================================

import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';

export interface LegalShieldParams {
  userId: string;
  lat: number;
  lng: number;
  timestamp: string;
  hash: string;
  hospitalName?: string;
  verifyUrl: string;
}

export async function generateLegalShieldPDF({ userId, lat, lng, timestamp, hash, hospitalName, verifyUrl }: LegalShieldParams): Promise<string> {
  const pdfDoc = await PDFDocument.create();
  const page = pdfDoc.addPage([595.28, 841.89]); // Standard A4

  const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);
  const fontRegular = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontMono = await pdfDoc.embedFont(StandardFonts.Courier);

  const { width, height } = page.getSize();
  const margin: number = 36;
  const certId: string = `SS-CERT-${Date.now().toString(36).toUpperCase()}-${hash.substring(0, 6).toUpperCase()}`;

  // 1. Outer & Inner Certificate Security Borders
  page.drawRectangle({
    x: 18,
    y: 18,
    width: width - 36,
    height: height - 36,
    borderColor: rgb(0.82, 0.65, 0.25), // Gold border
    borderWidth: 2,
  });

  page.drawRectangle({
    x: 23,
    y: 23,
    width: width - 46,
    height: height - 46,
    borderColor: rgb(0.08, 0.15, 0.32), // Deep Navy thin border
    borderWidth: 0.75,
  });

  // Corner Gold Accents
  const cornerSize = 14;
  page.drawRectangle({ x: 23, y: height - 23 - cornerSize, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: width - 23 - cornerSize, y: height - 23 - cornerSize, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: 23, y: 23, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });
  page.drawRectangle({ x: width - 23 - cornerSize, y: 23, width: cornerSize, height: cornerSize, color: rgb(0.82, 0.65, 0.25) });

  // 2. Official Header Banner (Deep Navy)
  page.drawRectangle({
    x: 24,
    y: height - 120,
    width: width - 48,
    height: 96,
    color: rgb(0.06, 0.12, 0.25),
  });

  page.drawText('SAMARITAN SHIELD • INDEPENDENT EMERGENCY RECORD', {
    x: margin + 10,
    y: height - 50,
    size: 9,
    font: fontBold,
    color: rgb(0.85, 0.72, 0.35),
  });

  page.drawText('GOOD SAMARITAN INCIDENT RECORD', {
    x: margin + 10,
    y: height - 76,
    size: 17,
    font: fontBold,
    color: rgb(1, 1, 1),
  });

  page.drawText('NOT A GOVERNMENT DOCUMENT. A timestamped account of assistance rendered, with the bearer\'s statutory rights summarised overleaf.', {
    x: margin + 10,
    y: height - 98,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.85, 0.88, 0.95),
  });

  let y: number = height - 142;

  // 3. Certificate ID & Verification Status Bar
  page.drawRectangle({
    x: margin,
    y: y - 26,
    width: width - 2 * margin,
    height: 28,
    color: rgb(0.94, 0.96, 1.0),
    borderColor: rgb(0.8, 0.85, 0.95),
    borderWidth: 1,
  });

  page.drawText(`RECORD ID: ${certId}`, {
    x: margin + 12,
    y: y - 17,
    size: 9.5,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });

  page.drawText('RECORD STATUS: TIMESTAMPED & HASHED', {
    x: width - margin - 220,
    y: y - 17,
    size: 9.5,
    font: fontBold,
    color: rgb(0.1, 0.55, 0.2),
  });

  y -= 48;

  // 4. Certified Incident Record Table Header
  page.drawText('1. RECORDED EMERGENCY INCIDENT', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  const incidentDetails: [string, string][] = [
    ['Responder ID', userId],
    ['Emergency Coordinates', `Lat ${lat.toFixed(6)}, Lng ${lng.toFixed(6)} (device-reported)`],
    ['Server UTC Timestamp', `${timestamp} (recorded server-side)`],
    ['Routed Hospital', hospitalName || 'No facility located — call 108'],
    ['Guidance Provided', 'Severe trauma protocol: bleeding, breathing, compressions-only CPR'],
  ];

  page.drawRectangle({
    x: margin,
    y: y - (incidentDetails.length * 20 + 6),
    width: width - 2 * margin,
    height: incidentDetails.length * 20 + 6,
    color: rgb(0.98, 0.98, 0.99),
    borderColor: rgb(0.85, 0.87, 0.92),
    borderWidth: 1,
  });

  y -= 16;
  for (const [label, value] of incidentDetails) {
    page.drawText(label, {
      x: margin + 12,
      y,
      size: 9,
      font: fontBold,
      color: rgb(0.3, 0.35, 0.45),
    });
    page.drawText(value, {
      x: margin + 170,
      y,
      size: 9,
      font: fontRegular,
      color: rgb(0.1, 0.12, 0.15),
    });
    y -= 20;
  }

  y -= 16;

  // 5. Cryptographic Proof Section
  page.drawText('2. INTEGRITY DIGEST', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  page.drawRectangle({
    x: margin,
    y: y - 48,
    width: width - 2 * margin,
    height: 52,
    color: rgb(0.95, 0.97, 0.95),
    borderColor: rgb(0.4, 0.75, 0.45),
    borderWidth: 1,
  });

  page.drawText('SHA-256 OF THE STORED RECORD — CHECK IT AT THE URL BELOW:', {
    x: margin + 12,
    y: y - 14,
    size: 8,
    font: fontBold,
    color: rgb(0.15, 0.45, 0.2),
  });

  page.drawText(hash, {
    x: margin + 12,
    y: y - 32,
    size: 8.5,
    font: fontMono,
    color: rgb(0.05, 0.25, 0.08),
  });

  y -= 64;

  // 6. Comprehensive Statutory Legal Immunity Declaration
  page.drawText('3. YOUR RIGHTS AS A GOOD SAMARITAN (SUMMARY OF LAW)', {
    x: margin,
    y,
    size: 11,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });
  y -= 14;

  page.drawRectangle({
    x: margin,
    y: y - 150,
    width: width - 2 * margin,
    height: 154,
    color: rgb(0.99, 0.99, 0.97),
    borderColor: rgb(0.85, 0.75, 0.45),
    borderWidth: 1,
  });

  y -= 16;
  const legalClauses: string[] = [
    'These protections come from law and apply whether or not you hold this document.',
    '',
    '1. PROTECTION FROM LIABILITY: Under Section 134A of the Motor Vehicles (Amendment) Act, 2019, a',
    '   person who renders emergency medical or non-medical assistance to an accident victim is not',
    '   liable for any civil or criminal action for injury to or death of the victim arising from it.',
    '',
    '2. PROTECTION FROM HARASSMENT: Following the Supreme Court of India in Writ Petition (Civil) No. 235',
    '   of 2012, a Good Samaritan cannot be compelled to disclose their identity or address, and must not',
    '   be detained or subjected to mandatory questioning.',
    '',
    '3. HOSPITAL TREATMENT: Hospitals, government and private, must provide immediate emergency treatment',
    '   and cannot demand payment or registration from the Good Samaritan as a condition of doing so.',
  ];

  for (const line of legalClauses) {
    page.drawText(line, {
      x: margin + 12,
      y,
      size: 8,
      font: line.startsWith('1.') || line.startsWith('2.') || line.startsWith('3.') ? fontBold : fontRegular,
      color: rgb(0.18, 0.2, 0.25),
    });
    y -= 12;
  }

  y -= 30;

  // 7. Digital Seals & Signatures Footer
  page.drawRectangle({
    x: margin,
    y: y - 60,
    width: width - 2 * margin,
    height: 64,
    color: rgb(0.96, 0.97, 0.99),
    borderColor: rgb(0.85, 0.88, 0.94),
    borderWidth: 1,
  });

  page.drawText('GENERATED BY SAMARITAN SHIELD', {
    x: margin + 14,
    y: y - 20,
    size: 8.5,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });

  page.drawText(`Not a government document • Not digitally signed • Recorded: ${timestamp}`, {
    x: margin + 14,
    y: y - 36,
    size: 7.5,
    font: fontRegular,
    color: rgb(0.4, 0.45, 0.55),
  });

  page.drawText('VERIFY THIS RECORD', {
    x: width - margin - 190,
    y: y - 20,
    size: 8.5,
    font: fontBold,
    color: rgb(0.08, 0.15, 0.35),
  });

  page.drawText(verifyUrl, {
    x: width - margin - 190,
    y: y - 34,
    size: 6,
    font: fontMono,
    color: rgb(0.25, 0.35, 0.5),
  });

  // Footer Note
  page.drawText('This record was generated automatically by Samaritan Shield. It is not issued, certified or endorsed by any government body, and it does not itself confer any legal status.', {
    x: margin,
    y: 28,
    size: 6.5,
    font: fontRegular,
    color: rgb(0.5, 0.55, 0.65),
  });

  const pdfBytes: Uint8Array = await pdfDoc.save();
  return Buffer.from(pdfBytes).toString('base64');
}
