import React, { useState } from 'react';
import { PageBreadcrumbs } from '@/components/page-breadcrumbs';
import {
  Sparkles,
  Upload,
  FileText,
  Download,
  AlertCircle,
  CheckCircle,
  Info,
} from 'lucide-react';

interface FormResult {
  success?: boolean;
  formType?: string;
  fileName?: string;
  extractedData?: Record<string, string>;
  filledFormUrl?: string | null;
  message?: string;
  error?: string;
}

export function AutoFormFiller() {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [formType, setFormType] = useState<string>('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<FormResult | null>(null);

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      setSelectedFile(file);
      setResult(null);
    }
  };

  const handleProcess = async () => {
    if (!selectedFile || !formType) return;

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('file', selectedFile);
      formData.append('formType', formType);

      const response = await fetch('/api/auto-form-filler/process', {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });

      if (response.ok) {
        const data = await response.json();
        setResult(data);
      } else {
        let errorMessage = 'Failed to process form';
        try {
          const errorData = await response.json();
          if (errorData && errorData.error) {
            errorMessage = errorData.error;
          }
        } catch (e) {
          // Ignore JSON parsing errors and use the default message
        }
        throw new Error(errorMessage);
      }
    } catch (error) {
      console.error('Error processing form:', error);
      setResult({ error: 'Failed to process form. Please try again.' });
    } finally {
      setLoading(false);
    }
  };

  const handleDownload = () => {
    if (!result?.filledFormUrl) return;
    window.open(result.filledFormUrl, '_blank');
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-5xl mx-auto">
        <PageBreadcrumbs
          segments={[
            { label: 'Documentation' },
            { label: 'Auto Form Filler' },
          ]}
        />

        {/* Header */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-4">
            <div className="bg-[#236383]/10 p-3 rounded-lg">
              <Sparkles className="w-8 h-8 text-[#236383]" />
            </div>
            <div>
              <h1 className="text-3xl font-bold text-gray-900">
                Auto Form Filler
              </h1>
              <p className="text-gray-600 mt-1">
                Automatically fill out forms using AI-powered data extraction
              </p>
            </div>
          </div>

          {/* Info Banner */}
          <div className="bg-[#47B3CB]/10 border border-[#47B3CB]/30 rounded-lg p-4 flex gap-3">
            <Info className="w-5 h-5 text-[#47B3CB] flex-shrink-0 mt-0.5" />
            <div className="text-sm text-gray-700">
              <p className="font-medium mb-1">How it works:</p>
              <ol className="list-decimal list-inside space-y-1">
                <li>Upload a form template (PDF or Word document)</li>
                <li>Select the type of form you want to fill</li>
                <li>The AI will automatically extract and fill in the required information</li>
                <li>Download the completed form</li>
              </ol>
            </div>
          </div>
        </div>

        {/* Main Content */}
        <div className="bg-white rounded-lg shadow-sm p-6">
          <div className="space-y-6">
            {/* File Upload */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Upload Form Template
              </label>
              <div className="border-2 border-dashed border-gray-300 rounded-lg p-8 text-center hover:border-[#236383] transition-colors">
                <Upload className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <input
                  type="file"
                  id="file-upload"
                  className="hidden"
                  accept=".pdf,.doc,.docx"
                  onChange={handleFileUpload}
                />
                <label
                  htmlFor="file-upload"
                  className="cursor-pointer inline-block"
                >
                  <span className="bg-[#236383] text-white px-4 py-2 rounded-lg hover:bg-[#236383] transition-colors inline-block">
                    Choose File
                  </span>
                </label>
                {selectedFile && (
                  <p className="mt-3 text-sm text-gray-600 flex items-center justify-center gap-2">
                    <FileText className="w-4 h-4" />
                    {selectedFile.name}
                  </p>
                )}
              </div>
            </div>

            {/* Form Type Selection */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Form Type
              </label>
              <select
                value={formType}
                onChange={(e) => setFormType(e.target.value)}
                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-[#236383]"
              >
                <option value="">Select a form type...</option>
                <option value="service_hours">Service Hours Form</option>
                <option value="event_request">Event Request Form</option>
                <option value="volunteer_application">Volunteer Application</option>
                <option value="host_agreement">Host Agreement</option>
                <option value="grant_application">Grant Application</option>
                <option value="custom">Custom Form</option>
              </select>
            </div>

            {/* Action Buttons */}
            <div className="flex gap-4">
              <button
                onClick={handleProcess}
                disabled={!selectedFile || !formType || loading}
                className={`flex-1 px-6 py-3 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 ${
                  !selectedFile || !formType || loading
                    ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                    : 'bg-[#236383] text-white hover:bg-[#236383]'
                }`}
              >
                {loading ? (
                  <>
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white"></div>
                    Processing...
                  </>
                ) : (
                  <>
                    <Sparkles className="w-5 h-5" />
                    Fill Form
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Results */}
        {result && (
          <div className="mt-6 bg-white rounded-lg shadow-sm p-6">
            {result.error ? (
              <div className="flex items-start gap-3 text-red-700">
                <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                <div>
                  <h3 className="font-semibold mb-1">Error</h3>
                  <p className="text-sm">{result.error}</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div className="flex items-start gap-3 text-[#236383]">
                  <CheckCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
                  <div>
                    <h3 className="font-semibold mb-1">Form Filled Successfully!</h3>
                    <p className="text-sm text-gray-600">
                      Your form has been automatically filled with the extracted information.
                    </p>
                  </div>
                </div>

                {/* Extracted Data Preview */}
                {result.extractedData && (
                  <div className="border border-gray-200 rounded-lg p-4">
                    <h4 className="font-medium text-gray-900 mb-2">
                      Extracted Information:
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {Object.entries(result.extractedData).map(
                        ([key, value]) => (
                          <div key={key} className="text-sm">
                            <span className="font-medium text-gray-700">
                              {key}:
                            </span>{' '}
                            <span className="text-gray-600">{value as string}</span>
                          </div>
                        )
                      )}
                    </div>
                  </div>
                )}

                {/* Download Button */}
                <button
                  onClick={handleDownload}
                  disabled={!result?.filledFormUrl}
                  className={`px-6 py-3 rounded-lg transition-colors flex items-center justify-center gap-2 w-full ${
                    !result?.filledFormUrl
                      ? 'bg-gray-200 text-gray-500 cursor-not-allowed'
                      : 'bg-[#236383] text-white hover:bg-[#236383]'
                  }`}
                >
                  <Download className="w-5 h-5" />
                  Download Filled Form
                </button>
              </div>
            )}
          </div>
        )}

        {/* Supported Form Types Info */}
        <div className="mt-6 bg-white rounded-lg shadow-sm p-6">
          <h3 className="font-semibold text-gray-900 mb-4">
            Supported Form Types
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[
              {
                name: 'Service Hours Form',
                description: 'Track volunteer service hours',
              },
              {
                name: 'Event Request Form',
                description: 'Request new events or presentations',
              },
              {
                name: 'Volunteer Application',
                description: 'New volunteer registration',
              },
              {
                name: 'Host Agreement',
                description: 'Host location partnership forms',
              },
              {
                name: 'Grant Application',
                description: 'Grant and funding applications',
              },
              {
                name: 'Custom Form',
                description: 'Any other custom form template',
              },
            ].map((type) => (
              <div
                key={type.name}
                className="border border-gray-200 rounded-lg p-4 hover:border-[#236383] transition-colors"
              >
                <h4 className="font-medium text-gray-900 mb-1">{type.name}</h4>
                <p className="text-sm text-gray-600">{type.description}</p>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
