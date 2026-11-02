import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import {
  FileText,
  Download,
  ExternalLink,
  BookOpen,
  RotateCcw,
  AlertCircle,
  Cog,
  Lightbulb,
  Target,
} from 'lucide-react';
import type { ReactNode } from 'react';

interface Meeting {
  id: number;
  title: string;
  date: string;
  time: string;
  type: string;
  status: string;
  location?: string;
  description?: string;
  finalAgenda?: string;
}

interface AgendaItem {
  id: number;
  title: string;
  description?: string;
  submittedBy: string;
  type: string;
  status?: string;
  estimatedTime?: string;
  meetingId?: number;
}

interface AgendaSection {
  id: number;
  title: string;
  items: AgendaItem[];
}

interface CompiledAgenda {
  id: number;
  meetingId: number;
  date: string;
  status: string;
  totalEstimatedTime?: string;
  sections?: AgendaSection[];
}

interface MeetingDetailsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedMeeting: Meeting | null;
  isPastMeeting: (dateString: string, timeString?: string) => boolean;
  formatMeetingDate: (dateString: string) => string;
  formatMeetingTime: (timeString: string) => string;
  handleDownloadPDF: (meeting: Meeting | null) => void;
  compiledAgenda: CompiledAgenda | undefined;
  agendaLoading: boolean;
  handleExportToSheets: (meeting: Meeting) => void;
  handleCompileAgenda: (meeting: Meeting) => void;
  isExporting: boolean;
  isCompiling: boolean;
  getSectionIcon: (title: string) => ReactNode;
  getSectionColor: (title: string) => string;
}

