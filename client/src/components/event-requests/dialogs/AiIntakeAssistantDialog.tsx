import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Sparkles,
  AlertCircle,
  AlertTriangle,
  Lightbulb,
  CheckCircle2,
  ListChecks,
  Calendar,
  MapPin,
  Sandwich as SandwichIcon,
  Users,
  Edit,
  Phone,
  Mail,
  StickyNote,
  ExternalLink,
  Save,
  X,
} from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest, applyPatchResponseToCache } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { useState } from 'react';
import type { EventRequest } from '@shared/schema';

type ValidationSeverity = 'critical' | 'warning' | 'suggestion';
type ValidationCategory =
  | 'scheduling'
  | 'logistics'
  | 'sandwiches'
  | 'contact'
  | 'verification'
  | 'general';

interface ValidationIssue {
  category: ValidationCategory;
  severity: ValidationSeverity;
  field: string;
  title: string;
  message: string;
  suggestion?: string;
  action?: string;
}

interface AiIntakeAssistance {
  overallStatus: 'complete' | 'needs_attention' | 'critical_missing';
  completionPercentage: number;
  criticalIssues: ValidationIssue[];
  warnings: ValidationIssue[];
  suggestions: ValidationIssue[];
  aiRecommendations?: string;
  nextSteps: string[];
}

interface AiIntakeAssistantDialogProps {
  open: boolean;
  onClose: () => void;
  eventRequest: EventRequest;
  onEditEvent?: () => void;
  onLogContact?: () => void;
  onScheduleCall?: () => void;
  onAddNote?: () => void;
}

