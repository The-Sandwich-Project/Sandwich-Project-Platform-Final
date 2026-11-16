import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { useAuth } from '@/hooks/useAuth';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { PERMISSIONS } from '@shared/auth-utils';
import { hasPermission } from '@shared/unified-auth-utils';
import type { UserForPermissions } from '@shared/types';
import { Shield, Mail, Save, RotateCcw, Loader2, Info, AlertCircle } from 'lucide-react';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';

import { usePageSession } from '@/hooks/usePageSession';
interface EmailTemplateSection {
  id: number;
  templateType: string;
  sectionKey: string;
  sectionLabel: string;
  defaultContent: string;
  currentContent: string | null;
  description: string | null;
  placeholderHints: string | null;
  lastUpdatedBy: string | null;
  lastUpdatedAt: string | null;
  createdAt: string;
}

export default function EmailTemplatesAdmin() {
  // Track page session for activity logging
  usePageSession({
    section: 'Administration',
    page: 'Email Templates',
  });

  const { user, isLoading: authLoading } = useAuth();
  const { toast } = useToast();
  const [editedContents, setEditedContents] = useState<Record<number, string>>({});

  const { data: sections = [], isLoading, error } = useQuery<EmailTemplateSection[]>({
    queryKey: ['/api/email-templates/sections'],
  });

  const updateMutation = useMutation({
    mutationFn: async ({ id, currentContent }: { id: number; currentContent: string }) => {
      return apiRequest('PATCH', `/api/email-templates/sections/${id}`, { currentContent });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/email-templates/sections'] });
      toast({
        title: 'Section updated',
        description: 'Email template section has been saved successfully.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to update section',
        variant: 'destructive',
      });
    },
  });

  const resetMutation = useMutation({
    mutationFn: async (id: number) => {
      return apiRequest('POST', `/api/email-templates/sections/${id}/reset`, {});
    },
    onSuccess: (_, id) => {
      setEditedContents((prev) => {
        const updated = { ...prev };
        delete updated[id];
        return updated;
      });
      queryClient.invalidateQueries({ queryKey: ['/api/email-templates/sections'] });
      toast({
        title: 'Section reset',
        description: 'Email template section has been reset to default.',
      });
    },
    onError: (error: Error) => {
      toast({
        title: 'Error',
        description: error.message || 'Failed to reset section',
        variant: 'destructive',
      });
    },
  });

  const isAdmin = user && (
    user.role === 'admin' ||
    user.role === 'admin_coordinator' ||
    hasPermission(user as UserForPermissions, PERMISSIONS.ADMIN_ACCESS)
  );

  if (authLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    );
  }

  if (!isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white p-8">
        <Card className="w-full max-w-md text-center shadow-lg">
          <CardHeader className="pb-4">
            <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mb-4">
              <Shield className="h-8 w-8 text-red-600" />
            </div>
            <CardTitle className="text-xl font-sub-heading text-gray-900">Access Restricted</CardTitle>
            <CardDescription className="text-base text-gray-600 leading-relaxed">
              You don&apos;t have permission to access email template settings. Contact an
              administrator if you need access.
            </CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const groupedSections = sections.reduce((acc, section) => {
    if (!acc[section.templateType]) {
      acc[section.templateType] = [];
    }
    acc[section.templateType].push(section);
    return acc;
  }, {} as Record<string, EmailTemplateSection[]>);

  const getDisplayContent = (section: EmailTemplateSection) => {
    if (editedContents[section.id] !== undefined) {
      return editedContents[section.id];
    }
    return section.currentContent ?? section.defaultContent;
  };

  const hasChanges = (section: EmailTemplateSection) => {
    const currentDisplay = getDisplayContent(section);
    const defaultOrSaved = section.currentContent ?? section.defaultContent;
    return currentDisplay !== defaultOrSaved;
  };

  const isModifiedFromDefault = (section: EmailTemplateSection) => {
    const effectiveContent = section.currentContent ?? section.defaultContent;
    return section.currentContent !== null && section.currentContent !== section.defaultContent;
  };

  const handleContentChange = (sectionId: number, value: string) => {
    setEditedContents((prev) => ({
      ...prev,
      [sectionId]: value,
    }));
  };

  const handleSave = (section: EmailTemplateSection) => {
    const content = editedContents[section.id] ?? (section.currentContent ?? section.defaultContent);
    updateMutation.mutate({ id: section.id, currentContent: content });
    setEditedContents((prev) => {
      const updated = { ...prev };
      delete updated[section.id];
      return updated;
    });
  };

  const handleReset = (sectionId: number) => {
    resetMutation.mutate(sectionId);
  };

  const formatTemplateType = (templateType: string) => {
    return templateType
      .replace(/_/g, ' ')
      .replace(/\b\w/g, (l) => l.toUpperCase());
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading email templates...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen bg-white p-8">
        <div className="max-w-4xl mx-auto">
          <Card className="border-red-200 bg-red-50">
            <CardHeader>
              <CardTitle className="text-red-700 flex items-center gap-2">
                <AlertCircle className="h-5 w-5" />
                Error Loading Templates
              </CardTitle>
              <CardDescription className="text-red-600">
                {error instanceof Error ? error.message : 'Failed to load email template sections'}
              </CardDescription>
            </CardHeader>
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-white p-8">
      <div className="max-w-5xl mx-auto">
        <PageBreadcrumbs segments={[
          { label: 'Administration' },
          { label: 'Email Templates' }
        ]} />

        <div className="mb-8">
          <div className="flex items-center gap-4 mb-6">
            <div className="p-3 bg-gradient-to-br from-brand-primary to-brand-primary-dark rounded-xl shadow-[0_4px_12px_rgba(35,99,131,0.15),0_2px_4px_rgba(35,99,131,0.1)] hover:shadow-[0_8px_24px_rgba(35,99,131,0.2),0_4px_8px_rgba(35,99,131,0.15)] transition-all duration-300 ease-in-out">
              <Mail className="h-8 w-8 text-white" />
            </div>
            <div>
              <h1 className="text-4xl font-bold text-gray-900 mb-2">
                Email Templates
              </h1>
              <p className="text-lg text-gray-600">
                Customize the text sections used in automated emails
              </p>
            </div>
          </div>
        </div>

        {Object.entries(groupedSections).length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center">
              <Mail className="h-12 w-12 text-gray-400 mx-auto mb-4" />
              <p className="text-gray-600">No email template sections found.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="space-y-8">
            {Object.entries(groupedSections).map(([templateType, templateSections]) => (
              <div key={templateType}>
                <h2 className="text-2xl font-semibold text-gray-800 mb-4 flex items-center gap-2">
                  {formatTemplateType(templateType)}
                  <Badge variant="secondary" className="text-sm font-normal">
                    {templateSections.length} section{templateSections.length !== 1 ? 's' : ''}
                  </Badge>
                </h2>
                
                <div className="space-y-4">
                  {templateSections.map((section) => (
                    <Card 
                      key={section.id} 
                      className={`transition-all duration-200 ${
                        isModifiedFromDefault(section) 
                          ? 'border-amber-300 bg-amber-50/30' 
                          : ''
                      }`}
                      data-testid={`section-card-${section.id}`}
                    >
                      <CardHeader className="pb-3">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <CardTitle className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                              {section.sectionLabel}
                              {isModifiedFromDefault(section) && (
                                <Badge variant="outline" className="bg-amber-100 text-amber-700 border-amber-300">
                                  Modified
                                </Badge>
                              )}
                            </CardTitle>
                            {section.description && (
                              <CardDescription className="mt-1 text-gray-600">
                                {section.description}
                              </CardDescription>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      
                      <CardContent className="space-y-4">
                        {section.placeholderHints && (
                          <div className="flex items-start gap-2 p-3 bg-blue-50 rounded-lg border border-blue-100">
                            <Info className="h-4 w-4 text-blue-600 mt-0.5 flex-shrink-0" />
                            <p className="text-sm text-blue-700">
                              {section.placeholderHints}
                            </p>
                          </div>
                        )}
                        
                        <Textarea
                          value={getDisplayContent(section)}
                          onChange={(e) => handleContentChange(section.id, e.target.value)}
                          className="min-h-[120px] font-mono text-sm resize-y"
                          placeholder="Enter template content..."
                          data-testid={`textarea-${section.id}`}
                        />
                        
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-gray-500">
                            {section.lastUpdatedAt && (
                              <span>
                                Last updated: {new Date(section.lastUpdatedAt).toLocaleDateString()}
                              </span>
                            )}
                          </div>
                          
                          <div className="flex items-center gap-2">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReset(section.id)}
                              disabled={resetMutation.isPending || (!isModifiedFromDefault(section) && !hasChanges(section))}
                              data-testid={`reset-button-${section.id}`}
                            >
                              {resetMutation.isPending && resetMutation.variables === section.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <RotateCcw className="h-4 w-4 mr-1" />
                              )}
                              Reset to Default
                            </Button>
                            
                            <Button
                              size="sm"
                              onClick={() => handleSave(section)}
                              disabled={updateMutation.isPending || !hasChanges(section)}
                              data-testid={`save-button-${section.id}`}
                            >
                              {updateMutation.isPending && updateMutation.variables?.id === section.id ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <Save className="h-4 w-4 mr-1" />
                              )}
                              Save
                            </Button>
                          </div>
                        </div>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
