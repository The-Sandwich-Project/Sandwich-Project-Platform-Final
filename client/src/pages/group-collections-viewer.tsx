import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Loader2, Download, Users, Search, Filter, FileText, Calendar } from 'lucide-react';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

import { usePageSession } from '@/hooks/usePageSession';
interface GroupCollection {
  id: number;
  collectionDate: string;
  hostName: string;
  groupName: string;
  department?: string;
  count: number;
  deli?: number;
  turkey?: number;
  ham?: number;
  pbj?: number;
  generic?: number;
}

export default function GroupCollectionsViewer() {
  // Track page session for activity logging
  usePageSession({
    section: 'Analytics',
    page: 'Group Collections Viewer',
  });

  const [startDate, setStartDate] = useState(() => {
    const date = new Date();
    date.setMonth(date.getMonth() - 3);
    return date.toISOString().split('T')[0];
  });

  const [endDate, setEndDate] = useState(() => {
    return new Date().toISOString().split('T')[0];
  });

  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'host' | 'group' | 'count'>('date');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');

  const { data: groupCollections = [], isLoading, error, refetch } = useQuery<GroupCollection[]>({
    queryKey: ['/api/reports/group-collections', startDate, endDate],
    queryFn: async () => {
      const response = await fetch(
        `/api/reports/group-collections?startDate=${startDate}&endDate=${endDate}`
      );
      if (!response.ok) throw new Error('Failed to fetch group collections');
      return response.json();
    },
    enabled: false,
  });

  const handleGenerate = () => {
    refetch();
  };

  // Filter and sort data
  const filteredAndSorted = useMemo(() => {
    let filtered = groupCollections.filter((item) => {
      const searchLower = searchQuery.toLowerCase();
      return (
        item.groupName.toLowerCase().includes(searchLower) ||
        item.hostName.toLowerCase().includes(searchLower) ||
        (item.department && item.department.toLowerCase().includes(searchLower))
      );
    });

    // Sort
    filtered.sort((a, b) => {
      let comparison = 0;
      switch (sortBy) {
        case 'date':
          comparison = new Date(a.collectionDate).getTime() - new Date(b.collectionDate).getTime();
          break;
        case 'host':
          comparison = a.hostName.localeCompare(b.hostName);
          break;
        case 'group':
          comparison = a.groupName.localeCompare(b.groupName);
          break;
        case 'count':
          comparison = a.count - b.count;
          break;
      }
      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return filtered;
  }, [groupCollections, searchQuery, sortBy, sortOrder]);

  const totalSandwiches = useMemo(() => {
    return filteredAndSorted.reduce((sum, item) => sum + item.count, 0);
  }, [filteredAndSorted]);

  const uniqueGroups = useMemo(() => {
    const groups = new Set(filteredAndSorted.map(item => item.groupName));
    return groups.size;
  }, [filteredAndSorted]);

  const handleDownloadCSV = () => {
    if (!filteredAndSorted.length) return;

    const rows = [
      ['Date', 'Host', 'Group Name', 'Department', 'Total Count', 'Deli', 'Turkey', 'Ham', 'PB&J', 'Generic'],
      ...filteredAndSorted.map((item) => [
        item.collectionDate,
        item.hostName,
        item.groupName,
        item.department || '',
        item.count,
        item.deli || '',
        item.turkey || '',
        item.ham || '',
        item.pbj || '',
        item.generic || '',
      ]),
      [],
      ['Total', '', '', '', totalSandwiches, '', '', '', '', ''],
    ];

    const csv = rows.map((row) => row.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `group-collections-${startDate}-to-${endDate}.csv`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);
  };

  const handleDownloadPDF = () => {
    if (!filteredAndSorted.length) return;

    const doc = new jsPDF({ orientation: 'landscape' });
    const pageWidth = doc.internal.pageSize.getWidth();

    // Header
    doc.setFillColor(71, 179, 203);
    doc.rect(0, 0, pageWidth, 35, 'F');

    doc.setTextColor(255, 255, 255);
    doc.setFontSize(22);
    doc.setFont('helvetica', 'bold');
    doc.text('The Sandwich Project', pageWidth / 2, 15, { align: 'center' });

    doc.setFontSize(16);
    doc.setFont('helvetica', 'normal');
    doc.text('Group Collections Report', pageWidth / 2, 27, { align: 'center' });

    // Metadata
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.text(`Report Period: ${startDate} to ${endDate}`, 14, 45);
    doc.text(`Generated: ${new Date().toLocaleDateString()}`, 14, 51);

    // Summary box
    doc.setFillColor(224, 242, 245);
    doc.roundedRect(14, 57, pageWidth - 28, 30, 3, 3, 'F');

    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(26, 79, 97);

    const boxWidth = pageWidth - 28;
    const colSpacing = boxWidth / 3;
    const col1X = 14 + colSpacing / 2;
    const col2X = 14 + colSpacing + colSpacing / 2;
    const col3X = 14 + colSpacing * 2 + colSpacing / 2;

    doc.text('Total Collections:', col1X, 68, { align: 'center' });
    doc.text('Unique Groups:', col2X, 68, { align: 'center' });
    doc.text('Total Sandwiches:', col3X, 68, { align: 'center' });

    doc.setFont('helvetica', 'bold');
    doc.setFontSize(16);
    doc.setTextColor(0, 126, 140);
    doc.text(filteredAndSorted.length.toString(), col1X, 80, { align: 'center' });
    doc.text(uniqueGroups.toString(), col2X, 80, { align: 'center' });
    doc.text(totalSandwiches.toLocaleString(), col3X, 80, { align: 'center' });

    // Table
    const tableData = filteredAndSorted.map((item) => [
      item.collectionDate,
      item.hostName,
      item.groupName,
      item.department || '-',
      item.count.toLocaleString(),
      (item.deli || 0).toLocaleString(),
      (item.turkey || 0).toLocaleString(),
      (item.ham || 0).toLocaleString(),
      (item.pbj || 0).toLocaleString(),
      (item.generic || 0).toLocaleString(),
    ]);

    autoTable(doc, {
      startY: 95,
      head: [['Date', 'Host', 'Group Name', 'Department', 'Total', 'Deli', 'Turkey', 'Ham', 'PB&J', 'Generic']],
      body: tableData,
      foot: [['Grand Total', '', '', '', totalSandwiches.toLocaleString(), '', '', '', '', '']],
      theme: 'striped',
      headStyles: {
        fillColor: [71, 179, 203],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 9,
        halign: 'center',
      },
      footStyles: {
        fillColor: [26, 79, 97],
        textColor: [255, 255, 255],
        fontStyle: 'bold',
        fontSize: 10,
      },
      bodyStyles: {
        fontSize: 8,
      },
      alternateRowStyles: {
        fillColor: [240, 248, 250],
      },
      columnStyles: {
        0: { halign: 'left' },
        1: { halign: 'left' },
        2: { halign: 'left' },
        3: { halign: 'left' },
        4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right' },
        6: { halign: 'right' },
        7: { halign: 'right' },
        8: { halign: 'right' },
        9: { halign: 'right' },
      },
      tableWidth: 'auto',
      margin: { left: 14, right: 14 },
    });

    // Footer
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

    doc.save(`TSP-Group-Collections-${startDate}-to-${endDate}.pdf`);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <div className="flex items-center justify-center w-12 h-12 rounded-xl bg-brand-primary-light">
          <Users className="w-6 h-6 text-brand-primary" />
        </div>
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Group Collections Viewer</h1>
          <p className="text-slate-600">View and analyze all group collections with detailed breakdowns</p>
        </div>
      </div>

      {/* Date Range & Generate */}
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
            </div>
          </div>
          <Button
            onClick={handleGenerate}
            disabled={isLoading}
            className="bg-brand-primary hover:bg-brand-primary-dark"
          >
            {isLoading ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Loading...
              </>
            ) : (
              <>
                <Calendar className="w-4 h-4 mr-2" />
                Load Group Collections
              </>
            )}
          </Button>
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
      {groupCollections.length > 0 && (
        <>
          {/* Summary Stats */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <Card className="p-6 bg-gradient-to-br from-brand-primary-lighter to-brand-primary-light border-2 border-brand-primary-border">
              <div className="text-sm text-brand-primary font-medium">Total Collections</div>
              <div className="text-3xl font-bold text-brand-navy mt-2">{filteredAndSorted.length}</div>
            </Card>
            <Card className="p-6 bg-gradient-to-br from-[#E0F2F5] to-[#B8E6EE] border-2 border-brand-teal/30">
              <div className="text-sm text-brand-teal font-medium">Unique Groups</div>
              <div className="text-3xl font-bold text-brand-navy mt-2">{uniqueGroups}</div>
            </Card>
            <Card className="p-6 bg-gradient-to-br from-brand-orange-lighter to-brand-orange-light border-2 border-brand-orange/30">
              <div className="text-sm text-brand-orange-dark font-medium">Total Sandwiches</div>
              <div className="text-3xl font-bold text-brand-navy mt-2">{totalSandwiches.toLocaleString()}</div>
            </Card>
          </div>

          {/* Filters & Export */}
          <Card className="p-4 sm:p-6 bg-white">
            <div className="flex flex-col gap-4">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-slate-400" />
                <Input
                  placeholder="Search by group name, host, or department..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-10"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                  <SelectTrigger className="w-full sm:w-40">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="date">Sort by Date</SelectItem>
                    <SelectItem value="host">Sort by Host</SelectItem>
                    <SelectItem value="group">Sort by Group</SelectItem>
                    <SelectItem value="count">Sort by Count</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc')}
                  className="w-20 shrink-0"
                >
                  {sortOrder === 'asc' ? '↑ Asc' : '↓ Desc'}
                </Button>
                <div className="flex gap-2 w-full sm:w-auto">
                  <Button
                    onClick={handleDownloadPDF}
                    className="flex-1 sm:flex-none gap-2 bg-brand-primary hover:bg-brand-primary-dark"
                  >
                    <FileText className="w-4 h-4" />
                    <span className="hidden sm:inline">PDF</span>
                  </Button>
                  <Button
                    onClick={handleDownloadCSV}
                    variant="outline"
                    className="flex-1 sm:flex-none gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span className="hidden sm:inline">CSV</span>
                  </Button>
                </div>
              </div>
            </div>
          </Card>

          {/* Data Table */}
          <Card className="bg-white overflow-hidden">
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Host</TableHead>
                    <TableHead>Group Name</TableHead>
                    <TableHead>Department</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Deli</TableHead>
                    <TableHead className="text-right">Turkey</TableHead>
                    <TableHead className="text-right">Ham</TableHead>
                    <TableHead className="text-right">PB&J</TableHead>
                    <TableHead className="text-right">Generic</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredAndSorted.map((item, idx) => (
                    <TableRow key={`${item.id}-${idx}`} className="hover:bg-slate-50">
                      <TableCell className="font-medium">{item.collectionDate}</TableCell>
                      <TableCell>{item.hostName}</TableCell>
                      <TableCell>
                        <div className="font-medium text-brand-primary">{item.groupName}</div>
                      </TableCell>
                      <TableCell>
                        {item.department ? (
                          <Badge variant="outline" className="text-xs">{item.department}</Badge>
                        ) : (
                          <span className="text-slate-400">-</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-bold text-brand-teal">
                        {item.count.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {item.deli ? item.deli.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {item.turkey ? item.turkey.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {item.ham ? item.ham.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {item.pbj ? item.pbj.toLocaleString() : '-'}
                      </TableCell>
                      <TableCell className="text-right text-slate-600">
                        {item.generic ? item.generic.toLocaleString() : '-'}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            {filteredAndSorted.length === 0 && groupCollections.length > 0 && (
              <div className="p-12 text-center">
                <p className="text-slate-600">No group collections match your search.</p>
              </div>
            )}

            <div className="p-6 bg-slate-50 border-t border-slate-200 flex justify-end">
              <div className="text-right">
                <p className="text-sm text-slate-600 mb-1">Grand Total</p>
                <p className="text-3xl font-bold text-brand-teal">{totalSandwiches.toLocaleString()}</p>
                <p className="text-sm text-slate-600 mt-2">
                  across {filteredAndSorted.length} group collection{filteredAndSorted.length !== 1 ? 's' : ''}
                </p>
              </div>
            </div>
          </Card>
        </>
      )}

      {/* Empty State */}
      {!groupCollections.length && !isLoading && (
        <Card className="p-12 text-center bg-slate-50">
          <Users className="w-16 h-16 text-slate-400 mx-auto mb-4" />
          <p className="text-slate-600 mb-4">
            Select a date range and click "Load Group Collections" to view group collection data.
          </p>
        </Card>
      )}
    </div>
  );
}
