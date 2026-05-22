"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";

interface TweetErrorBoundaryProps {
  children: ReactNode;
  fallback: ReactNode;
  resetKey?: string;
}

interface TweetErrorBoundaryState {
  hasError: boolean;
}

export class TweetErrorBoundary extends Component<TweetErrorBoundaryProps, TweetErrorBoundaryState> {
  state: TweetErrorBoundaryState = { hasError: false };

  static getDerivedStateFromError(): TweetErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("TweetCard render failed", error, errorInfo);
  }

  componentDidUpdate(prevProps: TweetErrorBoundaryProps) {
    if (prevProps.resetKey !== this.props.resetKey && this.state.hasError) {
      this.setState({ hasError: false });
    }
  }

  render() {
    if (this.state.hasError) {
      return this.props.fallback;
    }

    return this.props.children;
  }
}
