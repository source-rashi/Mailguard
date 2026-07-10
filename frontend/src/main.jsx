/**
 * Main Entry Point
 * This file initializes the React application with Clerk authentication
 * Dark mode is forced globally for professional SaaS aesthetic
 */

import { StrictMode, useEffect } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/clerk-react'
import { Toaster } from '@/components/ui/sonner'
import ErrorBoundary from './components/ErrorBoundary'
import ClerkTokenBridge from './components/auth/ClerkTokenBridge'
import './index.css'
import App from './App.jsx'

// Get Clerk publishable key from environment
const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

const isPlaceholderKey = (key = '') => {
  const normalizedKey = key.toLowerCase()
  return (
    normalizedKey.includes('your_') ||
    normalizedKey.includes('placeholder') ||
    normalizedKey.endsWith('_here')
  )
}

const clerkKeyError = !PUBLISHABLE_KEY
  ? 'Missing Clerk Publishable Key. Add VITE_CLERK_PUBLISHABLE_KEY to .env.'
  : !PUBLISHABLE_KEY.startsWith('pk_test_') && !PUBLISHABLE_KEY.startsWith('pk_live_')
    ? 'Invalid Clerk Publishable Key format. It must start with pk_test_ or pk_live_.'
    : isPlaceholderKey(PUBLISHABLE_KEY)
      ? 'Replace the placeholder Clerk key in .env with your real Clerk publishable key.'
      : ''

// Dark mode wrapper component
function DarkModeApp() {
  useEffect(() => {
    // Force dark mode on mount and ensure it persists
    document.documentElement.classList.add('dark')
  }, [])

  return (
    <ErrorBoundary>
      <ClerkTokenBridge />
      <App />
      <Toaster position="top-right" richColors closeButton expand visibleToasts={5} />
    </ErrorBoundary>
  )
}

function ClerkSetupRequired({ message }) {
  useEffect(() => {
    document.documentElement.classList.add('dark')
  }, [])

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex items-center justify-center px-6">
      <section className="w-full max-w-xl rounded-lg border border-slate-800 bg-slate-900 p-6 shadow-xl">
        <p className="text-sm font-medium uppercase tracking-wider text-blue-400">Clerk setup required</p>
        <h1 className="mt-3 text-2xl font-bold text-white">Add a supported Clerk publishable key</h1>
        <p className="mt-3 text-slate-300">{message}</p>
        <div className="mt-5 rounded-md border border-slate-800 bg-slate-950 p-4 font-mono text-sm text-slate-200">
          VITE_CLERK_PUBLISHABLE_KEY=pk_test_your_real_key
        </div>
        <p className="mt-4 text-sm text-slate-400">
          Get it from Clerk Dashboard: API Keys, then restart the frontend dev server.
        </p>
      </section>
    </main>
  )
}

const root = createRoot(document.getElementById('root'))

if (clerkKeyError) {
  root.render(
    <StrictMode>
      <ClerkSetupRequired message={clerkKeyError} />
    </StrictMode>,
  )
} else {
  root.render(
    <StrictMode>
      <ClerkProvider
        publishableKey={PUBLISHABLE_KEY}
        appearance={{
          baseTheme: undefined, // Use our custom dark theme
          variables: {
            colorPrimary: '#3b82f6', // blue-500
            colorBackground: '#1e293b', // slate-800
            colorInputBackground: '#0f172a', // slate-900
            colorInputText: '#f1f5f9', // slate-100
            colorText: '#f1f5f9', // slate-100
            colorTextSecondary: '#94a3b8', // slate-400
            borderRadius: '0.75rem',
          },
          elements: {
            rootBox: 'bg-transparent',
            card: 'bg-slate-800 border border-slate-700/50 shadow-xl rounded-xl',
            cardBox: 'shadow-none',
            headerTitle: 'text-slate-100 font-bold text-2xl',
            headerSubtitle: 'text-slate-400',
            formFieldLabel: 'text-slate-300 font-medium',
            formFieldInput: 'bg-slate-900 border-slate-700 text-slate-100 placeholder:text-slate-500 focus:border-blue-500 focus:ring-blue-500/20 rounded-lg',
            formButtonPrimary: 'bg-blue-600 hover:bg-blue-700 text-white font-semibold shadow-md rounded-lg',
            footerActionLink: 'text-blue-500 hover:text-blue-400 font-medium',
            footerActionText: 'text-slate-400',
            socialButtonsBlockButton: 'bg-slate-900 hover:bg-slate-800 border border-slate-700 text-slate-100 rounded-lg',
            socialButtonsBlockButtonText: '!text-slate-100 font-medium',
            socialButtonsBlockButtonArrow: 'hidden',
            dividerLine: 'bg-slate-700',
            dividerText: 'text-slate-500',
          },
          layout: {
            logoPlacement: 'inside',
            shimmer: false,
          }
        }}
      >
        <DarkModeApp />
      </ClerkProvider>
    </StrictMode>,
  )
}
