"use client";

import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('ErrorBoundary caught an error:', error, errorInfo);
  }

  private handleReset = () => {
    this.setState({ hasError: false, error: undefined });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      // Check if error is related to missing environment variables
      const isEnvVarError = this.state.error?.message?.includes('environment variable') || 
                           this.state.error?.message?.includes('NEXT_PUBLIC_SUPABASE');
      const isDevelopment = process.env.NODE_ENV === 'development';

      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50">
          <div className="max-w-md w-full bg-white rounded-lg shadow-lg p-8 text-center">
            <AlertCircle className="h-16 w-16 text-red-500 mx-auto mb-4" />
            <h1 className="text-2xl font-semibold text-gray-900 mb-2">
              {isEnvVarError ? 'Configuration Required' : 'Something went wrong'}
            </h1>
            <p className="text-gray-600 mb-6">
              {isEnvVarError && isDevelopment ? (
                <>
                  Missing Supabase environment variables. Please create a <code className="bg-gray-100 px-2 py-1 rounded text-sm">.env.local</code> file in the <code className="bg-gray-100 px-2 py-1 rounded text-sm">expert_dashboard</code> directory with:
                  <div className="mt-4 text-left bg-gray-50 p-4 rounded text-sm font-mono">
                    <div>NEXT_PUBLIC_SUPABASE_URL=your-url</div>
                    <div>NEXT_PUBLIC_SUPABASE_ANON_KEY=your-key</div>
                  </div>
                  <div className="mt-4 text-sm text-gray-500">
                    Get these values from your Supabase project: Settings → API
                  </div>
                </>
              ) : (
                'We&apos;re sorry, but something unexpected happened. Please try refreshing the page.'
              )}
            </p>
            <div className="space-y-3">
              <Button 
                onClick={this.handleReset}
                className="w-full"
              >
                <RefreshCw className="h-4 w-4 mr-2" />
                Try Again
              </Button>
              <Button 
                variant="outline" 
                onClick={() => window.location.href = '/login'}
                className="w-full"
              >
                Go to Login
              </Button>
            </div>
            {process.env.NODE_ENV === 'development' && this.state.error && (
              <details className="mt-6 text-left">
                <summary className="cursor-pointer text-sm text-gray-500 hover:text-gray-700">
                  Error Details (Development)
                </summary>
                <pre className="mt-2 text-xs text-red-600 bg-red-50 p-2 rounded overflow-auto">
                  {this.state.error.stack}
                </pre>
              </details>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;