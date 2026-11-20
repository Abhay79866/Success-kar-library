'use client';

import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    let readable = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(error.message) as { error?: string; operationType?: string; path?: string };
      if (parsed && parsed.error) {
        readable = `Database ${parsed.operationType || 'operation'} failed on ${parsed.path || 'record'}: ${parsed.error}`;
      }
    } catch {
      // keep original message
    }
    return { hasError: true, errorMessage: readable };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen bg-[#FDFBF7] text-[#2C2A29] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#F4EFEA] border border-[#E4DDD5] rounded-lg p-8 space-y-4">
            <h1 className="font-serif text-2xl font-semibold text-[#2C2A29]">
              Something went wrong
            </h1>
            <p className="text-sm text-[#6E6762] leading-relaxed">
              {this.state.errorMessage}
            </p>
            <Button
              onClick={() => {
                this.setState({ hasError: false, errorMessage: '' });
                window.location.reload();
              }}
              className="bg-[#D9775B] hover:bg-[#C46348] text-[#FDFBF7]"
            >
              Reload Console
            </Button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