export function AiIntakeAssistantDialog({
  open,
  onClose,
  eventRequest,
  onEditEvent,
  onLogContact,
  onScheduleCall,
  onAddNote,
}: AiIntakeAssistantDialogProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [analysis, setAnalysis] = useState<AiIntakeAssistance | null>(null);
  const [editingField, setEditingField] = useState<string | null>(null);
  const [editValue, setEditValue] = useState<any>('');

  const analyzeEventMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest<AiIntakeAssistance>(
        'POST',
        `/api/event-requests/${eventRequest.id}/ai-intake-assist`
      );
    },
    onSuccess: (data) => {
      setAnalysis(data);
    },
    onError: (error: Error) => {
      toast({
        title: 'AI Analysis Failed',
        description: error.message || 'Failed to generate intake assistance',
        variant: 'destructive',
      });
    },
  });

  const updateFieldMutation = useMutation({
    mutationFn: async ({ field, value }: { field: string; value: any }) => {
      return await apiRequest(
        'PATCH',
        `/api/event-requests/${eventRequest.id}`,
        { [field]: value }
      );
    },
    onSuccess: (updatedEvent, variables) => {
      void applyPatchResponseToCache(queryClient, updatedEvent, {
        previousStatus: eventRequest.status,
        touchedFields: [variables.field],
      });
      toast({
        title: 'Updated',
        description: 'Event information updated successfully',
      });
      setEditingField(null);
      // Re-analyze after update
      analyzeEventMutation.mutate();
    },
    onError: (error: Error) => {
      toast({
        title: 'Update Failed',
        description: error.message || 'Failed to update event information',
        variant: 'destructive',
      });
    },
  });

  const startEditing = (field: string, currentValue: any) => {
    setEditingField(field);

    // For date fields, convert ISO string to YYYY-MM-DD format for input
    const fieldConfig = {
      scheduledEventDate: 'date',
      desiredEventDate: 'date',
      eventStartTime: 'time',
      eventEndTime: 'time',
      sandwichPickupTime: 'time',
    } as Record<string, string>;

    if (fieldConfig[field] === 'date' && currentValue) {
      const date = new Date(currentValue);
      const formatted = date.toISOString().split('T')[0]; // Get YYYY-MM-DD
      setEditValue(formatted);
    } else {
      setEditValue(currentValue ?? '');
    }
  };

  const cancelEditing = () => {
    setEditingField(null);
    setEditValue('');
  };

  const saveField = () => {
    if (editingField) {
      updateFieldMutation.mutate({ field: editingField, value: editValue });
    }
  };

  const handleClose = () => {
    setAnalysis(null);
    onClose();
  };

  // Determine which action buttons to show based on the recommendation text
  const getActionButtons = (text: string) => {
    const lowerText = text.toLowerCase();
    const buttons = [];

    // Contact-related actions
    if (
      lowerText.includes('contact') ||
      lowerText.includes('reach out') ||
      lowerText.includes('call') ||
      lowerText.includes('speak')
    ) {
      if (onLogContact) {
        buttons.push({
          label: 'Log Contact',
          icon: Phone,
          action: () => {
            handleClose();
            onLogContact();
          },
          variant: 'default' as const,
        });
      }
      if (onScheduleCall) {
        buttons.push({
          label: 'Schedule Call',
          icon: Calendar,
          action: () => {
            handleClose();
            onScheduleCall();
          },
          variant: 'outline' as const,
        });
      }
    }

    // Edit-related actions removed - we now have inline editing directly in the issue cards

    // Note-related actions
    if (
      lowerText.includes('note') ||
      lowerText.includes('document') ||
      lowerText.includes('record')
    ) {
      if (onAddNote) {
        buttons.push({
          label: 'Add Note',
          icon: StickyNote,
          action: () => {
            handleClose();
            onAddNote();
          },
          variant: 'outline' as const,
        });
      }
    }

    // No fallback "Edit Event" button - we have inline editing now

    return buttons;
  };

  const getCategoryIcon = (category: ValidationCategory) => {
    const icons = {
      scheduling: Calendar,
      logistics: MapPin,
      sandwiches: SandwichIcon,
      contact: Users,
      verification: CheckCircle2,
      general: ListChecks,
    };
    return icons[category] || ListChecks;
  };

  const getSeverityColor = (severity: ValidationSeverity) => {
    const colors = {
      critical: 'text-red-600 dark:text-red-400',
      warning: 'text-amber-600 dark:text-amber-400',
      suggestion: 'text-blue-600 dark:text-blue-400',
    };
    return colors[severity];
  };

  const getSeverityBadge = (severity: ValidationSeverity) => {
    const styles = {
      critical: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200',
      warning:
        'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200',
      suggestion:
        'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
    };

    const labels = {
      critical: 'Critical',
      warning: 'Warning',
      suggestion: 'Suggestion',
    };

    return (
      <Badge className={`${styles[severity]} text-xs`}>
        {labels[severity]}
      </Badge>
    );
  };

  const getOverallStatusBadge = (
    status: 'complete' | 'needs_attention' | 'critical_missing'
  ) => {
    const styles = {
      complete:
        'bg-tsp-sky/15 text-tsp-teal dark:bg-tsp-navy dark:text-tsp-sky border-tsp-sky dark:border-tsp-teal',
      needs_attention:
        'bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 border-amber-200 dark:border-amber-800',
      critical_missing:
        'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 border-red-200 dark:border-red-800',
    };

    const labels = {
      complete: 'Complete',
      needs_attention: 'Needs Attention',
      critical_missing: 'Critical Information Missing',
    };

    const icons = {
      complete: CheckCircle2,
      needs_attention: AlertTriangle,
      critical_missing: AlertCircle,
    };

    const Icon = icons[status];

    return (
      <Badge
        className={`${styles[status]} text-sm font-semibold px-3 py-1.5 border`}
      >
        <Icon className="w-4 h-4 mr-1.5" />
        {labels[status]}
      </Badge>
    );
  };

  // Render inline field editor based on field type
  const renderFieldEditor = (field: string) => {
    const currentValue = (eventRequest as any)[field];
    const isEditing = editingField === field;

    // Map of field configurations
    const fieldConfigs: Record<string, {
      label: string;
      type: 'text' | 'number' | 'date' | 'time' | 'boolean' | 'textarea' | 'select';
      options?: { value: any; label: string }[];
    }> = {
      hasRefrigeration: {
        label: 'Refrigeration Available',
        type: 'select',
        options: [
          { value: true, label: 'Yes' },
          { value: false, label: 'No' },
        ],
      },
      scheduledEventDate: {
        label: 'Scheduled Event Date',
        type: 'date',
      },
      desiredEventDate: {
        label: 'Desired Event Date',
        type: 'date',
      },
      eventStartTime: {
        label: 'Event Start Time',
        type: 'time',
      },
      eventEndTime: {
        label: 'Event End Time',
        type: 'time',
      },
      sandwichPickupTime: {
        label: 'Sandwich Pickup Time',
        type: 'time',
      },
      deliveryAddress: {
        label: 'Delivery Address',
        type: 'textarea',
      },
      estimatedSandwichCount: {
        label: 'Estimated Sandwich Count',
        type: 'number',
      },
      phone: {
        label: 'Phone Number',
        type: 'text',
      },
      email: {
        label: 'Email Address',
        type: 'text',
      },
      firstName: {
        label: 'First Name',
        type: 'text',
      },
      lastName: {
        label: 'Last Name',
        type: 'text',
      },
    };

    const config = fieldConfigs[field];
    if (!config) return null;

    const formatDisplayValue = (value: any, type: string) => {
      if (value === null || value === undefined) {
        return <span className="text-gray-400 italic">Not set</span>;
      }

      if (type === 'boolean') {
        return value ? 'Yes' : 'No';
      }

      if (type === 'date') {
        // Format date as readable string (e.g., "November 4, 2025")
        const date = new Date(value);
        return date.toLocaleDateString('en-US', {
          year: 'numeric',
          month: 'long',
          day: 'numeric'
        });
      }

      if (type === 'time') {
        // Format time as readable string (e.g., "2:30 PM")
        if (!value) return value;
        // Handle both "HH:MM" and "HH:MM:SS" formats
        const [hours, minutes] = value.split(':').map(Number);
        const date = new Date();
        date.setHours(hours, minutes);
        return date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true
        });
      }

      return String(value);
    };

    if (!isEditing) {
      return (
        <div className="bg-gray-50 dark:bg-gray-900/50 rounded-md p-3 border border-gray-200 dark:border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <Label className="text-xs text-gray-600 dark:text-gray-400">{config.label}</Label>
              <p className="text-sm font-medium mt-1">
                {formatDisplayValue(currentValue, config.type)}
              </p>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => startEditing(field, currentValue)}
              className="h-8"
            >
              <Edit className="h-3.5 w-3.5 mr-1" />
              Edit
            </Button>
          </div>
        </div>
      );
    }

    return (
      <div className="bg-blue-50 dark:bg-blue-950/50 rounded-md p-3 border-2 border-blue-300 dark:border-blue-700">
        <Label className="text-xs font-medium mb-2 block">{config.label}</Label>
        {config.type === 'select' && config.options ? (
          <Select value={String(editValue)} onValueChange={(val) => setEditValue(val === 'true')}>
            <SelectTrigger className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent className="z-[200]" position="popper" sideOffset={5}>
              {config.options.map((opt) => (
                <SelectItem key={String(opt.value)} value={String(opt.value)}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : config.type === 'textarea' ? (
          <Textarea
            value={editValue}
            onChange={(e) => setEditValue(e.target.value)}
            className="min-h-20"
            autoFocus
          />
        ) : (
          <Input
            type={config.type}
            value={editValue}
            onChange={(e) => setEditValue(config.type === 'number' ? parseInt(e.target.value) || 0 : e.target.value)}
            className="h-9"
            autoFocus
          />
        )}
        <div className="flex gap-2 mt-2">
          <Button
            size="sm"
            onClick={saveField}
            disabled={updateFieldMutation.isPending}
            className="h-8"
          >
            <Save className="h-3.5 w-3.5 mr-1" />
            Save
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={cancelEditing}
            disabled={updateFieldMutation.isPending}
            className="h-8"
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel
          </Button>
        </div>
      </div>
    );
  };

  const IssueCard = ({ issue }: { issue: ValidationIssue }) => {
    const Icon = getCategoryIcon(issue.category);
    const severityColor = getSeverityColor(issue.severity);
    const actionButtons = getActionButtons(
      issue.title + ' ' + issue.message + ' ' + (issue.suggestion || '')
    );

    // Check if this issue has a field that can be edited inline
    const canEditInline = issue.field && [
      'hasRefrigeration',
      'scheduledEventDate',
      'desiredEventDate',
      'eventStartTime',
      'eventEndTime',
      'sandwichPickupTime',
      'deliveryAddress',
      'estimatedSandwichCount',
      'phone',
      'email',
      'firstName',
      'lastName',
    ].includes(issue.field);

    // Get border color based on severity
    const getBorderColor = (severity: ValidationSeverity) => {
      const colors = {
        critical: 'border-l-red-500',
        warning: 'border-l-amber-500',
        suggestion: 'border-l-blue-500',
      };
      return colors[severity];
    };

    // Truncate message if too long
    const displayMessage =
      issue.message.length > 150
        ? issue.message.substring(0, 150) + '...'
        : issue.message;

    return (
      <div
        className={`border-l-4 ${getBorderColor(issue.severity)} border rounded-lg shadow-sm hover:shadow-md transition-shadow bg-white dark:bg-gray-900`}
      >
        <div className="p-4">
          <div className="flex items-start gap-3 mb-3">
            <Icon className={`h-5 w-5 mt-0.5 flex-shrink-0 ${severityColor}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                <h4 className="font-semibold text-base text-gray-900 dark:text-gray-100">
                  {issue.title}
                </h4>
                {getSeverityBadge(issue.severity)}
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {displayMessage}
              </p>
              {issue.suggestion && (
                <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-md p-2.5 mt-2.5">
                  <div className="flex items-start gap-2">
                    <Lightbulb className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400 mt-0.5 flex-shrink-0" />
                    <p className="text-xs text-blue-900 dark:text-blue-100 leading-relaxed">
                      {issue.suggestion}
                    </p>
                  </div>
                </div>
              )}
              {issue.action && (
                <div className="mt-2">
                  <p className="text-xs font-medium text-gray-700 dark:text-gray-300">
                    <span className="text-[#236383]">→</span> {issue.action}
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Inline Field Editor */}
          {canEditInline && (
            <div className="mt-3">
              {renderFieldEditor(issue.field)}
            </div>
          )}

          {/* Action Buttons - Always show consistently */}
          {actionButtons.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-2.5 border-t border-gray-200 dark:border-gray-700">
              {actionButtons.map((btn, btnIdx) => {
                const BtnIcon = btn.icon;
                return (
                  <Button
                    key={btnIdx}
                    size="sm"
                    variant={btn.variant}
                    onClick={btn.action}
                    className="text-xs h-8"
                  >
                    <BtnIcon className="h-3.5 w-3.5 mr-1.5" />
                    {btn.label}
                  </Button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[95vw] max-w-4xl max-h-[90vh] overflow-y-auto p-4 sm:p-6">
        <DialogHeader className="space-y-3">
          <div className="flex items-center gap-2">
            <Sparkles className="h-5 w-5 sm:h-6 sm:w-6 text-[#236383]" />
            <DialogTitle className="text-lg sm:text-xl">
              AI Intake Assistant
            </DialogTitle>
          </div>
          <DialogDescription className="text-sm sm:text-base">
            Get comprehensive analysis and reminders to ensure all necessary
            event details are collected
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 sm:space-y-6 mt-4">
          {/* Event Info */}
          <div className="bg-gray-50 dark:bg-gray-900 p-3 sm:p-4 rounded-lg border border-gray-200 dark:border-gray-800">
            <h3 className="font-semibold text-xs sm:text-sm mb-2 text-gray-700 dark:text-gray-300">
              Event Request
            </h3>
            <p className="text-sm sm:text-base">
              <span className="font-medium">
                {eventRequest.organizationName || 'Unnamed Organization'}
              </span>
              {eventRequest.estimatedSandwichCount !== null &&
                eventRequest.estimatedSandwichCount !== undefined &&
                eventRequest.estimatedSandwichCount > 0 && (
                  <span className="text-gray-600 dark:text-gray-400 text-xs sm:text-sm">
                    {' '}
                    • ~{eventRequest.estimatedSandwichCount.toLocaleString()}{' '}
                    sandwiches
                  </span>
                )}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
              Status:{' '}
              <span className="capitalize">
                {eventRequest.status?.replace('_', ' ')}
              </span>
            </p>
          </div>

          {/* Generate or Show Analysis */}
          {!analysis && !analyzeEventMutation.isPending && (
            <div className="text-center py-6 sm:py-8 px-4">
              <div className="bg-gradient-to-br from-[#236383]/5 to-[#47B3CB]/5 dark:from-[#236383]/10 dark:to-[#47B3CB]/10 p-6 sm:p-8 rounded-xl border border-[#236383]/20">
                <Sparkles className="h-10 w-10 sm:h-12 sm:w-12 text-[#236383] mx-auto mb-3 sm:mb-4" />
                <p className="text-gray-600 dark:text-gray-400 mb-4 sm:mb-6 text-sm sm:text-base px-2">
                  Analyze this event request for missing information and get
                  AI-powered suggestions
                </p>
                <Button
                  onClick={() => analyzeEventMutation.mutate()}
                  className="bg-[#236383] hover:bg-[#1a4d66] text-white font-semibold px-6 py-2 sm:px-8 sm:py-3 text-sm sm:text-base shadow-md hover:shadow-lg transition-all"
                >
                  <Sparkles className="h-4 w-4 sm:h-5 sm:w-5 mr-2" />
                  Analyze Event Request
                </Button>
              </div>
            </div>
          )}

          {analyzeEventMutation.isPending && (
            <div className="text-center py-8 sm:py-12 px-4">
              <div className="bg-gradient-to-br from-[#236383]/5 to-[#47B3CB]/5 dark:from-[#236383]/10 dark:to-[#47B3CB]/10 p-6 sm:p-8 rounded-xl border border-[#236383]/20">
                <div className="animate-spin rounded-full h-12 w-12 sm:h-16 sm:w-16 border-b-2 border-[#236383] mx-auto mb-4"></div>
                <p className="text-gray-600 dark:text-gray-400 font-medium text-sm sm:text-base">
                  Analyzing event request...
                </p>
                <p className="text-gray-500 dark:text-gray-500 text-xs sm:text-sm mt-2">
                  Checking for missing information and scheduling conflicts
                </p>
              </div>
            </div>
          )}

          {analysis && (
            <div className="space-y-4 sm:space-y-6">
              {/* Overall Status */}
              <div className="bg-gradient-to-br from-[#236383] to-[#47B3CB] p-1 rounded-xl shadow-lg">
                <div className="bg-white dark:bg-gray-950 p-4 sm:p-6 rounded-lg">
                  <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-4">
                    <div>
                      <h3 className="font-bold text-lg mb-2">Overall Status</h3>
                      {getOverallStatusBadge(analysis.overallStatus)}
                    </div>
                    <div className="text-right">
                      <p className="text-3xl sm:text-4xl font-bold text-[#236383] mb-1">
                        {analysis.completionPercentage}%
                      </p>
                      <p className="text-xs text-gray-500">Complete</p>
                    </div>
                  </div>
                  <Progress
                    value={analysis.completionPercentage}
                    className="h-2 mb-4"
                  />

                  {/* Summary Stats */}
                  <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center text-xs sm:text-sm">
                    <div className="bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 rounded-lg p-2 sm:p-3">
                      <p className="text-2xl font-bold text-red-600 dark:text-red-400">
                        {analysis.criticalIssues.length}
                      </p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Critical
                      </p>
                    </div>
                    <div className="bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded-lg p-2 sm:p-3">
                      <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                        {analysis.warnings.length}
                      </p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Warnings
                      </p>
                    </div>
                    <div className="bg-blue-50 dark:bg-blue-950 border border-blue-200 dark:border-blue-800 rounded-lg p-2 sm:p-3">
                      <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                        {analysis.suggestions.length}
                      </p>
                      <p className="text-gray-600 dark:text-gray-400">
                        Suggestions
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              {/* AI Recommendations */}
              {analysis.aiRecommendations && (
                <div>
                  <div className="mb-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-1">
                      Required Actions
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Complete the intake for{' '}
                      <span className="font-medium">
                        {eventRequest.organizationName}
                      </span>
                    </p>
                  </div>
                  <div className="grid gap-3">
                    {analysis.aiRecommendations
                      .split(/\d+\.\s+\*\*/)
                      .filter(Boolean)
                      .map((recommendation, idx) => {
                        // Parse title and content
                        const titleMatch = recommendation.match(/^(.+?)\*\*/);
                        const title = titleMatch ? titleMatch[1].trim() : '';
                        const content = recommendation
                          .replace(/^.+?\*\*\s*-?\s*/, '')
                          .trim();

                        if (!title) return null;

                        // Extract key points from content (first sentence or up to 120 chars)
                        const shortDescription = content
                          .split(/[.!?]/)[0]
                          .trim();
                        const displayDescription =
                          shortDescription.length > 120
                            ? shortDescription.substring(0, 120) + '...'
                            : shortDescription;

                        // Determine icon and color based on title keywords
                        let icon = ListChecks;
                        let iconColor = 'text-[#236383]';
                        let bgColor = 'bg-white dark:bg-gray-900';
                        let borderColor =
                          'border-[#236383]/30 dark:border-[#236383]/50';
                        let borderLeftColor = 'border-l-[#236383]';

                        if (
                          title.toLowerCase().includes('contact') ||
                          title.toLowerCase().includes('reach out')
                        ) {
                          icon = Users;
                        } else if (
                          title.toLowerCase().includes('document') ||
                          title.toLowerCase().includes('busy')
                        ) {
                          icon = AlertTriangle;
                          iconColor = 'text-amber-600 dark:text-amber-400';
                          borderLeftColor = 'border-l-amber-500';
                        } else if (
                          title.toLowerCase().includes('reminder') ||
                          title.toLowerCase().includes('follow')
                        ) {
                          icon = Calendar;
                        } else if (
                          title.toLowerCase().includes('confirm') ||
                          title.toLowerCase().includes('verify')
                        ) {
                          icon = CheckCircle2;
                          iconColor = 'text-tsp-teal dark:text-tsp-sky';
                          borderLeftColor = 'border-l-tsp-sky';
                        } else if (
                          title.toLowerCase().includes('refrigeration')
                        ) {
                          icon = AlertCircle;
                          iconColor = 'text-red-600 dark:text-red-400';
                          borderLeftColor = 'border-l-red-500';
                        }

                        const IconComponent = icon;

                        const actionButtons = getActionButtons(
                          title + ' ' + content
                        );

                        return (
                          <div
                            key={idx}
                            className={`${bgColor} border-l-4 ${borderLeftColor} border ${borderColor} rounded-lg shadow-sm hover:shadow-md transition-shadow`}
                          >
                            <div className="p-4">
                              <div className="flex items-start gap-3 mb-3">
                                <div
                                  className={`${iconColor} mt-0.5 flex-shrink-0`}
                                >
                                  <IconComponent className="h-5 w-5" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <h4 className="font-semibold text-base mb-1.5 text-gray-900 dark:text-gray-100">
                                    {title}
                                  </h4>
                                  <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                                    {displayDescription}
                                  </p>
                                </div>
                              </div>

                              {/* Action Buttons - Contact/Note actions only */}
                              {actionButtons.length > 0 && (
                                <div className="flex flex-wrap gap-2 pt-2 border-t border-gray-200 dark:border-gray-700">
                                  {actionButtons.map((btn, btnIdx) => {
                                    const BtnIcon = btn.icon;
                                    return (
                                      <Button
                                        key={btnIdx}
                                        size="sm"
                                        variant={btn.variant}
                                        onClick={btn.action}
                                        className="text-xs h-8"
                                      >
                                        <BtnIcon className="h-3.5 w-3.5 mr-1.5" />
                                        {btn.label}
                                      </Button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              {/* Next Steps */}
              {analysis.nextSteps.length > 0 && (
                <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-900/50">
                  <div className="flex items-center gap-2 mb-4">
                    <ListChecks className="h-5 w-5 text-[#236383]" />
                    <h3 className="font-semibold text-base text-gray-900 dark:text-gray-100">
                      Next Steps
                    </h3>
                  </div>
                  <div className="space-y-3">
                    {analysis.nextSteps.map((step, idx) => {
                      const actionButtons = getActionButtons(step);
                      // Truncate step if too long
                      const displayStep =
                        step.length > 200
                          ? step.substring(0, 200) + '...'
                          : step;

                      return (
                        <div
                          key={idx}
                          className="flex gap-3 items-start pb-3 border-b border-gray-200 dark:border-gray-700 last:border-0 last:pb-0"
                        >
                          <span className="font-semibold text-[#236383] flex-shrink-0 mt-0.5 text-sm w-6">
                            {idx + 1}.
                          </span>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed mb-2">
                              {displayStep}
                            </p>

                            {/* Action Buttons */}
                            {actionButtons.length > 0 && (
                              <div className="flex flex-wrap gap-2">
                                {actionButtons.map((btn, btnIdx) => {
                                  const BtnIcon = btn.icon;
                                  return (
                                    <Button
                                      key={btnIdx}
                                      size="sm"
                                      variant={btn.variant}
                                      onClick={btn.action}
                                      className="text-xs h-8"
                                    >
                                      <BtnIcon className="h-3.5 w-3.5 mr-1.5" />
                                      {btn.label}
                                    </Button>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Critical Issues */}
              {analysis.criticalIssues.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <AlertCircle className="h-5 w-5 text-red-600 dark:text-red-400" />
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                      Critical Issues
                    </h3>
                    <Badge className="bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 text-xs">
                      {analysis.criticalIssues.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {analysis.criticalIssues.map((issue, idx) => (
                      <IssueCard key={idx} issue={issue} />
                    ))}
                  </div>
                </div>
              )}

              {/* Warnings */}
              {analysis.warnings.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <AlertTriangle className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                      Warnings
                    </h3>
                    <Badge className="bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 text-xs">
                      {analysis.warnings.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {analysis.warnings.map((issue, idx) => (
                      <IssueCard key={idx} issue={issue} />
                    ))}
                  </div>
                </div>
              )}

              {/* Suggestions */}
              {analysis.suggestions.length > 0 && (
                <div>
                  <div className="flex items-center gap-2 mb-4">
                    <Lightbulb className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                    <h3 className="font-semibold text-lg text-gray-900 dark:text-gray-100">
                      Suggestions
                    </h3>
                    <Badge className="bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 text-xs">
                      {analysis.suggestions.length}
                    </Badge>
                  </div>
                  <div className="grid gap-3">
                    {analysis.suggestions.map((issue, idx) => (
                      <IssueCard key={idx} issue={issue} />
                    ))}
                  </div>
                </div>
              )}

              {/* All Good Message */}
              {analysis.criticalIssues.length === 0 &&
                analysis.warnings.length === 0 &&
                analysis.suggestions.length === 0 && (
                  <div className="text-center py-8 bg-tsp-sky/15 dark:bg-tsp-navy border border-tsp-sky dark:border-tsp-teal rounded-lg">
                    <CheckCircle2 className="h-12 w-12 text-tsp-teal dark:text-tsp-sky mx-auto mb-3" />
                    <h3 className="font-semibold text-lg text-tsp-teal dark:text-tsp-sky mb-2">
                      All Set!
                    </h3>
                    <p className="text-sm text-tsp-teal dark:text-tsp-sky">
                      All critical information has been collected for this event
                      request.
                    </p>
                  </div>
                )}
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex flex-col sm:flex-row justify-end gap-2 sm:gap-3 pt-4 sm:pt-6 border-t mt-4 sm:mt-6">
            <Button
              variant="outline"
              onClick={handleClose}
              className="w-full sm:w-auto"
            >
              Close
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
