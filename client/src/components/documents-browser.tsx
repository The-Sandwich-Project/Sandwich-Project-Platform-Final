import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Download, FileText, FileSpreadsheet, File, Eye, ExternalLink } from "lucide-react";
import { DocumentPreview } from "./document-preview";

interface DocumentFile {
  name: string;
  path: string;
  type: 'pdf' | 'xlsx' | 'docx' | 'txt' | 'other';
  category: string;
  description?: string;
}

const documentFiles: DocumentFile[] = [
  {
    name: "Summer Food Safety Guidelines",
    path: "/attached_assets/Summer Food Safety Guidelines_1751569876472.pdf",
    type: "pdf",
    category: "Safety",
    description: "Important summer food safety guidelines for home hosts"
  },
  {
    name: "Food Safety Volunteers Guide",
    path: "/attached_assets/20260506-TSP-Food+Safety+Volunteers.pdf",
    type: "pdf",
    category: "Training",
    description: "Essential food safety guidelines for all volunteers"
  },
  {
    name: "Deli Sandwich Making 101",
    path: "/attached_assets/Deli Sandwich Making 101 03172026.pdf",
    type: "pdf",
    category: "Training",
    description: "Step-by-step guide for preparing deli sandwiches"
  },
  {
    name: "PBJ Sandwich Making 101",
    path: "/attached_assets/PBJ Sandwich Making 2 101 11012026.pdf",
    type: "pdf", 
    category: "Training",
    description: "Instructions for peanut butter and jelly sandwich preparation"
  },
  {
    name: "Deli Labels",
    path: "/attached_assets/Deli Labels_1756865384146.pdf",
    type: "pdf",
    category: "Resources",
    description: "Printable labels for deli sandwich packaging"
  },
  {
    name: "PBJ Labels", 
    path: "/attached_assets/PBJ Labels_1756865384146.pdf",
    type: "pdf",
    category: "Resources",
    description: "Printable labels for PBJ sandwich packaging"
  },
  {
    name: "Sandwich Inventory List",
    path: "/attached_assets/TSP Sandwich Inventory List for 3 ozs_1749341916237.xlsx",
    type: "xlsx",
    category: "Operations",
    description: "Inventory tracking spreadsheet for 3oz sandwich portions"
  }
];

const getFileIcon = (type: string) => {
  switch (type) {
    case 'pdf':
      return <FileText className="h-5 w-5 text-red-500" />;
    case 'xlsx':
      return <FileSpreadsheet className="h-5 w-5 text-green-500" />;
    case 'docx':
      return <FileText className="h-5 w-5 text-blue-500" />;
    case 'txt':
      return <File className="h-5 w-5 text-gray-500" />;
    default:
      return <File className="h-5 w-5 text-gray-500" />;
  }
};

const getCategoryColor = (category: string) => {
  switch (category) {
    case 'Training':
      return 'bg-brand-primary-light text-brand-primary-dark';
    case 'Legal':
      return 'bg-purple-100 text-purple-800';
    case 'Resources':
      return 'bg-green-100 text-green-800';
    case 'Operations':
      return 'bg-orange-100 text-orange-800';
    case 'Safety':
      return 'bg-red-100 text-red-800';
    default:
      return 'bg-gray-100 text-gray-800';
  }
};

export function DocumentsBrowser() {
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [previewDocument, setPreviewDocument] = useState<DocumentFile | null>(null);

  const categories = ['All', ...Array.from(new Set(documentFiles.map(doc => doc.category)))];
  
  const filteredDocs = selectedCategory === 'All' 
    ? documentFiles 
    : documentFiles.filter(doc => doc.category === selectedCategory);

  const handleDownload = async (path: string, name: string) => {
    try {
      const response = await fetch(path);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Download failed:', error);
      window.open(path, '_blank');
    }
  };

  const handlePreview = (doc: DocumentFile) => {
    setPreviewDocument(doc);
  };

  const handleOpenInNewTab = (path: string) => {
    window.open(path, '_blank');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Document Library</h2>
          <p className="text-muted-foreground">
            Training materials, forms, and resources for The Sandwich Project
          </p>
        </div>
        
        <div className="flex flex-wrap gap-2">
          {categories.map((category) => (
            <Button
              key={category}
              variant={selectedCategory === category ? "default" : "outline"}
              size="sm"
              onClick={() => setSelectedCategory(category)}
            >
              {category}
            </Button>
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {filteredDocs.map((doc, index) => (
          <Card key={index} className="hover:shadow-md transition-shadow">
            <CardHeader className="pb-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  {getFileIcon(doc.type)}
                  <CardTitle className="text-base leading-tight">{doc.name}</CardTitle>
                </div>
                <Badge className={getCategoryColor(doc.category)} variant="secondary">
                  {doc.category}
                </Badge>
              </div>
              {doc.description && (
                <CardDescription className="text-sm">
                  {doc.description}
                </CardDescription>
              )}
            </CardHeader>
            <CardContent className="pt-0">
              <div className="flex gap-2 mb-2">
                <Button 
                  onClick={() => handlePreview(doc)}
                  className="flex-1"
                  variant="outline"
                  size="sm"
                >
                  <Eye className="h-4 w-4 mr-2" />
                  Preview
                </Button>
                <Button 
                  onClick={() => handleDownload(doc.path, doc.name)}
                  className="flex-1"
                  size="sm"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download
                </Button>
              </div>
              <Button 
                onClick={() => handleOpenInNewTab(doc.path)}
                className="w-full"
                variant="ghost"
                size="sm"
              >
                <ExternalLink className="h-4 w-4 mr-2" />
                Open in New Tab
              </Button>
            </CardContent>
          </Card>
        ))}
      </div>

      {filteredDocs.length === 0 && (
        <div className="text-center py-12">
          <FileText className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
          <h3 className="text-lg font-medium text-muted-foreground">No documents found</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Try selecting a different category
          </p>
        </div>
      )}

      {previewDocument && (
        <DocumentPreview
          documentPath={previewDocument.path}
          documentName={previewDocument.name}
          documentType={previewDocument.type}
          onClose={() => setPreviewDocument(null)}
        />
      )}
    </div>
  );
}