import PDFDocument from 'pdfkit';
import type { Meeting, CompiledAgenda } from '@shared/schema';

export async function generateMeetingMinutesPDF(
  meeting: Meeting,
  compiledAgenda?: CompiledAgenda
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 0,
      layout: 'portrait',
    });
    const chunks: Buffer[] = [];

    doc.on('data', (chunk) => chunks.push(chunk));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', (error: any) => reject(error));

    // TSP Brand Colors
    const colors = {
      navy: '#236383',
      lightBlue: '#47B3CB',
      orange: '#FBAD3F',
      red: '#A31C41',
      teal: '#236383',
      darkGray: '#333333',
      lightGray: '#666666',
      white: '#FFFFFF',
      sectionBlue: '#E3F2FD',
      dividerGray: '#CCCCCC',
      lightOrange: '#FEF4E0',
      lightRed: '#FCE4E6',
      lightTeal: '#E0F2F1',
      lightNavy: '#E8F4F8',
      lightBlueBg: '#E3F2FD',
    };

    let yPosition = 0;
    const pageWidth = 595.28; // A4 width
    const pageHeight = 841.89; // A4 height
    const margin = 50;
    const contentWidth = pageWidth - margin * 2;

    // Helper function to sanitize text for PDF rendering
    const sanitizeText = (text: string): string => {
      if (!text) return '';

      return text
        .replace(/[\u2018\u2019]/g, "'")
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2013\u2014]/g, '-')
        .replace(/[\u2022\u2023\u25E6]/g, '•')
        .replace(/[\u2026]/g, '...')
        .replace(/[\u00A0]/g, ' ')
        .replace(/[^\x00-\x7F]/g, '');
    };

    // Helper function to check if we need a new page
    const ensureSpace = (requiredSpace: number) => {
      if (yPosition + requiredSpace > pageHeight - 150) {
        doc.addPage();
        yPosition = 80; // Start with more margin from top
      }
    };

    // Helper function to add text with proper positioning and wrapping
    const addText = (text: string, x: number, y: number, options: any = {}) => {
      const sanitizedText = sanitizeText(text);

      // Apply font size and color before adding text
      if (options.fontSize) {
        doc.fontSize(options.fontSize);
      }
      if (options.fillColor) {
        doc.fillColor(options.fillColor);
      }

      // Ensure text wraps properly within content width
      const textOptions = {
        ...options,
        width: options.width || contentWidth,
        align: options.align || 'left',
      };

      doc.text(sanitizedText, x, y, textOptions);
    };

    // Helper function to add divider line with proper spacing
    const addDivider = (color: string, thickness: number = 1) => {
      yPosition += 15; // Increased space before divider
      doc.rect(margin, yPosition, contentWidth, thickness).fill(color);
      yPosition += thickness + 15; // Increased space after divider
    };

    // Helper function to add colored background section with text
    const addColoredSection = (
      text: string,
      backgroundColor: string,
      textColor: string,
      fontSize: number = 11
    ) => {
      const sectionHeight = 22; // Fixed height for colored sections

      // Add colored background
      doc
        .rect(margin - 5, yPosition, contentWidth + 10, sectionHeight)
        .fill(backgroundColor);

      // Add text with proper vertical centering
      addText(text, margin, yPosition + 4, {
        fontSize: fontSize,
        fillColor: textColor,
        width: contentWidth,
      });

      // Move y-position past the colored section
      yPosition += sectionHeight + 8; // 8px spacing after colored section
    };

    // Helper function to add header bar
    const addHeaderBar = (color: string, height: number) => {
      doc.rect(0, yPosition, pageWidth, height).fill(color);
      yPosition += height + 5; // Add extra space after header bars
    };

    // Main header section
    addHeaderBar(colors.navy, 80);

    // Add "The Sandwich Project" title
    doc
      .fontSize(24)
      .fillColor(colors.white)
      .text('The Sandwich Project', margin, yPosition - 60, {
        width: contentWidth,
      });

    // Add "Meeting Minutes" in orange
    doc
      .fontSize(20)
      .fillColor(colors.orange)
      .text('Meeting Minutes', margin, yPosition - 35, { width: contentWidth });

    // Add meeting date and time
    const meetingDate = new Date(meeting.date).toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
    doc
      .fontSize(14)
      .fillColor(colors.white)
      .text(`${meetingDate} at ${meeting.time}`, margin, yPosition - 15, {
        width: contentWidth,
      });

    yPosition = 100; // Move past header

    // Meeting Details Section
    ensureSpace(100);
    yPosition += 10;

    // Meeting title with colored background
    addColoredSection(meeting.title, colors.navy, colors.white, 16);

    // Meeting metadata
    if (meeting.type) {
      addText('Type: ', margin, yPosition, {
        fontSize: 11,
        fillColor: colors.navy,
        width: 80,
      });
      addText(meeting.type.replace(/_/g, ' ').toUpperCase(), margin + 80, yPosition, {
        fontSize: 11,
        fillColor: colors.teal,
        width: contentWidth - 80,
      });
      yPosition += 20;
    }

    if (meeting.location) {
      addText('Location: ', margin, yPosition, {
        fontSize: 11,
        fillColor: colors.navy,
        width: 80,
      });
      addText(meeting.location, margin + 80, yPosition, {
        fontSize: 11,
        fillColor: colors.lightGray,
        width: contentWidth - 80,
      });
      yPosition += 20;
    }

    if (meeting.status) {
      addText('Status: ', margin, yPosition, {
        fontSize: 11,
        fillColor: colors.navy,
        width: 80,
      });
      const statusColor =
        meeting.status === 'completed'
          ? colors.teal
          : meeting.status === 'agenda_set'
          ? colors.orange
          : colors.lightGray;
      addText(meeting.status.replace(/_/g, ' ').toUpperCase(), margin + 80, yPosition, {
        fontSize: 11,
        fillColor: statusColor,
        width: contentWidth - 80,
      });
      yPosition += 20;
    }

    yPosition += 10;
    addDivider(colors.navy);

    // Meeting Description
    if (meeting.description) {
      ensureSpace(80);
      addColoredSection('Meeting Description', colors.lightNavy, colors.navy, 12);

      addText(meeting.description, margin + 10, yPosition, {
        fontSize: 10,
        fillColor: colors.darkGray,
        width: contentWidth - 20,
      });
      yPosition += 40;

      addDivider(colors.teal);
    }

    // Compiled Agenda Section
    if (compiledAgenda && compiledAgenda.sections) {
      ensureSpace(80);
      addColoredSection('Meeting Agenda', colors.navy, colors.white, 14);

      const sections = compiledAgenda.sections as any[];

      sections.forEach((section: any, sectionIndex: number) => {
        ensureSpace(80);

        // Section header
        yPosition += 10;
        const sectionColors = [
          colors.navy,
          colors.teal,
          colors.orange,
          colors.red,
          colors.lightBlue,
        ];
        const sectionColor = sectionColors[sectionIndex % sectionColors.length];

        addHeaderBar(sectionColor, 35);
        addText(`${sectionIndex + 1}. ${section.title}`, margin, yPosition - 25, {
          fontSize: 16,
          fillColor: colors.white,
          width: contentWidth,
        });

        yPosition += 15;

        // Section items
        if (section.items && section.items.length > 0) {
          section.items.forEach((item: any, itemIndex: number) => {
            const currentY = yPosition;
            ensureSpace(120);

            // Add section context if we're on a new page
            if (yPosition !== currentY) {
              addColoredSection(
                `Continued from ${sectionIndex + 1}. ${section.title}`,
                colors.lightBlue,
                colors.navy,
                10
              );
              yPosition += 10;
            }

            // Add space before item
            yPosition += 10;

            // Item title with bold colored background
            const itemColors = [
              colors.orange,
              colors.red,
              colors.teal,
              colors.navy,
              colors.lightBlue,
            ];
            const itemColor = itemColors[itemIndex % itemColors.length];

            addColoredSection(
              `${sectionIndex + 1}.${itemIndex + 1} ${item.title}`,
              itemColor,
              colors.darkGray,
              12
            );

            // Add colored divider line
            const dividerColors = [
              colors.orange,
              colors.red,
              colors.teal,
              colors.navy,
              colors.lightBlue,
            ];
            const dividerColor = dividerColors[itemIndex % dividerColors.length];
            addDivider(dividerColor);

            // If this is a project item, show detailed project information
            if (item.project) {
              const project = item.project;

              // Project metadata
              if (project.assigneeName) {
                addText('Owner: ', margin, yPosition, {
                  fontSize: 11,
                  fillColor: colors.navy,
                  width: 60,
                });
                addText(project.assigneeName, margin + 60, yPosition, {
                  fontSize: 11,
                  fillColor: colors.teal,
                  width: contentWidth - 60,
                });
                yPosition += 15;
              }

              if (project.status) {
                addText('Status: ', margin, yPosition, {
                  fontSize: 11,
                  fillColor: colors.navy,
                  width: 60,
                });
                const statusColor =
                  project.status === 'in_progress'
                    ? colors.orange
                    : project.status === 'completed'
                    ? colors.teal
                    : colors.lightGray;
                addText(project.status, margin + 60, yPosition, {
                  fontSize: 11,
                  fillColor: statusColor,
                  width: contentWidth - 60,
                });
                yPosition += 15;
              }

              if (project.supportPeople) {
                addText('Support: ', margin, yPosition, {
                  fontSize: 11,
                  fillColor: colors.navy,
                  width: 60,
                });
                addText(project.supportPeople, margin + 60, yPosition, {
                  fontSize: 11,
                  fillColor: colors.lightBlue,
                  width: contentWidth - 60,
                });
                yPosition += 15;
              }

              if (project.priority) {
                addText('Priority: ', margin, yPosition, {
                  fontSize: 11,
                  fillColor: colors.navy,
                  width: 60,
                });
                const priorityColor =
                  project.priority === 'high'
                    ? colors.red
                    : project.priority === 'medium'
                    ? colors.orange
                    : colors.teal;
                addText(project.priority, margin + 60, yPosition, {
                  fontSize: 11,
                  fillColor: priorityColor,
                  width: contentWidth - 60,
                });
                yPosition += 15;
              }

              yPosition += 5;
              addDivider(colors.orange);

              // Discussion Points
              if (project.meetingDiscussionPoints) {
                const headerSpace = 40;
                const contentSpace = 50;
                const totalSpace = headerSpace + contentSpace;

                if (yPosition + totalSpace > pageHeight - 150) {
                  doc.addPage();
                  yPosition = 80;
                }

                addColoredSection(
                  'Discussion Points',
                  colors.lightOrange,
                  colors.orange,
                  11
                );

                addText(project.meetingDiscussionPoints, margin + 10, yPosition, {
                  fontSize: 10,
                  fillColor: colors.darkGray,
                  width: contentWidth - 20,
                });
                yPosition += 30;
              }

              addDivider(colors.teal);

              // Decision Items
              if (project.meetingDecisionItems) {
                const headerSpace = 40;
                const contentSpace = 50;
                const totalSpace = headerSpace + contentSpace;

                if (yPosition + totalSpace > pageHeight - 150) {
                  doc.addPage();
                  yPosition = 80;
                }

                addColoredSection(
                  'Decision Items',
                  colors.lightRed,
                  colors.red,
                  11
                );

                addText(project.meetingDecisionItems, margin + 10, yPosition, {
                  fontSize: 10,
                  fillColor: colors.darkGray,
                  width: contentWidth - 20,
                });
                yPosition += 30;
              }

              // Project Description
              if (project.description) {
                addDivider(colors.navy);

                const headerSpace = 40;
                const contentSpace = 50;
                const totalSpace = headerSpace + contentSpace;

                if (yPosition + totalSpace > pageHeight - 150) {
                  doc.addPage();
                  yPosition = 80;
                }

                addColoredSection(
                  'Project Description',
                  colors.lightNavy,
                  colors.navy,
                  11
                );

                addText(project.description, margin + 10, yPosition, {
                  fontSize: 10,
                  fillColor: colors.darkGray,
                  width: contentWidth - 20,
                });
                yPosition += 30;
              }

              // Tasks
              if (project.tasks && project.tasks.length > 0) {
                addDivider(colors.lightBlue);

                const headerSpace = 40;
                const contentSpace = 50;
                const totalSpace = headerSpace + contentSpace;

                if (yPosition + totalSpace > pageHeight - 150) {
                  doc.addPage();
                  yPosition = 80;
                }

                addColoredSection('Tasks', colors.lightTeal, colors.teal, 11);

                project.tasks.forEach((task: any, taskIndex: number) => {
                  ensureSpace(30);

                  const taskText = `${taskIndex + 1}. ${task.title || task.description || 'Untitled task'}`;
                  addText(taskText, margin + 10, yPosition, {
                    fontSize: 10,
                    fillColor: colors.darkGray,
                    width: contentWidth - 20,
                  });
                  yPosition += 20;
                });

                yPosition += 10;
              }
            } else if (item.description) {
              // Regular agenda item with description
              addText(item.description, margin + 10, yPosition, {
                fontSize: 10,
                fillColor: colors.darkGray,
                width: contentWidth - 20,
              });
              yPosition += 30;
            }

            yPosition += 10;
          });
        }
      });
    }

    // Final Agenda (if no compiled agenda exists)
    if (!compiledAgenda && meeting.finalAgenda) {
      ensureSpace(80);
      addColoredSection('Final Agenda', colors.navy, colors.white, 14);

      addText(meeting.finalAgenda, margin + 10, yPosition, {
        fontSize: 10,
        fillColor: colors.darkGray,
        width: contentWidth - 20,
      });
      yPosition += 40;
    }

    // Footer section
    ensureSpace(60);
    yPosition = pageHeight - 60;

    // Add footer divider
    doc.rect(margin, yPosition, contentWidth, 1).fill(colors.navy);
    yPosition += 10;

    // Add footer text
    doc
      .fontSize(8)
      .fillColor(colors.lightGray)
      .text(
        `Generated on ${new Date().toLocaleDateString('en-US')} | The Sandwich Project`,
        margin,
        yPosition,
        {
          width: contentWidth,
          align: 'center',
        }
      );

    doc.end();
  });
}
