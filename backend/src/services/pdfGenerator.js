/**
 * High-performance, zero-dependency PDF Generator for Official Student Result Cards.
 * Produces standard-compliant, vector-sharp A4 PDF documents matching the exact
 * official "STATEMENT OF MARKS" design used in the admin view-pdf dashboard.
 */

const fs = require('fs');
const path = require('path');

function escapePdfText(str) {
  return String(str || '')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

class PdfDoc {
  constructor(width = 595.28, height = 841.89) {
    this.width = width;   // Standard A4 width in pt (72 dpi)
    this.height = height; // Standard A4 height in pt
    this.stream = [];
    this.images = [];     // { id, name, buffer, width, height, objNum }
  }

  addImage(name, buffer, width, height) {
    const id = this.images.length + 1;
    this.images.push({ id, name, buffer, width, height });
    return name;
  }

  drawImage(name, x, y, w, h) {
    const img = this.images.find(i => i.name === name);
    if (!img) return;
    const pdfY = this.height - y - h;
    const cmd = `q\n${w.toFixed(2)} 0 0 ${h.toFixed(2)} ${x.toFixed(2)} ${pdfY.toFixed(2)} cm\n/${name} Do\nQ\n`;
    this.stream.push(cmd);
  }

  rect(x, y, w, h, fillRgb = null, strokeRgb = null, lineWidth = 1) {
    const pdfY = this.height - y - h;
    let cmd = 'q\n';
    if (lineWidth) cmd += `${lineWidth.toFixed(2)} w\n`;
    if (strokeRgb) cmd += `${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG\n`;
    if (fillRgb) cmd += `${fillRgb[0]} ${fillRgb[1]} ${fillRgb[2]} rg\n`;
    cmd += `${x.toFixed(2)} ${pdfY.toFixed(2)} ${w.toFixed(2)} ${h.toFixed(2)} re\n`;
    if (fillRgb && strokeRgb) cmd += 'B\n';
    else if (fillRgb) cmd += 'f\n';
    else if (strokeRgb) cmd += 'S\n';
    cmd += 'Q\n';
    this.stream.push(cmd);
  }

  line(x1, y1, x2, y2, strokeRgb = [0, 0, 0], lineWidth = 1, dashed = false) {
    const pdfY1 = this.height - y1;
    const pdfY2 = this.height - y2;
    let cmd = 'q\n';
    if (dashed) cmd += '[3 3] 0 d\n';
    cmd += `${lineWidth.toFixed(2)} w\n`;
    cmd += `${strokeRgb[0]} ${strokeRgb[1]} ${strokeRgb[2]} RG\n`;
    cmd += `${x1.toFixed(2)} ${pdfY1.toFixed(2)} m ${x2.toFixed(2)} ${pdfY2.toFixed(2)} l S\nQ\n`;
    this.stream.push(cmd);
  }

  text(str, x, y, options = {}) {
    const font = options.font || 'F1'; // F1 = Regular, F2 = Bold, F3 = Italic
    const size = options.size || 10;
    const color = options.color || [0, 0, 0];
    const align = options.align || 'left';
    const width = options.width || 0;

    let posX = x;
    const textStr = String(str || '');
    if (align === 'center' && width > 0) {
      const approxCharWidth = size * 0.52;
      const textW = textStr.length * approxCharWidth;
      posX = x + Math.max(0, (width - textW) / 2);
    } else if (align === 'right' && width > 0) {
      const approxCharWidth = size * 0.52;
      const textW = textStr.length * approxCharWidth;
      posX = x + Math.max(0, width - textW);
    }

    const pdfY = this.height - y - size;
    const escaped = escapePdfText(textStr);
    let cmd = `q\n${color[0]} ${color[1]} ${color[2]} rg\nBT\n/${font} ${size} Tf\n`;
    cmd += `1 0 0 1 ${posX.toFixed(2)} ${pdfY.toFixed(2)} Tm\n(${escaped}) Tj\nET\nQ\n`;
    this.stream.push(cmd);
  }

  toBuffer() {
    const content = this.stream.join('');
    const contentBuf = Buffer.from(content, 'latin1');

    // 1: Catalog, 2: Pages, 3: Page, 4: Content Stream, 5: F1, 6: F2, 7: F3
    let nextObjId = 8;
    this.images.forEach(img => {
      img.objNum = nextObjId++;
    });

    let xobjDict = '';
    if (this.images.length > 0) {
      xobjDict = ' /XObject << ' + this.images.map(img => `/${img.name} ${img.objNum} 0 R`).join(' ') + ' >>';
    }

    const objHeaders = [];
    const objBodies = [];

    // Obj 1: Catalog
    objHeaders.push('1 0 obj\n');
    objBodies.push(Buffer.from('<< /Type /Catalog /Pages 2 0 R >>\nendobj\n', 'latin1'));

    // Obj 2: Pages
    objHeaders.push('2 0 obj\n');
    objBodies.push(Buffer.from('<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n', 'latin1'));

    // Obj 3: Page
    objHeaders.push('3 0 obj\n');
    objBodies.push(Buffer.from(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >>${xobjDict} >> >>\nendobj\n`, 'latin1'));

    // Obj 4: Content Stream
    objHeaders.push('4 0 obj\n');
    const streamHead = Buffer.from(`<< /Length ${contentBuf.length} >>\nstream\n`, 'latin1');
    const streamFoot = Buffer.from('\nendstream\nendobj\n', 'latin1');
    objBodies.push(Buffer.concat([streamHead, contentBuf, streamFoot]));

    // Obj 5: Font F1 (Helvetica)
    objHeaders.push('5 0 obj\n');
    objBodies.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n', 'latin1'));

    // Obj 6: Font F2 (Helvetica-Bold)
    objHeaders.push('6 0 obj\n');
    objBodies.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj\n', 'latin1'));

    // Obj 7: Font F3 (Helvetica-Oblique)
    objHeaders.push('7 0 obj\n');
    objBodies.push(Buffer.from('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj\n', 'latin1'));

    // Image XObjects
    this.images.forEach(img => {
      objHeaders.push(`${img.objNum} 0 obj\n`);
      const imgHead = Buffer.from(`<< /Type /XObject /Subtype /Image /Width ${img.width} /Height ${img.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.buffer.length} >>\nstream\n`, 'latin1');
      const imgFoot = Buffer.from('\nendstream\nendobj\n', 'latin1');
      objBodies.push(Buffer.concat([imgHead, img.buffer, imgFoot]));
    });

    const totalObjects = objHeaders.length;
    const headerBuf = Buffer.from('%PDF-1.4\n', 'latin1');
    const parts = [headerBuf];
    const offsets = [];
    let currentOffset = headerBuf.length;

    for (let i = 0; i < totalObjects; i++) {
      offsets.push(currentOffset);
      const h = Buffer.from(objHeaders[i], 'latin1');
      const b = objBodies[i];
      parts.push(h);
      parts.push(b);
      currentOffset += h.length + b.length;
    }

    const xrefOffset = currentOffset;
    let xref = `xref\n0 ${totalObjects + 1}\n0000000000 65535 f \n`;
    for (const off of offsets) {
      xref += String(off).padStart(10, '0') + ' 00000 n \n';
    }
    xref += `trailer\n<< /Size ${totalObjects + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
    parts.push(Buffer.from(xref, 'latin1'));

    return Buffer.concat(parts);
  }
}

// Pre-load and cache branding assets
let cachedLogoBuffer = null;
let cachedWatermarkBuffer = null;

function getAssets() {
  if (!cachedLogoBuffer) {
    const candidates = [
      path.join(__dirname, '../../public/logo_300.jpg'),
      path.join(__dirname, '../public/logo_300.jpg'),
      path.join(process.cwd(), 'backend/public/logo_300.jpg')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          cachedLogoBuffer = fs.readFileSync(p);
          break;
        } catch (_) {}
      }
    }
  }

  if (!cachedWatermarkBuffer) {
    const candidates = [
      path.join(__dirname, '../../public/watermark_400.jpg'),
      path.join(__dirname, '../public/watermark_400.jpg'),
      path.join(process.cwd(), 'backend/public/watermark_400.jpg')
    ];
    for (const p of candidates) {
      if (fs.existsSync(p)) {
        try {
          cachedWatermarkBuffer = fs.readFileSync(p);
          break;
        } catch (_) {}
      }
    }
  }

  return { logo: cachedLogoBuffer, watermark: cachedWatermarkBuffer };
}

/**
 * Generates an official branded academic result card PDF Buffer.
 * Matches 1:1 the layout, typography, and structure of the View PDF dashboard.
 */
function generateAcademicResultPdf({
  schoolName = 'UNIQUE SCHOLARS',
  schoolAddress = 'Main Campus | Phone: 03001234567',
  schoolPhone = '',
  termName = 'Mid Term 2026',
  studentId = 'STU-000055',
  studentName = 'Student Name',
  fatherName = '',
  rollNo = '-',
  className = 'Class',
  marks = {},
  totalObtained = 0,
  totalMax = 0,
  percentage = 0,
  grade = 'F',
  passStatus = 'FAIL',
  rank = '-',
  remarks = ''
}) {
  const doc = new PdfDoc(595.28, 841.89);
  const { logo, watermark } = getAssets();

  if (logo) {
    doc.addImage('ImLogo', logo, 300, 300);
  }
  if (watermark) {
    doc.addImage('ImWm', watermark, 400, 400);
  }

  // Refined Color Palette
  const cNavy = [0.06, 0.09, 0.16];       // #0f172a
  const cDark = [0.12, 0.16, 0.23];       // #1e293b
  const cMuted = [0.40, 0.45, 0.55];      // #64748b
  const cLightBg = [0.97, 0.98, 0.99];    // #f8fafc
  const cBorder = [0.80, 0.84, 0.88];     // #cbd5e1
  const cWhite = [1.0, 1.0, 1.0];
  const cGreen = [0.08, 0.50, 0.24];      // #15803d
  const cRed = [0.73, 0.11, 0.11];        // #b91c1c
  const cInnerBorder = [0.39, 0.45, 0.55]; // #64748b

  // 1. Frame Geometry (Outer margin: 35pt)
  const frameX = 35;
  const frameY = 35;
  const frameW = 595.28 - 70; // 525.28
  const frameH = 841.89 - 70; // 771.89

  // Double academic frame
  doc.rect(frameX, frameY, frameW, frameH, cWhite, cNavy, 1.5);
  doc.rect(frameX + 3, frameY + 3, frameW - 6, frameH - 6, null, cInnerBorder, 0.5);

  // 2. Watermark in background
  if (watermark) {
    const wmW = 280;
    const wmH = 280;
    doc.drawImage('ImWm', (595.28 - wmW) / 2, (841.89 - wmH) / 2 - 10, wmW, wmH);
  }

  // 3. Header Section
  const headerTopY = frameY + 26;
  if (logo) {
    const logoW = 56;
    const logoH = 56;
    doc.drawImage('ImLogo', frameX + 22, headerTopY + 2, logoW, logoH);
  }

  doc.text(schoolName.toUpperCase(), frameX, headerTopY, { font: 'F2', size: 21, color: cNavy, align: 'center', width: frameW });

  // Address and Phone
  let fullAddress = String(schoolAddress || 'Main Campus');
  if (schoolPhone && !fullAddress.includes(schoolPhone)) {
    fullAddress += ` | Phone: ${schoolPhone}`;
  } else if (!fullAddress.includes('Phone:') && !fullAddress.includes('Tel:')) {
    fullAddress += ' | Phone: 03001234567';
  }
  doc.text(fullAddress, frameX, headerTopY + 26, { font: 'F1', size: 9.5, color: cMuted, align: 'center', width: frameW });

  // Pill badge: STATEMENT OF MARKS
  const badgeW = 160;
  const badgeH = 18;
  const badgeX = (595.28 - badgeW) / 2;
  const badgeY = headerTopY + 44;
  doc.rect(badgeX, badgeY, badgeW, badgeH, cNavy, null, 0);
  doc.text('STATEMENT OF MARKS', badgeX, badgeY + 4.5, { font: 'F2', size: 9.5, color: cWhite, align: 'center', width: badgeW });

  doc.text(termName, frameX, headerTopY + 68, { font: 'F2', size: 11, color: cDark, align: 'center', width: frameW });

  // Header bottom divider line
  const headerLineY = headerTopY + 86;
  doc.line(frameX + 20, headerLineY, frameX + frameW - 20, headerLineY, cNavy, 1.5);

  // 4. Student Identification Grid
  const infoX = frameX + 20;
  const infoY = headerLineY + 16;
  const infoW = frameW - 40;
  const infoH = 50;

  doc.rect(infoX, infoY, infoW, infoH, cLightBg, [0.88, 0.91, 0.94], 1);

  // Left Column
  doc.text('STUDENT NAME:', infoX + 14, infoY + 11, { font: 'F2', size: 8.5, color: cMuted });
  const displayName = fatherName ? `${studentName} (${fatherName})` : studentName;
  doc.text(displayName, infoX + 115, infoY + 11, { font: 'F2', size: 9.5, color: cNavy });

  doc.text('CLASS & GRADE:', infoX + 14, infoY + 29, { font: 'F2', size: 8.5, color: cMuted });
  doc.text(className, infoX + 115, infoY + 29, { font: 'F2', size: 9.5, color: cNavy });

  // Right Column
  doc.text('ROLL / ID NO:', infoX + 265, infoY + 11, { font: 'F2', size: 8.5, color: cMuted });
  const displayId = (studentId && studentId !== '-') ? studentId : (rollNo || '-');
  doc.text(String(displayId), infoX + 355, infoY + 11, { font: 'F2', size: 9.5, color: cNavy });

  doc.text('EXAMINATION:', infoX + 265, infoY + 29, { font: 'F2', size: 8.5, color: cMuted });
  doc.text(termName, infoX + 355, infoY + 29, { font: 'F2', size: 9.5, color: cNavy });

  // 5. Academic Marks Table
  let tableY = infoY + infoH + 16;
  const tableX = frameX + 20;
  const tableW = frameW - 40;

  const colSubjW = 230;
  const colMaxW = 85;
  const colObtW = 95;
  const colGrdW = tableW - (colSubjW + colMaxW + colObtW);

  // Header Row
  doc.rect(tableX, tableY, tableW, 24, cNavy, cNavy, 1);
  doc.text('SUBJECT DESCRIPTION', tableX + 12, tableY + 7.5, { font: 'F2', size: 8.5, color: cWhite });
  doc.text('MAX MARKS', tableX + colSubjW, tableY + 7.5, { font: 'F2', size: 8.5, color: cWhite, align: 'center', width: colMaxW });
  doc.text('MARKS OBTAINED', tableX + colSubjW + colMaxW, tableY + 7.5, { font: 'F2', size: 8.5, color: cWhite, align: 'center', width: colObtW });
  doc.text('GRADE', tableX + colSubjW + colMaxW + colObtW, tableY + 7.5, { font: 'F2', size: 8.5, color: cWhite, align: 'center', width: colGrdW });
  tableY += 24;

  const entries = Object.entries(marks || {});
  let rowIndex = 0;

  for (const [subjName, sData] of entries) {
    const obt = Number(typeof sData === 'object' ? (sData.obtained !== undefined ? sData.obtained : 0) : sData) || 0;
    const tot = Number(typeof sData === 'object' ? (sData.total !== undefined ? sData.total : 100) : 100) || 100;
    const sPct = tot > 0 ? (obt / tot) * 100 : 0;
    let sGrade = 'F';
    if (sPct >= 85) sGrade = 'A+';
    else if (sPct >= 75) sGrade = 'A';
    else if (sPct >= 65) sGrade = 'B';
    else if (sPct >= 55) sGrade = 'C';
    else if (sPct >= 40) sGrade = 'D';

    const rowBg = (rowIndex % 2 === 1) ? cLightBg : cWhite;
    doc.rect(tableX, tableY, tableW, 22, rowBg, cBorder, 0.75);

    doc.text(subjName, tableX + 12, tableY + 6.5, { font: 'F2', size: 9, color: cNavy });
    doc.text(String(tot), tableX + colSubjW, tableY + 6.5, { font: 'F1', size: 9, color: cDark, align: 'center', width: colMaxW });
    doc.text(String(obt), tableX + colSubjW + colMaxW, tableY + 6.5, { font: 'F1', size: 9.5, color: cDark, align: 'center', width: colObtW });
    doc.text(sGrade, tableX + colSubjW + colMaxW + colObtW, tableY + 6.5, { font: 'F2', size: 9, color: cNavy, align: 'center', width: colGrdW });

    tableY += 22;
    rowIndex++;
  }

  // Grand Total Summary Row
  doc.rect(tableX, tableY, tableW, 24, [0.94, 0.96, 0.98], cNavy, 1.2);
  doc.text('GRAND TOTAL', tableX + 12, tableY + 7.5, { font: 'F2', size: 9.5, color: cNavy });
  doc.text(String(totalMax), tableX + colSubjW, tableY + 7.5, { font: 'F2', size: 9.5, color: cNavy, align: 'center', width: colMaxW });
  doc.text(String(totalObtained), tableX + colSubjW + colMaxW, tableY + 7.5, { font: 'F2', size: 10, color: cNavy, align: 'center', width: colObtW });
  doc.text(String(grade), tableX + colSubjW + colMaxW + colObtW, tableY + 7.5, { font: 'F2', size: 10, color: cNavy, align: 'center', width: colGrdW });
  tableY += 34;

  // 6. Metrics Summary Bar (4 Cards)
  const cardGap = 10;
  const cardW = (tableW - 3 * cardGap) / 4;
  const cardH = 44;

  // Card 1: Total Score
  doc.rect(tableX, tableY, cardW, cardH, cLightBg, [0.88, 0.91, 0.94], 1);
  doc.text('TOTAL SCORE', tableX, tableY + 8, { font: 'F2', size: 7.5, color: cMuted, align: 'center', width: cardW });
  doc.text(`${totalObtained} / ${totalMax}`, tableX, tableY + 22, { font: 'F2', size: 12.5, color: cNavy, align: 'center', width: cardW });

  // Card 2: Percentage
  const c2X = tableX + cardW + cardGap;
  doc.rect(c2X, tableY, cardW, cardH, cLightBg, [0.88, 0.91, 0.94], 1);
  doc.text('PERCENTAGE', c2X, tableY + 8, { font: 'F2', size: 7.5, color: cMuted, align: 'center', width: cardW });
  doc.text(`${Number(percentage || 0).toFixed(0)}%`, c2X, tableY + 22, { font: 'F2', size: 12.5, color: cNavy, align: 'center', width: cardW });

  // Card 3: Final Grade
  const c3X = c2X + cardW + cardGap;
  doc.rect(c3X, tableY, cardW, cardH, cLightBg, [0.88, 0.91, 0.94], 1);
  doc.text('FINAL GRADE', c3X, tableY + 8, { font: 'F2', size: 7.5, color: cMuted, align: 'center', width: cardW });
  doc.text(String(grade), c3X, tableY + 22, { font: 'F2', size: 13, color: cNavy, align: 'center', width: cardW });

  // Card 4: Result Status
  const c4X = c3X + cardW + cardGap;
  const isPassed = passStatus === 'PASS';
  doc.rect(c4X, tableY, cardW, cardH, cLightBg, [0.88, 0.91, 0.94], 1);
  doc.text('RESULT STATUS', c4X, tableY + 8, { font: 'F2', size: 7.5, color: cMuted, align: 'center', width: cardW });

  // Status Badge inside card 4
  const badgeCardW = 54;
  const badgeCardH = 15;
  const badgeCardX = c4X + (cardW - badgeCardW) / 2;
  const badgeCardY = tableY + 22;
  doc.rect(badgeCardX, badgeCardY, badgeCardW, badgeCardH, (isPassed ? [0.86, 0.99, 0.91] : [0.99, 0.89, 0.89]), (isPassed ? [0.73, 0.97, 0.82] : [0.99, 0.79, 0.79]), 1);
  doc.text(passStatus, badgeCardX, badgeCardY + 3.5, { font: 'F2', size: 8.5, color: (isPassed ? cGreen : cRed), align: 'center', width: badgeCardW });

  // 7. Footer: Date & Signatures
  const footerY = frameY + frameH - 58;

  // Date of Issue
  const issueDate = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  doc.text('Date of Issue:', frameX + 20, footerY + 24, { font: 'F1', size: 9, color: cMuted });
  doc.text(issueDate, frameX + 78, footerY + 24, { font: 'F2', size: 9, color: cNavy });

  // Signatures
  const sigW = 110;
  const sig1X = frameX + frameW - 250;
  const sig2X = frameX + frameW - 125;

  doc.line(sig1X, footerY + 16, sig1X + sigW, footerY + 16, cMuted, 1, true);
  doc.text('CLASS TEACHER', sig1X, footerY + 22, { font: 'F2', size: 8, color: cDark, align: 'center', width: sigW });

  doc.line(sig2X, footerY + 16, sig2X + sigW, footerY + 16, cMuted, 1, true);
  doc.text('PRINCIPAL', sig2X, footerY + 22, { font: 'F2', size: 8, color: cDark, align: 'center', width: sigW });

  return doc.toBuffer();
}

module.exports = {
  generateAcademicResultPdf
};
