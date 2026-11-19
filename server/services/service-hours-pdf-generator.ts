import { PDFDocument, rgb, StandardFonts } from 'pdf-lib';
import * as fs from 'fs';
import * as path from 'path';

interface ServiceEntry {
  date: string;
  hours: string;
  description: string;
}

interface ServiceHoursData {
  volunteerName: string;
  serviceEntries: ServiceEntry[];
  approverName: string;
  approverSignature: string;
  approverContact: string;
  totalHours: number;
}

export class ServiceHoursPDFGenerator {
  static async generatePDF(data: ServiceHoursData): Promise<Buffer> {
    // Load the existing PDF template
    const templatePath = path.join(
      process.cwd(),
      'client/public/documents',
      'community-service-hours.pdf'
    );

    if (!fs.existsSync(templatePath)) {
      throw new Error(`PDF template file not found at path: ${templatePath}. Please ensure the template exists.`);
    }

    const existingPdfBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(existingPdfBytes);

    // Get the first page
    const pages = pdfDoc.getPages();
    const firstPage = pages[0];
    const { width, height } = firstPage.getSize();

    console.log(`PDF Page dimensions: width=${width}, height=${height}`);

    // Embed fonts
    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const fontBold = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

    // VOLUNTEER NAME field - positioned after "VOLUNTEER NAME:" text
    firstPage.drawText(data.volunteerName, {
      x: 258,
      y: height - 245,
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    // Service entries table coordinates
    // The table has 6 rows and 2 main columns (left and right)
    // Each main column has: DATE | HOURS | DESCRIPTION

    // Left column X positions
    const leftColX = {
      date: 125,        // DATE column start (moved left from 132)
      hours: 165,       // HOURS column start
      description: 205  // DESCRIPTION column start (moved left from 215)
    };

    // Right column X positions
    const rightColX = {
      date: 340,        // DATE column start (moved left from 347)
      hours: 380,       // HOURS column start
      description: 420  // DESCRIPTION column start (moved left from 430)
    };

    // Starting Y position for first table row
    let currentY = height - 350;  // Moved down from 345
    const rowHeight = 18.5;

    // Format date helper
    const formatDate = (dateStr: string) => {
      if (!dateStr) return '';
      const date = new Date(dateStr);
      if (isNaN(date.getTime())) return '';
      return `${(date.getMonth() + 1).toString().padStart(2, '0')}/${date.getDate().toString().padStart(2, '0')}/${date.getFullYear()}`;
    };

    // Draw service entries (2 columns)
    for (let i = 0; i < data.serviceEntries.length; i++) {
      const entry = data.serviceEntries[i];
      const isLeftColumn = i % 2 === 0;
      const colX = isLeftColumn ? leftColX : rightColX;

      // Move Y down only when starting a new row (after both columns are filled)
      if (i > 0 && i % 2 === 0) {
        currentY -= rowHeight;
      }

      // Stop if we run out of space (12 entries maximum: 6 rows × 2 columns)
      if (i >= 12) break;

      // Draw date
      firstPage.drawText(formatDate(entry.date), {
        x: colX.date,
        y: currentY,
        size: 8,
        font: font,
        color: rgb(0, 0, 0),
      });

      // Draw hours
      firstPage.drawText(entry.hours.toString(), {
        x: colX.hours,
        y: currentY,
        size: 8,
        font: font,
        color: rgb(0, 0, 0),
      });

      // Draw description with wrapping
      const description = entry.description;
      const maxWidth = 100; // Maximum width in points for description
      const words = description.split(' ');
      let line = '';
      let lineY = currentY;

      for (let j = 0; j < words.length; j++) {
        const testLine = line + (line ? ' ' : '') + words[j];
        const testWidth = font.widthOfTextAtSize(testLine, 8);

        if (testWidth > maxWidth && line) {
          // Draw current line and move to next
          firstPage.drawText(line, {
            x: colX.description,
            y: lineY,
            size: 8,
            font: font,
            color: rgb(0, 0, 0),
          });
          line = words[j];
          lineY -= 9; // Move down for next line (slightly less than rowHeight)
        } else {
          line = testLine;
        }
      }

      // Draw remaining text
      if (line) {
        firstPage.drawText(line, {
          x: colX.description,
          y: lineY,
          size: 8,
          font: font,
          color: rgb(0, 0, 0),
        });
      }
    }

    // TOTAL COMMUNITY SERVICE HOURS COMPLETED field
    firstPage.drawText(data.totalHours.toString(), {
      x: 478,
      y: height - 445,
      size: 10,
      font: fontBold,
      color: rgb(0, 0, 0),
    });

    // Current date for TSP approval
    const currentDate = new Date().toLocaleDateString('en-US');

    // TSP Approval Section

    // Signature line (after "Signature:")
    if (data.approverSignature) {
      firstPage.drawText(data.approverSignature, {
        x: 185,
        y: height - 585,  // Moved down from 580 (was too high)
        size: 11,
        font: font,
        color: rgb(0, 0, 0),
      });
    }

    // Print Name (after "Print Name:")
    firstPage.drawText(data.approverName, {
      x: 185,
      y: height - 610,  // Moved down from 605 (was too high)
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    // Date (to the right of Print Name)
    firstPage.drawText(currentDate, {
      x: 480,
      y: height - 610,  // Match print name Y position
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    // Contact # (after "Contact #:")
    firstPage.drawText(data.approverContact, {
      x: 210,           // Moved left from 220
      y: height - 630,  // Perfect height, just adjusted X
      size: 10,
      font: font,
      color: rgb(0, 0, 0),
    });

    // Save the modified PDF
    const pdfBytes = await pdfDoc.save();
    return Buffer.from(pdfBytes);
  }
}
