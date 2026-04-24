"use client";

import { Component, type ErrorInfo, type ReactNode } from "react";
import { AssistantCoachMessageBody } from "./AssistantCoachMessageBody";

type Props = {
  content: string;
  children: ReactNode;
};

type State = { hasError: boolean };

/**
 * Prevents a bad structured parse / render from blanking the thread.
 * Falls back to plain coaching body (same as unstructured messages).
 */
export class AssistantStructuredMessageBoundary extends Component<
  Props,
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    if (process.env.NODE_ENV === "development") {
      // eslint-disable-next-line no-console
      console.error("[AssistantStructuredMessageBoundary]", error, info.componentStack);
    }
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return <AssistantCoachMessageBody content={this.props.content} />;
    }
    return this.props.children;
  }
}
