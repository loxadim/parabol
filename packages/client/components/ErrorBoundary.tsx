import * as Sentry from '@sentry/browser'
import React, {Component, ErrorInfo, ReactNode} from 'react'
import {setIsErrorProne} from '~/utils/errorProne'
import ErrorComponent from './ErrorComponent/ErrorComponent'
import LogRocketManager from '~/utils/LogRocketManager'

interface Props {
  fallback?: (error: Error, eventId: string) => ReactNode
  children: ReactNode
}

interface State {
  error?: Error
  errorInfo?: ErrorInfo
  eventId?: string
}

class ErrorBoundary extends Component<Props, State> {
  state: State = {
    error: undefined,
    errorInfo: undefined,
    eventId: undefined
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    const logRocket = LogRocketManager.getInstance()
    if (logRocket) {
      setIsErrorProne()
      logRocket.captureException(error)
      logRocket.track('Fatal error')
    }
    // Catch errors in any components below and re-render with error message
    Sentry.withScope((scope) => {
      scope.setExtras(errorInfo as any)
      scope.setLevel(Sentry.Severity.Fatal)
      const eventId = Sentry.captureException(error)
      this.setState({
        error,
        errorInfo,
        eventId
      })
    })
  }

  render() {
    const {error, eventId} = this.state
    if (error && eventId) {
      const {fallback} = this.props
      return fallback ? (
        fallback(error, eventId)
      ) : (
        <ErrorComponent error={error} eventId={eventId} />
      )
    }
    // Normally, just render children
    return this.props.children
  }
}

export default ErrorBoundary