export function MeetingDetailsDialog({
  open,
  onOpenChange,
  selectedMeeting,
  isPastMeeting,
  formatMeetingDate,
  formatMeetingTime,
  handleDownloadPDF,
  compiledAgenda,
  agendaLoading,
  handleExportToSheets,
  handleCompileAgenda,
  isExporting,
  isCompiling,
  getSectionIcon,
  getSectionColor,
}: MeetingDetailsDialogProps) {
  if (!selectedMeeting) return null;

  const isPast = isPastMeeting(selectedMeeting.date, selectedMeeting.time);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[85vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="w-5 h-5" />
            {selectedMeeting.title} - {isPast ? 'Meeting Documentation' : 'Agenda Review'}
          </DialogTitle>
        </DialogHeader>

        {isPast ? (
          // Past Meeting - Show PDF preview and download
          <div className="space-y-6">
            <div className="bg-teal-50 p-4 rounded-lg border border-teal-200">
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
                <div>
                  <span className="font-medium text-teal-900">Date:</span>
                  <span className="ml-2 text-teal-800">
                    {formatMeetingDate(selectedMeeting.date)}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-teal-900">Time:</span>
                  <span className="ml-2 text-teal-800">
                    {formatMeetingTime(selectedMeeting.time)}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-teal-900">Status:</span>
                  <Badge className="ml-2 bg-gray-200 text-gray-700">
                    Completed
                  </Badge>
                </div>
              </div>
            </div>

            {/* PDF Preview Area */}
            <div className="border-2 border-dashed border-teal-300 rounded-lg p-8 text-center bg-teal-50/50">
              <FileText className="w-16 h-16 text-teal-600 mx-auto mb-4" />
              <h3 className="text-lg font-medium text-teal-900 mb-2">
                Meeting Agenda PDF
              </h3>
              <p className="text-teal-700 mb-4">
                View the compiled agenda that was used during this meeting
              </p>
              <button
                data-testid="button-download-past-meeting-pdf"
                onClick={() => handleDownloadPDF(selectedMeeting)}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 text-white px-6 py-3 rounded-lg font-medium shadow-md hover:shadow-lg transition-all duration-200 transform hover:scale-105"
              >
                <Download className="w-4 h-4" />
                Download Agenda PDF
              </button>
            </div>

            {/* Meeting Notes Section */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg text-gray-900 flex items-center gap-2">
                  <BookOpen className="w-5 h-5 text-teal-600" />
                  Meeting Notes & Action Items
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-gray-600 italic">
                  Meeting notes and action items would be displayed here once available.
                </p>
              </CardContent>
            </Card>
          </div>
        ) : agendaLoading ? (
          // Loading state for upcoming meetings
          <div className="flex items-center justify-center h-32">
            <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-teal-600"></div>
          </div>
        ) : compiledAgenda ? (
          // Upcoming Meeting - Show compiled agenda with export options
          <div className="space-y-6">
            {/* Agenda Header */}
            <div className="bg-teal-50 p-3 sm:p-4 rounded-lg border border-teal-200">
              <div className="grid grid-cols-1 xs:grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 text-sm">
                <div>
                  <span className="font-medium text-teal-900">Date:</span>
                  <span className="ml-2 text-teal-800">
                    {formatMeetingDate(selectedMeeting.date)}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-teal-900">Time:</span>
                  <span className="ml-2 text-teal-800">
                    {formatMeetingTime(selectedMeeting.time)}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-teal-900">Duration:</span>
                  <span className="ml-2 text-teal-800">
                    {compiledAgenda.totalEstimatedTime || '1 hour'}
                  </span>
                </div>
                <div>
                  <span className="font-medium text-teal-900">Status:</span>
                  <Badge
                    className="ml-2"
                    variant={compiledAgenda.status === 'finalized' ? 'default' : 'secondary'}
                  >
                    {compiledAgenda.status}
                  </Badge>
                </div>
              </div>
            </div>

            {/* Agenda Sections */}
            <div className="space-y-4">
              {compiledAgenda.sections?.map((section: AgendaSection, index: number) => (
                <Card key={section.id} className="border-l-4 border-l-teal-500">
                  <CardHeader className="pb-3">
                    <CardTitle
                      className={`flex items-center gap-2 text-lg ${getSectionColor(
                        section.title
                      )} bg-white px-3 py-2 rounded`}
                    >
                      {getSectionIcon(section.title)}
                      {section.title}
                      <Badge variant="outline" className="ml-auto">
                        {section.items?.length || 0} items
                      </Badge>
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    {section.items && section.items.length > 0 ? (
                      <div className="space-y-3">
                        {section.items.map((item: AgendaItem, itemIndex: number) => (
                          <div key={itemIndex} className="p-3 bg-gray-50 rounded border">
                            <div className="flex items-start justify-between">
                              <div className="flex-1">
                                <h4 className="font-medium text-gray-900">
                                  {item.title}
                                </h4>
                                {item.description && (
                                  <p className="text-sm text-gray-600 mt-1">
                                    {item.description}
                                  </p>
                                )}
                                <div className="flex flex-wrap items-center gap-2 sm:gap-4 mt-2 text-xs text-gray-500">
                                  <span>Presenter: {item.submittedBy}</span>
                                  <span>Time: {item.estimatedTime || '5 min'}</span>
                                  <Badge variant="outline" className="text-xs">
                                    {item.type.replace('_', ' ')}
                                  </Badge>
                                </div>
                              </div>
                              {item.status && (
                                <Badge
                                  variant={item.status === 'approved' ? 'default' : 'secondary'}
                                >
                                  {item.status}
                                </Badge>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-gray-500 italic">No items in this section</p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>

            {/* Export Actions */}
            <div className="flex flex-col sm:flex-row gap-3 pt-4 border-t border-gray-200">
              <button
                data-testid="button-export-to-sheets"
                onClick={() => handleExportToSheets(selectedMeeting)}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 bg-gradient-to-r from-[#236383] to-[#236383] hover:from-[#1e5a75] hover:to-[#1A4F5E] disabled:from-gray-400 disabled:to-gray-500 text-white px-4 py-2.5 rounded-lg font-medium shadow-md hover:shadow-lg transition-all duration-200 disabled:cursor-not-allowed"
              >
                {isExporting ? (
                  <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
                ) : (
                  <ExternalLink className="w-4 h-4" />
                )}
                Export to Google Sheets
              </button>
              <button
                data-testid="button-export-pdf"
                onClick={() => handleDownloadPDF(selectedMeeting)}
                disabled={isExporting}
                className="flex items-center justify-center gap-2 border border-teal-300 text-teal-600 hover:bg-teal-50 hover:border-teal-400 disabled:border-gray-300 disabled:text-gray-400 px-4 py-2.5 rounded-lg font-medium transition-all duration-200 disabled:cursor-not-allowed"
              >
                <Download className="w-4 h-4" />
                Export as PDF
              </button>
            </div>
          </div>
        ) : (
          // No agenda compiled yet for upcoming meeting
          <div className="text-center py-8">
            <Cog className="w-16 h-16 text-teal-600 mx-auto mb-4" />
            <h3 className="text-lg font-medium text-teal-900 mb-2">
              Ready to Compile Weekly Agenda
            </h3>
            <p className="text-teal-700 mb-6">
              Compile the agenda from your Google Sheet projects and submitted agenda items
            </p>
            <button
              data-testid="button-compile-agenda"
              onClick={() => handleCompileAgenda(selectedMeeting)}
              disabled={isCompiling}
              className="flex items-center justify-center gap-2 bg-gradient-to-r from-teal-500 to-teal-600 hover:from-teal-600 hover:to-teal-700 disabled:from-gray-400 disabled:to-gray-500 text-white px-6 py-3 rounded-lg font-medium shadow-lg hover:shadow-xl transition-all duration-200 transform hover:scale-105 disabled:cursor-not-allowed disabled:transform-none"
            >
              {isCompiling ? (
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white"></div>
              ) : (
                <Cog className="w-4 h-4" />
              )}
              Compile Weekly Agenda
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}