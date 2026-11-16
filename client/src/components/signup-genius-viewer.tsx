import { useState, useEffect } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  ExternalLink,
  Calendar,
  Users,
  Clock,
  AlertCircle,
} from 'lucide-react';

import { usePageSession } from '@/hooks/usePageSession';
export default function SignUpGeniusViewer() {
  // Track page session for activity logging
  usePageSession({
    section: 'Resources',
    page: 'SignUpGenius',
  });

  const signupUrl =
    'https://www.signupgenius.com/go/5080A4BA5AA22A7F94-50444894-thesandwich#/';
  // SignUp Genius blocks iframe embedding, so show fallback immediately
  const [iframeError, setIframeError] = useState(true);

  const handleOpenExternal = () => {
    window.open(signupUrl, '_blank');
  };

  const handleIframeError = () => {
    setIframeError(true);
  };

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <Card className="flex-1 flex flex-col h-full">
        <CardHeader className="pb-4 px-6 py-4">
          <div className="flex items-center justify-between mb-4">
            <CardTitle className="text-2xl font-bold text-gray-900 flex items-center gap-3">
              <div className="w-10 h-10 bg-brand-primary-light rounded-lg flex items-center justify-center">
                <Users className="h-5 w-5 text-brand-primary" />
              </div>
              SignUp Genius
            </CardTitle>
          </div>
        </CardHeader>

        <CardContent className="flex-1 p-6">
          {/* Always show fallback since SignUp Genius blocks embedding */}
          {
            <div className="flex flex-col items-center justify-center h-full bg-white rounded-lg border-2 border-dashed border-gray-300 p-8">
              <div className="w-16 h-16 bg-brand-primary-light rounded-lg flex items-center justify-center mb-4">
                <Users className="h-8 w-8 text-brand-primary" />
              </div>

              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                SignUp Genius
              </h3>

              <p className="text-gray-600 text-center mb-6 max-w-md">
                Access SignUp Genius to register for events, choose time slots,
                and track your volunteer hours.
              </p>

              <Button
                onClick={handleOpenExternal}
                className="flex items-center gap-2 bg-brand-primary hover:bg-brand-primary-dark"
                size="lg"
              >
                <ExternalLink className="h-5 w-5" />
                Open SignUp Genius
              </Button>

              <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-4 w-full max-w-2xl">
                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <Calendar className="h-6 w-6 text-brand-primary mx-auto mb-2" />
                  <div className="font-medium text-gray-900">Event Signup</div>
                  <div className="text-sm text-gray-600">
                    Register for upcoming events
                  </div>
                </div>

                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <Users className="h-6 w-6 text-green-600 mx-auto mb-2" />
                  <div className="font-medium text-gray-900">
                    Volunteer Slots
                  </div>
                  <div className="text-sm text-gray-600">
                    Choose your preferred times
                  </div>
                </div>

                <div className="text-center p-4 bg-gray-50 rounded-lg">
                  <Clock className="h-6 w-6 text-purple-600 mx-auto mb-2" />
                  <div className="font-medium text-gray-900">Time Tracking</div>
                  <div className="text-sm text-gray-600">
                    Log volunteer hours
                  </div>
                </div>
              </div>
            </div>
          }
        </CardContent>
      </Card>
    </div>
  );
}
