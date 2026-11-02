import { useState, useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Loader2, Download, TrendingUp, Info, FileText, BarChart3 } from 'lucide-react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

interface LocationBreakdown {
  location: string;
  individual: number;
  groupTotal: number;
  groupEventCount: number;
}

interface SandwichTypeBreakdown {
  deli: number;
  turkey: number;
  ham: number;
  pbj: number;
  generic: number;
}

interface WeeklyData {
  weekStartDate: string;
  weekEndDate: string;
  collectionCount: number;
  totalSandwiches: number;
  individual: number;
  groupCollections: number;
  locationBreakdowns: LocationBreakdown[];
  sandwichTypes: SandwichTypeBreakdown;
}

interface WeeklyReportResponse {
  startDate: string;
  endDate: string;
  weeks: WeeklyData[];
  totalWeeks: number;
  grandTotal: number;
  grandTotalSandwichTypes: SandwichTypeBreakdown;
}

export default function WeeklyCollectionsReport() {
  const [startDate, setStartDate] = useState(() => {
    // Default to 3 months ago
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split('T')[0];
  });
  
  const [endDate, setEndDate] = useState(() => {
    // Default to today
    return new Date().toISOString().split('T')[0];
  });

  const [showChart, setShowChart] = useState(true);
  const [useExactDates, setUseExactDates] = useState(false);

  const { data, isLoading, error, refetch } = useQuery<WeeklyReportResponse>({
    queryKey: ['/api/reports/weekly-collections', startDate, endDate, useExactDates],
    queryFn: async () => {
      const response = await fetch(
        `/api/reports/weekly-collections?startDate=${startDate}&endDate=${endDate}&exactDates=${useExactDates}`
      );
      if (!response.ok) throw new Error('Failed to fetch weekly data');
      return response.json();
    },
    enabled: false,
  });

  // Track if report has been generated at least once
  const hasGeneratedReport = useRef(false);

  // Auto-refetch when useExactDates changes (if report has been generated)
  useEffect(() => {
    if (hasGeneratedReport.current && !isLoading) {
      refetch();
    }
  }, [useExactDates]);

  const handleGenerate = () => {
    hasGeneratedReport.current = true;
    refetch();
  };

  const handleDownloadCSV = () => {
    if (!data?.weeks) return;

    const rows: (string | number)[][] = [];

    // SECTION 1: Weekly Summary
    rows.push(['=== WEEKLY SUMMARY ===']);
    rows.push(['Week Starting', 'Week Ending', 'Collections', 'Individual', 'Group Collections', 'Total Sandwiches']);
    data.weeks.forEach((week) => {
      rows.push([
        week.weekStartDate,
        week.weekEndDate,
        week.collectionCount,
        week.individual,
        week.groupCollections,
        week.totalSandwiches,
      ]);
    });
    rows.push(['Total', '', data.weeks.length, '', '', data.grandTotal]);
    rows.push([]);

    // SECTION 2: Location Breakdowns by Week
    rows.push(['=== LOCATION BREAKDOWNS BY WEEK ===']);
    rows.push([]);

    data.weeks.forEach((week) => {
      rows.push([`Week: ${week.weekStartDate} to ${week.weekEndDate}`]);
      rows.push(['Location', 'Individual', 'Group Total', '# Group Events', 'Location Total']);

      if (week.locationBreakdowns && week.locationBreakdowns.length > 0) {
        week.locationBreakdowns.forEach((loc) => {
          rows.push([
            loc.location,
            loc.individual,
            loc.groupTotal,
            loc.groupEventCount,
            loc.individual + loc.groupTotal,
          ]);
        });
        // Week subtotal
        const weekIndividualTotal = week.locationBreakdowns.reduce((sum, loc) => sum + loc.individual, 0);
        const weekGroupTotal = week.locationBreakdowns.reduce((sum, loc) => sum + loc.groupTotal, 0);
        const weekGroupEvents = week.locationBreakdowns.reduce((sum, loc) => sum + loc.groupEventCount, 0);
        rows.push(['Week Total', weekIndividualTotal, weekGroupTotal, weekGroupEvents, week.totalSandwiches]);
      } else {
        rows.push(['No location data available']);
      }
      rows.push([]);
    });

    // SECTION 3: Location Summary (totals across all weeks)
    rows.push(['=== LOCATION TOTALS (ALL WEEKS) ===']);
    rows.push(['Location', 'Total Individual', 'Total Group', 'Total Group Events', 'Grand Total']);

    // Aggregate location data across all weeks
    const locationTotals = new Map<string, { individual: number; groupTotal: number; groupEventCount: number }>();
    data.weeks.forEach((week) => {
      if (week.locationBreakdowns) {
        week.locationBreakdowns.forEach((loc) => {
          const existing = locationTotals.get(loc.location) || { individual: 0, groupTotal: 0, groupEventCount: 0 };
          existing.individual += loc.individual;
          existing.groupTotal += loc.groupTotal;
          existing.groupEventCount += loc.groupEventCount;
          locationTotals.set(loc.location, existing);
        });
      }
    });

    const sortedLocations = Array.from(locationTotals.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    sortedLocations.forEach(([location, totals]) => {
      rows.push([
        location,
        totals.individual,
        totals.groupTotal,
        totals.groupEventCount,
        totals.individual + totals.groupTotal,
      ]);
    });

    // Grand totals
    const grandIndividual = sortedLocations.reduce((sum, [, t]) => sum + t.individual, 0);
    const grandGroup = sortedLocations.reduce((sum, [, t]) => sum + t.groupTotal, 0);
    const grandEvents = sortedLocations.reduce((sum, [, t]) => sum + t.groupEventCount, 0);
    rows.push(['GRAND TOTAL', grandIndividual, grandGroup, grandEvents, data.grandTotal]);
    rows.push([]);

    // SECTION 4: Sandwich Type Breakdown
    rows.push(['=== SANDWICH TYPE BREAKDOWN ===']);
    rows.push(['Week Starting', 'Week Ending', 'Deli', 'Turkey', 'Ham', 'PB&J', 'Other/Generic', 'Total Typed']);
    data.weeks.forEach((week) => {
      const weekTypes = week.sandwichTypes || { deli: 0, turkey: 0, ham: 0, pbj: 0, generic: 0 };
      const typedTotal = weekTypes.deli + weekTypes.turkey + weekTypes.ham + weekTypes.pbj + weekTypes.generic;
      rows.push([
        week.weekStartDate,
        week.weekEndDate,
        weekTypes.deli,
        weekTypes.turkey,
        weekTypes.ham,
        weekTypes.pbj,
        weekTypes.generic,
        typedTotal,
      ]);
    });
    // Sandwich type grand totals
    if (data.grandTotalSandwichTypes) {
      const typedGrandTotal = data.grandTotalSandwichTypes.deli +
        data.grandTotalSandwichTypes.turkey +
        data.grandTotalSandwichTypes.ham +
        data.grandTotalSandwichTypes.pbj +
        data.grandTotalSandwichTypes.generic;
      rows.push([
        'GRAND TOTAL',
        '',
        data.grandTotalSandwichTypes.deli,
        data.grandTotalSandwichTypes.turkey,
        data.grandTotalSandwichTypes.ham,
        data.grandTotalSandwichTypes.pbj,
        data.grandTotalSandwichTypes.generic,
        typedGrandTotal,
      ]);
    }

    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `weekly-collections-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDownloadPDF = () => {
    if (!data?.weeks) return;

    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();

    // Add header with logo/title
    doc.setFillColor(71, 179, 203); // Brand teal color
    doc.rect(0, 0, pageWidth, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('The Sandwich Project', pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text('Weekly Collections Report', pageWidth / 2, 27, { align: 'center' });

    // Add report metadata
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'normal');
    doc.text(`Report Period: ${data.weeks[0]?.weekStartDate} to ${data.weeks[data.weeks.length - 1]?.weekEndDate}`, 14, 45);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 51);

    // Summary statistics box
    doc.setFillColor(224, 242, 245); // Light teal
    doc.roundedRect(14, 57, pageWidth - 28, 30, 3, 3, 'F');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 79, 97); // Dark teal

    // Calculate equal column spacing
    const boxWidth = pageWidth - 28;
    const colSpacing = boxWidth / 3;
    const col1X = 14 + colSpacing / 2;
    const col2X = 14 + colSpacing + colSpacing / 2;
    const col3X = 14 + colSpacing * 2 + colSpacing / 2;

    doc.text('Total Weeks:', col1X, 68, { align: 'center' });
    doc.text('Total Collections:', col2X, 68, { align: 'center' });
    doc.text('Total Sandwiches:', col3X, 68, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 126, 140); // Brand primary
    doc.text(data.totalWeeks.toString(), col1X, 80, { align: 'center' });
    doc.text(data.weeks.reduce((sum, w) => sum + w.collectionCount, 0).toLocaleString(), col2X, 80, { align: 'center' });
    doc.text(data.grandTotal.toLocaleString(), col3X, 80, { align: 'center' });

    // Weekly data table
    const tableData = data.weeks.map((week) => [
      week.weekStartDate,
      week.weekEndDate,
      week.collectionCount.toString(),
      week.individual.toLocaleString(),
      week.groupCollections.toLocaleString(),
      week.totalSandwiches.toLocaleString(),
    ]);

    autoTable(doc, {
      startY: 95,
      head: [['Week Start', 'Week End', 'Collections', 'Individual', 'Group Total', 'Total']],
      body: tableData,
      foot: [['Grand Total', '', data.weeks.length.toString(), '', '', data.grandTotal.toLocaleString()]],
      theme: 'striped',
      headStyles: {
        fillColor: [71, 179, 203], // Brand teal
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'center',
      },
      footStyles: {
        fillColor: [26, 79, 97], // Dark teal
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [240, 248, 250], // Very light teal
      },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left' },
        2: { halign: 'right' },
        3: { halign: 'right' },
        4: { halign: 'right' },
        5: { halign: 'right', fontStyle: 'bold' },
      },
      tableWidth: 'auto',
      margin: { left: 14, right: 14 },
    });

    // Get the Y position after the first table
    const firstTableEndY = (doc as any).lastAutoTable?.finalY || 150;

    // Add sandwich type breakdown section if there's data
    if (data.grandTotalSandwichTypes) {
      const typedTotal = data.grandTotalSandwichTypes.deli +
        data.grandTotalSandwichTypes.turkey +
        data.grandTotalSandwichTypes.ham +
        data.grandTotalSandwichTypes.pbj +
        data.grandTotalSandwichTypes.generic;

      if (typedTotal > 0) {
        // Check if we need a new page
        if (firstTableEndY > 220) {
          doc.addPage();
        }

        const sandwichTypeStartY = firstTableEndY > 220 ? 20 : firstTableEndY + 15;

        // Section header
        doc.setFontSize(12);
        doc.setFont('helvetica', 'bold');
        doc.setTextColor(26, 79, 97);
        doc.text('Sandwich Type Breakdown', 14, sandwichTypeStartY);

        // Sandwich type summary box
        doc.setFillColor(255, 250, 240); // Light cream
        doc.roundedRect(14, sandwichTypeStartY + 5, pageWidth - 28, 25, 3, 3, 'F');

        const typeBoxWidth = (pageWidth - 28) / 5;
        const types = [
          { name: 'Deli', count: data.grandTotalSandwichTypes.deli, color: [180, 130, 70] },
          { name: 'Turkey', count: data.grandTotalSandwichTypes.turkey, color: [200, 120, 60] },
          { name: 'Ham', count: data.grandTotalSandwichTypes.ham, color: [190, 90, 90] },
          { name: 'PB&J', count: data.grandTotalSandwichTypes.pbj, color: [130, 90, 170] },
          { name: 'Other', count: data.grandTotalSandwichTypes.generic, color: [100, 100, 100] },
        ];

        types.forEach((type, idx) => {
          const x = 14 + typeBoxWidth * idx + typeBoxWidth / 2;
          doc.setFontSize(8);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(100, 100, 100);
          doc.text(type.name, x, sandwichTypeStartY + 14, { align: 'center' });

          doc.setFontSize(12);
          doc.setFont('helvetica', 'bold');
          doc.setTextColor(type.color[0], type.color[1], type.color[2]);
          doc.text(type.count.toLocaleString(), x, sandwichTypeStartY + 24, { align: 'center' });
        });

        // Weekly breakdown table for sandwich types
        const sandwichTypeTableData = data.weeks.map((week) => {
          const wt = week.sandwichTypes || { deli: 0, turkey: 0, ham: 0, pbj: 0, generic: 0 };
          return [
            week.weekStartDate,
            wt.deli.toString(),
            wt.turkey.toString(),
            wt.ham.toString(),
            wt.pbj.toString(),
            wt.generic.toString(),
          ];
        });

        autoTable(doc, {
          startY: sandwichTypeStartY + 35,
          head: [['Week Start', 'Deli', 'Turkey', 'Ham', 'PB&J', 'Other']],
          body: sandwichTypeTableData,
          foot: [[
            'Total',
            data.grandTotalSandwichTypes.deli.toLocaleString(),
            data.grandTotalSandwichTypes.turkey.toLocaleString(),
            data.grandTotalSandwichTypes.ham.toLocaleString(),
            data.grandTotalSandwichTypes.pbj.toLocaleString(),
            data.grandTotalSandwichTypes.generic.toLocaleString(),
          ]],
          theme: 'striped',
          headStyles: {
            fillColor: [180, 130, 70],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 8,
            halign: 'center',
          },
          footStyles: {
            fillColor: [100, 80, 50],
            textColor: [255, 255, 255],
            fontStyle: 'bold',
            fontSize: 9,
          },
          bodyStyles: {
            fontSize: 7,
          },
          alternateRowStyles: {
            fillColor: [255, 252, 245],
          },
          columnStyles: {
            0: { halign: 'left' },
            1: { halign: 'right' },
            2: { halign: 'right' },
            3: { halign: 'right' },
            4: { halign: 'right' },
            5: { halign: 'right' },
          },
          tableWidth: 'auto',
          margin: { left: 14, right: 14 },
        });
      }
    }

    // Add footer
    const pageCount = (doc as any).internal.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setTextColor(128, 128, 128);
      doc.text(
        `Page ${i} of ${pageCount}`,
        pageWidth / 2,
        doc.internal.pageSize.getHeight() - 10,
        { align: 'center' }
      );
    }

    // Save the PDF
    doc.save(`TSP-Weekly-Collections-${startDate}-to-${endDate}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-primary-light">
          <TrendingUp className="w-6 h-6 text-brand-teal" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-slate-900">Weekly Collections Report</h1>
          <p className="text-slate-600 text-sm sm:text-base">View sandwich collection totals by week (Wednesday-Tuesday)</p>
        </div>
      </div>

      {/* How it Works Info */}
      {!useExactDates && (
        <Alert className="border-2 bg-brand-primary-light border-brand-teal">
          <Info className="h-6 w-6 text-brand-teal" />
          <AlertDescription className="text-slate-800 text-base leading-relaxed">
            <strong className="text-lg text-brand-navy">How weekly grouping works:</strong> This report groups collections into <strong>Wednesday-to-Tuesday weeks</strong>.
            When you enter a start date, the report will include the <strong>entire week</strong> containing that date (starting from the Wednesday of that week).
            The same applies to your end date - it includes the full week ending on the Tuesday that contains or follows your end date.
            <div className="mt-3 text-base bg-white/80 rounded-lg p-3 border border-brand-light-blue">
              <strong className="text-brand-navy">Example:</strong> If you enter 11/22/2025 (a Saturday), the report will include the full week of Nov 19-25, 2025 (Wed-Tue).
            </div>
          </AlertDescription>
        </Alert>
      )}

      {/* Date Range Filter */}
      <Card className="p-6 bg-white">
        <div className="space-y-4">
          <h2 className="font-semibold text-slate-900">Select Date Range</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                Start Date
              </label>
              <Input
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                className="w-full"
              />
              {!useExactDates && (
                <p className="text-xs text-slate-500 mt-1">
                  Report will start from the Wednesday of this week
                </p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                End Date
              </label>
              <Input
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className="w-full"
              />
              {!useExactDates && (
                <p className="text-xs text-slate-500 mt-1">
                  Report will end on the Tuesday of this week
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <Checkbox
              id="useExactDates"
              checked={useExactDates}
              onCheckedChange={(checked) => setUseExactDates(checked === true)}
            />
            <Label
              htmlFor="useExactDates"
              className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
            >
              Use exact date range (don't expand to Wednesday-Tuesday weeks)
            </Label>
          </div>
          <div className="flex flex-wrap gap-3">
            <Button
              onClick={handleGenerate}
              disabled={isLoading}
              className="bg-brand-primary hover:bg-brand-primary-dark"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Generating...
                </>
              ) : (
                'Generate Report'
              )}
            </Button>
            {data?.weeks && data.weeks.length > 0 && (
              <>
                <Button
                  onClick={handleDownloadPDF}
                  className="gap-2 bg-brand-primary hover:bg-brand-primary-dark border-2 border-brand-orange"
                  title="Download a professionally formatted PDF report"
                >
                  <FileText className="w-4 h-4" />
                  Export to PDF
                </Button>
                <Button
                  onClick={handleDownloadCSV}
                  className="gap-2"
                  variant="outline"
                  title="Download raw data as CSV for Excel"
                >
                  <Download className="w-4 h-4" />
                  Export to CSV
                </Button>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Error State */}
      {error && (
        <Card className="p-6 bg-red-50 border-red-200">
          <p className="text-red-800 font-medium">
            Error: {error instanceof Error ? error.message : 'Failed to load data'}
          </p>
        </Card>
      )}

      {/* Results */}
      {data && (
        <>
          {/* Date Range Summary */}
          {data.weeks.length > 0 && !useExactDates && (
            <Alert className="border-2 bg-brand-primary-light border-brand-teal">
              <Info className="h-5 w-5 text-brand-teal" />
              <AlertDescription className="text-slate-800 text-base">
                <strong className="text-base text-brand-navy">Showing collections from:</strong> {data.weeks[0].weekStartDate} to {data.weeks[data.weeks.length - 1].weekEndDate}
                <div className="text-sm mt-2 text-slate-700">
                  Your selected date range ({data.startDate} to {data.endDate}) was expanded to include complete Wednesday-Tuesday weeks.
                </div>
              </AlertDescription>
            </Alert>
          )}
          {data.weeks.length > 0 && useExactDates && (
            <Alert className="border-2 bg-brand-primary-light border-brand-teal">
              <Info className="h-5 w-5 text-brand-teal" />
              <AlertDescription className="text-slate-800 text-base">
                <strong className="text-base text-brand-navy">Showing collections from:</strong> {data.startDate} to {data.endDate}
                <div className="text-sm mt-2 text-slate-700">
                  Using exact date range (not expanded to full weeks). Results are still grouped by Wednesday-Tuesday weeks for display.
                </div>
              </AlertDescription>
            </Alert>
          )}

          <Card className="bg-white overflow-hidden">
            <div className="p-4 sm:p-6 border-b border-slate-200 bg-slate-50">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-slate-600">Total Weeks</p>
                  <p className="text-2xl font-bold text-slate-900">{data.totalWeeks}</p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Collections</p>
                  <p className="text-2xl font-bold text-slate-900">
                    {data.weeks.reduce((sum, w) => sum + w.collectionCount, 0)}
                  </p>
                </div>
                <div>
                  <p className="text-sm text-slate-600">Total Sandwiches</p>
                  <p className="text-2xl font-bold text-brand-teal">{data.grandTotal.toLocaleString()}</p>
                </div>
              </div>
            </div>
          </Card>

          {/* Sandwich Type Breakdown */}
          {data.grandTotalSandwichTypes && (
            <Card className="bg-white overflow-hidden">
              <div className="p-4 sm:p-6">
                <h3 className="font-semibold text-slate-900 mb-4">Sandwich Type Breakdown</h3>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-4">
                  <div className="p-3 bg-amber-50 rounded-lg border border-amber-200">
                    <p className="text-xs text-amber-700 font-medium">Deli</p>
                    <p className="text-xl font-bold text-amber-900">{data.grandTotalSandwichTypes.deli.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-orange-50 rounded-lg border border-orange-200">
                    <p className="text-xs text-orange-700 font-medium">Turkey</p>
                    <p className="text-xl font-bold text-orange-900">{data.grandTotalSandwichTypes.turkey.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-rose-50 rounded-lg border border-rose-200">
                    <p className="text-xs text-rose-700 font-medium">Ham</p>
                    <p className="text-xl font-bold text-rose-900">{data.grandTotalSandwichTypes.ham.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-violet-50 rounded-lg border border-violet-200">
                    <p className="text-xs text-violet-700 font-medium">PB&J</p>
                    <p className="text-xl font-bold text-violet-900">{data.grandTotalSandwichTypes.pbj.toLocaleString()}</p>
                  </div>
                  <div className="p-3 bg-slate-50 rounded-lg border border-slate-200">
                    <p className="text-xs text-slate-700 font-medium">Other/Generic</p>
                    <p className="text-xl font-bold text-slate-900">{data.grandTotalSandwichTypes.generic.toLocaleString()}</p>
                  </div>
                </div>
                {/* Show percentage breakdown if there are any typed sandwiches */}
                {(() => {
                  const total = data.grandTotalSandwichTypes.deli +
                    data.grandTotalSandwichTypes.turkey +
                    data.grandTotalSandwichTypes.ham +
                    data.grandTotalSandwichTypes.pbj +
                    data.grandTotalSandwichTypes.generic;
                  const untyped = data.grandTotal - total;
                  if (total > 0) {
                    return (
                      <div className="mt-4 text-sm text-slate-600">
                        <span className="font-medium">{total.toLocaleString()}</span> sandwiches with type breakdown recorded
                        {untyped > 0 && (
                          <span className="ml-1">
                            ({untyped.toLocaleString()} without type information)
                          </span>
                        )}
                      </div>
                    );
                  }
                  return (
                    <div className="mt-4 text-sm text-slate-500 italic">
                      No sandwich type breakdown data recorded for this period.
                    </div>
                  );
                })()}
              </div>
            </Card>
          )}

          {/* Visual Chart */}
          <Card className="bg-white overflow-hidden">
            <div className="p-6 border-b border-slate-200 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <BarChart3 className="w-5 h-5 text-brand-primary" />
                <h3 className="font-semibold text-slate-900">Collection Trends</h3>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowChart(!showChart)}
              >
                {showChart ? 'Hide' : 'Show'} Chart
              </Button>
            </div>

            {showChart && data.weeks.length > 0 && (
              <div className="p-6">
                <div className="h-80">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart
                      data={data.weeks.map((week) => ({
                        weekLabel: week.weekStartDate,
                        individual: week.individual,
                        groupCollections: week.groupCollections,
                        total: week.totalSandwiches,
                      }))}
                      margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                      <XAxis
                        dataKey="weekLabel"
                        tick={{ fontSize: 11 }}
                        angle={-45}
                        textAnchor="end"
                        height={80}
                      />
                      <YAxis
                        tick={{ fontSize: 12 }}
                        tickFormatter={(value) => value.toLocaleString()}
                      />
                      <Tooltip
                        formatter={(value: number, name: string) => [
                          value.toLocaleString(),
                          name === 'individual' ? 'Individual' : name === 'groupCollections' ? 'Group Collections' : 'Total'
                        ]}
                        labelFormatter={(label) => `Week: ${label}`}
                        contentStyle={{ borderRadius: '8px', border: '1px solid #e5e7eb' }}
                      />
                      <Legend
                        wrapperStyle={{ paddingTop: '20px' }}
                        formatter={(value) =>
                          value === 'individual' ? 'Individual' :
                          value === 'groupCollections' ? 'Group Collections' : 'Total'
                        }
                      />
                      <Line
                        type="monotone"
                        dataKey="individual"
                        stroke="#236383"
                        strokeWidth={2}
                        dot={{ fill: '#236383', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, fill: '#236383' }}
                        name="individual"
                      />
                      <Line
                        type="monotone"
                        dataKey="groupCollections"
                        stroke="#FBAD3F"
                        strokeWidth={2}
                        dot={{ fill: '#FBAD3F', strokeWidth: 2, r: 4 }}
                        activeDot={{ r: 6, fill: '#FBAD3F' }}
                        name="groupCollections"
                      />
                      <Line
                        type="monotone"
                        dataKey="total"
                        stroke="#47B3CB"
                        strokeWidth={3}
                        dot={{ fill: '#47B3CB', strokeWidth: 2, r: 5 }}
                        activeDot={{ r: 7, fill: '#47B3CB' }}
                        name="total"
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </Card>

          <Card className="bg-white overflow-hidden">
            {data.weeks.length > 0 ? (
              <>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Week Starting</TableHead>
                        <TableHead className="text-right">Collections</TableHead>
                        <TableHead className="text-right">Individual</TableHead>
                        <TableHead className="text-right">Group Collections</TableHead>
                        <TableHead className="text-right font-bold">Total</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.weeks.map((week, idx) => (
                        <TableRow key={idx} className="hover:bg-slate-50">
                          <TableCell className="font-medium">
                            <div className="text-sm">
                              <p className="font-semibold text-slate-900">{week.weekStartDate}</p>
                              <p className="text-slate-600">to {week.weekEndDate}</p>
                            </div>
                          </TableCell>
                          <TableCell className="text-right text-slate-700">
                            {week.collectionCount}
                          </TableCell>
                          <TableCell className="text-right text-slate-700">
                            {week.individual.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right text-slate-700">
                            {week.groupCollections.toLocaleString()}
                          </TableCell>
                          <TableCell className="text-right font-bold text-brand-teal">
                            {week.totalSandwiches.toLocaleString()}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
                  <div className="text-right">
                    <p className="text-sm text-slate-600 mb-1">Grand Total</p>
                    <p className="text-3xl font-bold text-brand-teal">{data.grandTotal.toLocaleString()}</p>
                    <p className="text-sm text-slate-600 mt-2">
                      across {data.weeks.length} weeks
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <div className="p-12 text-center">
                <p className="text-slate-600">No collections found in this date range.</p>
              </div>
            )}
          </Card>
        </>
      )}
      

      {/* Empty State */}
      {!data && !isLoading && (
        <Card className="p-12 text-center bg-slate-50">
          <p className="text-slate-600 mb-4">
            Select a date range and click "Generate Report" to view weekly sandwich collection totals grouped by Wednesday-Tuesday weeks.
          </p>
        </Card>
      )}
    </div>
  );
}
