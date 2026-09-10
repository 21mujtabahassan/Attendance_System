/**
 * High-performance, zero-dependency PDF Generator for Official Student Result Cards.
 * Produces standard-compliant, vector-sharp A4 PDF documents ready for WhatsApp delivery and print.
 */

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
    const contentLen = Buffer.byteLength(content, 'latin1');

    const objects = [];
    objects.push('1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj');
    objects.push('2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj');
    objects.push(`3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${this.width} ${this.height}] /Contents 4 0 R /Resources << /Font << /F1 5 0 R /F2 6 0 R /F3 7 0 R >> >> >>\nendobj`);
    objects.push(`4 0 obj\n<< /Length ${contentLen} >>\nstream\n${content}\nendstream\nendobj`);
    objects.push('5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj');
    objects.push('6 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>\nendobj');
    objects.push('7 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Oblique >>\nendobj');

    let body = '%PDF-1.4\n';
    const offsets = [];
    for (const obj of objects) {
      offsets.push(Buffer.byteLength(body, 'latin1'));
      body += obj + '\n';
    }

    const xrefOffset = Buffer.byteLength(body, 'latin1');
    body += 'xref\n';
    body += `0 ${objects.length + 1}\n`;
    body += '0000000000 65535 f \n';
    for (const offset of offsets) {
      body += String(offset).padStart(10, '0') + ' 00000 n \n';
    }
    body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\n`;
    body += `startxref\n${xrefOffset}\n%%EOF\n`;

    return Buffer.from(body, 'latin1');
  }
}

/**
 * Generates an official branded academic result card PDF Buffer.
 */
function generateAcademicResultPdf({
  schoolName = 'UNIQUE SCHOLARS ACADEMY',
  schoolAddress = 'Main Campus, Phalia Road | Tel: 0315-5889902',
  termName = 'Mid Term 2026',
  studentId = 'STU-000005',
  studentName = 'Student Name',
  rollNo = '-',
  className = 'Class Play',
  marks = {},
  totalObtained = 0,
  totalMax = 0,
  percentage = 0,
  grade = 'F',
  passStatus = 'FAIL',
  rank = '-',
  remarks = 'Result Finalized & Announced.'
}) {
  const doc = new PdfDoc(595.28, 841.89);

  // Palette definition
  const cNavy = [0.06, 0.09, 0.16];       // #0f172a
  const cDark = [0.12, 0.16, 0.23];       // #1e293b
  const cGold = [0.77, 0.65, 0.42];       // #c5a86a
  const cMuted = [0.40, 0.45, 0.55];      // #64748b
  const cLightBg = [0.96, 0.97, 0.98];    // #f8fafc
  const cBorder = [0.80, 0.84, 0.88];     // #cbd5e1
  const cWhite = [1.0, 1.0, 1.0];
  const cGreen = [0.08, 0.50, 0.24];      // #15803d
  const cRed = [0.73, 0.11, 0.11];        // #b91c1c
  const cSky = [0.01, 0.52, 0.78];        // #0284c7

  // 1. Page Background & Formal Double Outer Border
  doc.rect(15, 15, 565.28, 811.89, cWhite, cNavy, 2.5);
  doc.rect(20, 20, 555.28, 801.89, null, cGold, 1.0);

  // 2. School Header Banner
  doc.rect(21, 21, 553.28, 90, cNavy, null, 0);
  doc.rect(21, 111, 553.28, 3, cGold, null, 0);

  doc.text(schoolName.toUpperCase(), 35, 36, { font: 'F2', size: 19, color: cWhite, align: 'center', width: 525 });
  doc.text(schoolAddress, 35, 62, { font: 'F1', size: 9.5, color: [0.85, 0.88, 0.92], align: 'center', width: 525 });
  doc.text('OFFICIAL ACADEMIC RESULT STATEMENT', 35, 82, { font: 'F2', size: 11, color: cGold, align: 'center', width: 525 });

  // 3. Student Identification Card
  const infoY = 126;
  doc.rect(35, infoY, 525.28, 70, cLightBg, cBorder, 1);

  // Column 1
  doc.text('STUDENT NAME:', 48, infoY + 12, { font: 'F2', size: 9, color: cMuted });
  doc.text(studentName.toUpperCase(), 145, infoY + 12, { font: 'F2', size: 10.5, color: cNavy });

  doc.text('ROLL NUMBER:', 48, infoY + 30, { font: 'F2', size: 9, color: cMuted });
  doc.text(String(rollNo || '-'), 145, infoY + 30, { font: 'F2', size: 10, color: cDark });

  doc.text('STUDENT ID:', 48, infoY + 48, { font: 'F2', size: 9, color: cMuted });
  doc.text(String(studentId || '-'), 145, infoY + 48, { font: 'F1', size: 9.5, color: cDark });

  // Vertical separator in info card
  doc.line(310, infoY + 8, 310, infoY + 62, cBorder, 1);

  // Column 2
  doc.text('CLASS / GRADE:', 325, infoY + 12, { font: 'F2', size: 9, color: cMuted });
  doc.text(className, 420, infoY + 12, { font: 'F2', size: 10.5, color: cNavy });

  doc.text('EXAMINATION:', 325, infoY + 30, { font: 'F2', size: 9, color: cMuted });
  doc.text(termName, 420, infoY + 30, { font: 'F2', size: 10, color: cDark });

  doc.text('ISSUE DATE:', 325, infoY + 48, { font: 'F2', size: 9, color: cMuted });
  const dateStr = new Date().toLocaleDateString('en-PK', { day: '2-digit', month: 'short', year: 'numeric' });
  doc.text(dateStr, 420, infoY + 48, { font: 'F1', size: 9.5, color: cDark });

  // 4. Academic Marks Table
  let tableY = 210;
  const colSubjX = 35;
  const colSubjW = 215.28;
  const colMaxX = 250.28;
  const colMaxW = 75;
  const colObtX = 325.28;
  const colObtW = 80;
  const colPctX = 405.28;
  const colPctW = 70;
  const colGrdX = 475.28;
  const colGrdW = 85;

  // Table Header Row
  doc.rect(35, tableY, 525.28, 24, cDark, cNavy, 1);
  doc.text('SUBJECT', colSubjX + 10, tableY + 7, { font: 'F2', size: 9.5, color: cWhite });
  doc.text('MAX MARKS', colMaxX, tableY + 7, { font: 'F2', size: 9, color: cWhite, align: 'center', width: colMaxW });
  doc.text('OBTAINED', colObtX, tableY + 7, { font: 'F2', size: 9, color: cWhite, align: 'center', width: colObtW });
  doc.text('PERCENTAGE', colPctX, tableY + 7, { font: 'F2', size: 9, color: cWhite, align: 'center', width: colPctW });
  doc.text('GRADE', colGrdX, tableY + 7, { font: 'F2', size: 9, color: cWhite, align: 'center', width: colGrdW });
  tableY += 24;

  const entries = Object.entries(marks || {});
  let rowIndex = 0;

  for (const [subjName, sData] of entries) {
    const obt = Number(typeof sData === 'object' ? (sData.obtained !== undefined ? sData.obtained : 0) : sData) || 0;
    const tot = Number(typeof sData === 'object' ? (sData.total !== undefined ? sData.total : 100) : 100) || 100;
    const sPct = tot > 0 ? ((obt / tot) * 100).toFixed(1) : '0.0';
    let sGrade = 'F';
    const numPct = Number(sPct);
    if (numPct >= 85) sGrade = 'A+';
    else if (numPct >= 75) sGrade = 'A';
    else if (numPct >= 65) sGrade = 'B';
    else if (numPct >= 55) sGrade = 'C';
    else if (numPct >= 40) sGrade = 'D';

    const rowBg = (rowIndex % 2 === 1) ? cLightBg : cWhite;
    doc.rect(35, tableY, 525.28, 22, rowBg, cBorder, 0.75);

    doc.text(subjName, colSubjX + 10, tableY + 6, { font: 'F2', size: 9.5, color: cNavy });
    doc.text(String(tot), colMaxX, tableY + 6, { font: 'F1', size: 9.5, color: cDark, align: 'center', width: colMaxW });
    doc.text(String(obt), colObtX, tableY + 6, { font: 'F2', size: 10, color: cSky, align: 'center', width: colObtW });
    doc.text(`${sPct}%`, colPctX, tableY + 6, { font: 'F1', size: 9.5, color: cDark, align: 'center', width: colPctW });
    doc.text(sGrade, colGrdX, tableY + 6, { font: 'F2', size: 9.5, color: cNavy, align: 'center', width: colGrdW });

    tableY += 22;
    rowIndex++;
  }

  // Summary Row
  doc.rect(35, tableY, 525.28, 24, [0.93, 0.95, 0.98], cNavy, 1.2);
  doc.text('GRAND TOTAL', colSubjX + 10, tableY + 7, { font: 'F2', size: 10, color: cNavy });
  doc.text(String(totalMax), colMaxX, tableY + 7, { font: 'F2', size: 10, color: cNavy, align: 'center', width: colMaxW });
  doc.text(String(totalObtained), colObtX, tableY + 7, { font: 'F2', size: 11, color: cNavy, align: 'center', width: colObtW });
  doc.text(`${Number(percentage || 0).toFixed(1)}%`, colPctX, tableY + 7, { font: 'F2', size: 10, color: cNavy, align: 'center', width: colPctW });
  doc.text(String(grade), colGrdX, tableY + 7, { font: 'F2', size: 11, color: (passStatus === 'PASS' ? cGreen : cRed), align: 'center', width: colGrdW });
  tableY += 34;

  // 5. Performance Summary Dashboard Cards
  const cardW = 120;
  const cardH = 50;
  const cardGap = 15;
  const cardsStartX = 35;

  // Card 1: Total Marks
  doc.rect(cardsStartX, tableY, cardW, cardH, cLightBg, cBorder, 1);
  doc.text('TOTAL OBTAINED', cardsStartX, tableY + 8, { font: 'F2', size: 8, color: cMuted, align: 'center', width: cardW });
  doc.text(`${totalObtained} / ${totalMax}`, cardsStartX, tableY + 24, { font: 'F2', size: 13, color: cNavy, align: 'center', width: cardW });

  // Card 2: Percentage
  const c2X = cardsStartX + cardW + cardGap;
  doc.rect(c2X, tableY, cardW, cardH, cLightBg, cBorder, 1);
  doc.text('PERCENTAGE', c2X, tableY + 8, { font: 'F2', size: 8, color: cMuted, align: 'center', width: cardW });
  doc.text(`${Number(percentage || 0).toFixed(1)}%`, c2X, tableY + 24, { font: 'F2', size: 13, color: cNavy, align: 'center', width: cardW });

  // Card 3: Final Grade
  const c3X = c2X + cardW + cardGap;
  doc.rect(c3X, tableY, cardW, cardH, cLightBg, cBorder, 1);
  doc.text('FINAL GRADE', c3X, tableY + 8, { font: 'F2', size: 8, color: cMuted, align: 'center', width: cardW });
  doc.text(String(grade), c3X, tableY + 24, { font: 'F2', size: 14, color: (passStatus === 'PASS' ? cGreen : cRed), align: 'center', width: cardW });

  // Card 4: Status / Rank
  const c4X = c3X + cardW + cardGap;
  const isPassed = passStatus === 'PASS';
  doc.rect(c4X, tableY, cardW, cardH, (isPassed ? [0.94, 0.99, 0.95] : [0.99, 0.94, 0.94]), (isPassed ? [0.73, 0.94, 0.82] : [0.97, 0.79, 0.79]), 1);
  doc.text('RESULT STATUS', c4X, tableY + 8, { font: 'F2', size: 8, color: (isPassed ? cGreen : cRed), align: 'center', width: cardW });
  doc.text(`${passStatus}${rank && rank !== '-' ? `  (#${rank})` : ''}`, c4X, tableY + 24, { font: 'F2', size: 12, color: (isPassed ? cGreen : cRed), align: 'center', width: cardW });

  tableY += cardH + 18;

  // 6. Teacher / Administrative Remarks
  doc.rect(35, tableY, 525.28, 42, cLightBg, cBorder, 1);
  doc.text('TEACHER REMARKS:', 48, tableY + 10, { font: 'F2', size: 8.5, color: cMuted });
  doc.text(`"${remarks || 'Result Finalized & Announced.'}"`, 48, tableY + 24, { font: 'F3', size: 10, color: cNavy });

  // 7. Signature & Official Seal Section
  const sigY = 700;
  const sigLineW = 140;

  // Signature 1: Class Teacher
  doc.line(45, sigY + 28, 45 + sigLineW, sigY + 28, cMuted, 1, true);
  doc.text('CLASS TEACHER', 45, sigY + 34, { font: 'F2', size: 8.5, color: cDark, align: 'center', width: sigLineW });

  // Seal in center
  doc.rect(238, sigY - 10, 120, 52, [0.97, 0.98, 1.0], cGold, 1.2);
  doc.text('OFFICIAL SEAL', 238, sigY + 6, { font: 'F2', size: 8, color: cGold, align: 'center', width: 120 });
  doc.text('UNIQUE SCHOLARS', 238, sigY + 20, { font: 'F2', size: 7.5, color: cNavy, align: 'center', width: 120 });
  doc.text('VERIFIED & LOCKED', 238, sigY + 32, { font: 'F1', size: 6.5, color: cMuted, align: 'center', width: 120 });

  // Signature 2: Principal
  doc.line(405, sigY + 28, 405 + sigLineW, sigY + 28, cMuted, 1, true);
  doc.text('PRINCIPAL / HEADMASTER', 405, sigY + 34, { font: 'F2', size: 8.5, color: cDark, align: 'center', width: sigLineW });

  // 8. Footer Note
  doc.line(35, 780, 560.28, 780, cBorder, 0.75);
  doc.text('This is a computer-generated official examination marksheet issued by Unique Scholars Academy. No manual signature required.', 35, 792, { font: 'F1', size: 7.5, color: cMuted, align: 'center', width: 525 });

  return doc.toBuffer();
}

module.exports = {
  generateAcademicResultPdf
};
