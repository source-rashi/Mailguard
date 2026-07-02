/**
 * DASHBOARD PAGE
 * Main dashboard view after login
 * 
 * Performance Optimizations:
 * - Lazy loading of heavy components (EmailTable, EmailStatsChart)
 * - Suspense boundaries for progressive rendering
 * - Optimized re-renders with useMemo and useCallback
 */

import { useState, useEffect, lazy, Suspense } from 'react'
import { useUser, useClerk } from '@clerk/clerk-react'
import { toast } from 'sonner'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { getEmailStats, getEmails, deleteEmail, bulkDeleteEmails, cleanPhishingEmails, clearAllEmails, submitFeedback, initiateGmailAuth, fetchGmailEmails, classifyEmails, migrateEmails, getMigrationStatus, getFeedback, triggerRetrain, getRetrainStatus, getAutoDeletePreferences, updateAutoDeletePreferences } from '../services/api'
import api from '../services/api'

// Lazy load heavy components for better initial load performance
const EmailTable = lazy(() => import('../components/EmailTable'))
const EmailStatsChart = lazy(() => import('../components/EmailStatsChart'))

// Eager load lightweight components
import StatsCard from '../components/StatsCard'
import { Mail, ShieldAlert, CheckCircle2, HardDrive } from 'lucide-react'

// Component loading fallback
function ComponentLoader() {
  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
      <div className="animate-pulse space-y-4">
        <div className="h-8 bg-slate-700 rounded w-1/4"></div>
        <div className="space-y-3">
          <div className="h-4 bg-slate-700 rounded"></div>
          <div className="h-4 bg-slate-700 rounded w-5/6"></div>
          <div className="h-4 bg-slate-700 rounded w-4/6"></div>
        </div>
      </div>
    </div>
  )
}

function Dashboard() {
  const { user } = useUser()
  const { signOut } = useClerk()
  const displayName = user?.fullName || user?.primaryEmailAddress?.emailAddress || 'User'
  
  // Stats state
  const [stats, setStats] = useState({
    total: 0,
    phishing: 0,
    safe: 0
  })
  const [statsLoading, setStatsLoading] = useState(true)
  const [error, setError] = useState('')
  
  // Storage stats state
  const [storageSaved, setStorageSaved] = useState({
    emailsDeleted: 0,
    mbSaved: 0
  })

  // Emails state
  const [emails, setEmails] = useState([])
  const [emailsLoading, setEmailsLoading] = useState(true)
  
  // Multi-select state
  const [selectedEmails, setSelectedEmails] = useState([])
  
  // Gmail connection state
  const [fetchingEmails, setFetchingEmails] = useState(false)
  const [gmailConnected, setGmailConnected] = useState(false)

  // Auto‑delete preferences state
  const [autoDeleteEnabled, setAutoDeleteEnabled] = useState(false)
  const [retentionDays, setRetentionDays] = useState(30)
  const [prefLoading, setPrefLoading] = useState(true)

  // Migration state
  const [migrationNeeded, setMigrationNeeded] = useState(false)
  const [migrationCount, setMigrationCount] = useState(0)
  const [migrationLoading, setMigrationLoading] = useState(true)
  const [migrating, setMigrating] = useState(false)

  // Filter and pagination state
  const [filters, setFilters] = useState({
    page: 1,
    limit: 50,
    prediction: '',
    search: '',
    dateFrom: '',
    dateTo: '',
    sortBy: 'receivedAt',
    sortOrder: 'desc'
  })
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 50,
    total: 0,
    totalPages: 0,
    hasNext: false,
    hasPrev: false
  })

  // Gmail fetch options state
  const [gmailFetchOptions, setGmailFetchOptions] = useState({
    maxResults: 50,
    dateFrom: '',
    dateTo: '',
    query: '',
    fetchAll: false,
    timeRange: '7d' // Default to last 7 days for better results
  })
  const [showFetchOptions, setShowFetchOptions] = useState(false)

  // Reinforcement learning / feedback state
  const [feedbackStats, setFeedbackStats] = useState({
    count: 0,
    loading: true
  })
  const [retraining, setRetraining] = useState(false)

  // Confirmation dialog state
  const [confirmDialog, setConfirmDialog] = useState({
    open: false,
    title: '',
    description: '',
    onConfirm: null,
    variant: 'destructive' // or 'default'
  })

  const openConfirmDialog = ({ title, description, onConfirm, variant = 'destructive' }) => {
    setConfirmDialog({
      open: true,
      title,
      description,
      onConfirm,
      variant
    })
  }

  // Fetch stats, emails, and preferences on component mount
  useEffect(() => {
    fetchStats()
    fetchEmails()
    checkGmailConnection()
    checkMigrationStatus()
    fetchFeedbackStats() // NEW: Load feedback stats

    // Load auto‑delete preferences
    const loadPrefs = async () => {
      try {
        setPrefLoading(true)
        const data = await getAutoDeletePreferences()
        setAutoDeleteEnabled(data.enabled)
        setRetentionDays(data.retentionDays)
      } catch (err) {
        toast.error('Failed to load auto‑delete preferences')
      } finally {
        setPrefLoading(false)
      }
    }
    loadPrefs()
    
    // Check for Gmail connection status in URL
    const urlParams = new URLSearchParams(window.location.search)
    const gmailStatus = urlParams.get('gmail')
    
    if (gmailStatus === 'connected') {
      toast.success('Gmail connected successfully! You can now fetch emails.')
      setGmailConnected(true)
      // Clean URL
      window.history.replaceState({}, '', '/dashboard')
    } else if (gmailStatus === 'error') {
      const errorMessage = urlParams.get('message') || 'Failed to connect Gmail'
      toast.error(errorMessage)
      // Clean URL
      window.history.replaceState({}, '', '/dashboard')
    }
  }, [])

  const fetchStats = async () => {
    try {
      setStatsLoading(true)
      setError('')
      const response = await getEmailStats()
      
      // Update stats from API response
      setStats({
        total: response.total || 0,
        phishing: response.phishing || 0,
        safe: response.safe || response.legitimate || 0
      })
      
      console.log('✅ Stats loaded:', response)
    } catch (err) {
      console.error('❌ Failed to load stats:', err)
      setError('Failed to load statistics')
    } finally {
      setStatsLoading(false)
    }
  }

  const fetchEmails = async (customFilters = {}) => {
    try {
      setEmailsLoading(true)
      const params = { ...filters, ...customFilters }
      const response = await getEmails(params)
      
      // Handle different response formats
      const emailList = response.emails || response.data || response || []
      setEmails(emailList)
      
      // Update pagination info if provided
      if (response.pagination) {
        setPagination(response.pagination)
      }
      
      console.log('✅ Emails loaded:', emailList.length, 'emails')
    } catch (err) {
      console.error('❌ Failed to load emails:', err)
      setEmails([])
      toast.error('Failed to load emails. Please try refreshing the page.')
    } finally {
      setEmailsLoading(false)
    }
  }
  
  const checkGmailConnection = async () => {
    try {
     const API_BASE = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5000/api'

const response = await fetch(`${API_BASE}/gmail/status`, {
        headers: {
          'Authorization': `Bearer ${await window.Clerk.session?.getToken()}`
        }
      })
      const data = await response.json()
      setGmailConnected(data.data?.gmailConnected || false)
    } catch (err) {
      console.error('❌ Failed to check Gmail status:', err)
      setGmailConnected(false)
      // Don't show toast for this - it's checked on load and shouldn't be intrusive
    }
  }

  const checkMigrationStatus = async () => {
    try {
      setMigrationLoading(true)
      const response = await getMigrationStatus()
      setMigrationNeeded(response.needsMigration === true)
      
      if (response.needsMigration) {
        setMigrationCount(response.emailCounts?.otherUsers || 0)
        console.log('⚠️ Migration needed:', response.emailCounts?.otherUsers, 'emails')
      }
    } catch (err) {
      console.error('❌ Failed to check migration status:', err)
      toast.error('Failed to check account migration status.')
    } finally {
      setMigrationLoading(false)
    }
  }

  const fetchFeedbackStats = async () => {
    try {
      setFeedbackStats(prev => ({ ...prev, loading: true }))
      const response = await getFeedback()
      setFeedbackStats({
        count: response.count || 0,
        loading: false
      })
      console.log('✅ Feedback stats loaded:', response.count, 'feedbacks')
    } catch (err) {
      console.error('❌ Failed to load feedback stats:', err)
      setFeedbackStats({ count: 0, loading: false })
    }
  }

  const handleRetrain = async () => {
    if (feedbackStats.count === 0) {
      toast.error('No feedback data available. Please submit feedback on email classifications first.')
      return
    }

    openConfirmDialog({
      title: 'Retrain AI Model',
      description: `Retrain the AI model with ${feedbackStats.count} feedback entries? This may take a few minutes.`,
      variant: 'default',
      onConfirm: async () => {
        try {
          setRetraining(true)
          toast.info('Starting model retraining... This may take 2-5 minutes.')
          
          const response = await triggerRetrain()
          
          console.log('✅ Retrain complete:', response)
          toast.success('AI model retrained successfully! The model will now be more accurate.')
          
          // Optionally refresh stats
          await fetchFeedbackStats()
        } catch (err) {
          console.error('❌ Failed to retrain model:', err)
          const errorMsg = err.response?.data?.error || err.message || 'Failed to retrain model'
          toast.error(errorMsg)
        } finally {
          setRetraining(false)
        }
      }
    })
  }

  const handleMigrateEmails = async () => {
    openConfirmDialog({
      title: 'Migrate Emails',
      description: 'This will update all existing emails to belong to your account. Continue?',
      onConfirm: async () => {
        try {
          setMigrating(true)
          const response = await migrateEmails()
          
          console.log('✅ Migration complete:', response)
          toast.success(`Successfully migrated ${response.updated} emails to your account!`)
          
          // Refresh everything
          setMigrationNeeded(false)
          setMigrationCount(0)
          await fetchStats()
          await fetchEmails()
        } catch (err) {
          console.error('❌ Migration failed:', err)
          toast.error('Failed to migrate emails. Please try again.')
        } finally {
          setMigrating(false)
        }
      }
    })
  }

  const handleDelete = async (emailId) => {
    // Show confirmation dialog
    openConfirmDialog({
      title: 'Delete Email',
      description: 'Are you sure you want to delete this email? This action cannot be undone.',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          await deleteEmail(emailId)
          console.log('✅ Email deleted:', emailId)
          toast.success('Email deleted successfully')
          
          // Refresh emails and stats
          fetchEmails()
          fetchStats()
        } catch (err) {
          console.error('❌ Failed to delete email:', err)
          toast.error('Failed to delete email. Please try again.')
        }
      }
    })
  }

  const handleFeedback = async (emailId, type) => {
    try {
      // Find the email
      const email = emails.find(e => e._id === emailId)
      console.log('📧 Email for feedback:', email)
      
      if (!email) {
        toast.error('Email not found')
        return
      }

      // Check if email is classified
      console.log('🔍 Email prediction:', email.prediction, 'Type:', typeof email.prediction)
      
      if (!email.prediction || email.prediction === 'pending') {
        toast.warning('This email hasn\'t been classified yet. Please run "Fetch & Scan" first.')
        return
      }

      // Normalize prediction - ML returns "safe" but backend expects "legitimate"
      const normalizedPrediction = email.prediction.toLowerCase() === 'safe' ? 'legitimate' : email.prediction.toLowerCase()
      
      console.log('🔄 Normalized prediction:', normalizedPrediction, 'from:', email.prediction)

      // Determine correct label based on feedback type
      let correctLabel
      if (type === 'correct') {
        // Current prediction is correct, keep it
        correctLabel = normalizedPrediction
      } else {
        // Wrong prediction, flip it
        correctLabel = normalizedPrediction === 'phishing' ? 'legitimate' : 'phishing'
      }
      
      console.log('✅ Final correctLabel:', correctLabel)

      const feedbackData = {
        emailId,
        correctLabel: correctLabel  // Already normalized and lowercase, don't call toLowerCase again
      }
      
      console.log('📝 Sending feedback:', feedbackData)

      await submitFeedback(feedbackData)

      console.log('✅ Feedback submitted successfully')
      toast.success('Thank you for your feedback! This helps improve our AI.')
      
      // Refresh feedback stats and emails
      fetchFeedbackStats()
      fetchEmails()
    } catch (err) {
      console.error('❌ Failed to submit feedback:', err)
      console.error('❌ Error details:', err.response?.data)
      
      // Handle specific error types
      if (err.response?.status === 403) {
        openConfirmDialog({
          title: 'Migration Needed',
          description: 'This email belongs to your old account. Continue to automatically migrate ALL emails to your current account? This will fix the feedback errors for all emails.',
          onConfirm: async () => {
            await handleMigrateEmails()
          }
        })
      } else if (err.response?.status === 400) {
        toast.error(err.response?.data?.error || 'Invalid feedback data')
      } else {
        toast.error(err.response?.data?.error || err.message || 'Failed to submit feedback')
      }
    }
  }
  
  // Handle selecting/deselecting a single email
  const handleSelectEmail = (emailId) => {
    setSelectedEmails(prev => {
      if (prev.includes(emailId)) {
        // Deselect
        return prev.filter(id => id !== emailId)
      } else {
        // Select
        return [...prev, emailId]
      }
    })
  }
  
  // Handle select all / deselect all
  const handleSelectAll = (checked) => {
    if (checked) {
      // Select all email IDs
      const allEmailIds = emails.map(email => email._id)
      setSelectedEmails(allEmailIds)
    } else {
      // Deselect all
      setSelectedEmails([])
    }
  }
  
  // Handle bulk delete selected emails
  const handleBulkDelete = async () => {
    if (selectedEmails.length === 0) {
      toast.error('Please select emails to delete')
      return
    }
    
    // Show confirmation dialog
    openConfirmDialog({
      title: 'Delete Multiple Emails',
      description: `Are you sure you want to delete ${selectedEmails.length} email(s)? This action cannot be undone.`,
      variant: 'destructive',
      onConfirm: async () => {
        try {
          const result = await bulkDeleteEmails(selectedEmails)
          console.log('✅ Bulk delete result:', result)
          
          // Update storage saved stats
          setStorageSaved(prev => ({
            emailsDeleted: prev.emailsDeleted + result.results.successful,
            mbSaved: prev.mbSaved + (result.results.successful * 0.05) // Estimate 50KB per email
          }))
          
          // Clear selection
          setSelectedEmails([])
          
          // Show success message
          toast.success(`Successfully deleted ${result.results.successful} out of ${result.results.total} emails`)
          
          // Refresh emails and stats
          fetchEmails()
          fetchStats()
        } catch (err) {
          console.error('❌ Failed to bulk delete emails:', err)
          toast.error('Failed to delete emails. Please try again.')
        }
      }
    })
  }
  
  // Handle clean all phishing emails
  const handleCleanPhishing = async () => {
    // Show confirmation dialog
    openConfirmDialog({
      title: 'Delete All Phishing Emails',
      description: 'Are you sure you want to delete ALL phishing emails? This will permanently remove all detected phishing emails from your inbox.',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          const result = await cleanPhishingEmails()
          console.log('✅ Clean phishing result:', result)
          
          // Update storage saved stats
          if (result.results.deleted > 0) {
            setStorageSaved(prev => ({
              emailsDeleted: prev.emailsDeleted + result.results.deleted,
              mbSaved: prev.mbSaved + parseFloat(result.results.storageSaved.mb)
            }))
          }
          
          // Clear selection
          setSelectedEmails([])
          
          // Show success message
          if (result.results.deleted > 0) {
            toast.success(`Successfully cleaned ${result.results.deleted} phishing email(s)! Storage saved: ${result.results.storageSaved.mb} MB`)
            
            openConfirmDialog({
              title: 'Fetch More Emails',
              description: 'Would you like to fetch more emails from Gmail to replace the deleted ones?',
              variant: 'default',
              onConfirm: async () => {
                // Auto-fetch more emails (skip confirmation since user already confirmed)
                await handleFetchEmails(true)
              }
            })
            return
          } else {
            toast.info('No phishing emails found to clean.')
          }
          
          // Refresh emails and stats
          fetchEmails()
          fetchStats()
        } catch (err) {
          console.error('❌ Failed to clean phishing emails:', err)
          toast.error('Failed to clean phishing emails. Please try again.')
        }
      }
    })
  }

  const handleLogout = async () => {
    openConfirmDialog({
      title: 'Sign Out',
      description: 'Are you sure you want to logout?',
      variant: 'default',
      onConfirm: async () => {
        await signOut()
      }
    })
  }
  
  // Handle clearing all emails from database
  const handleClearAllEmails = async () => {
    openConfirmDialog({
      title: 'Clear All Emails',
      description: 'This will permanently delete ALL emails from the database (not from Gmail). This action cannot be undone. Are you sure?',
      variant: 'destructive',
      onConfirm: async () => {
        try {
          const result = await clearAllEmails()
          console.log('✅ All emails cleared:', result)
          toast.success(`Successfully cleared ${result.deleted} email(s) from database`)
          
          // Refresh
          fetchEmails()
          fetchStats()
        } catch (err) {
          console.error('❌ Failed to clear all emails:', err)
          toast.error('Failed to clear emails. Please try again.')
        }
      }
    })
  }
  
  // Handle Gmail connection
  const handleConnectGmail = async () => {
    try {
      const response = await initiateGmailAuth()
      
      if (response.data && response.data.authUrl) {
        // Redirect to Google OAuth
        window.location.href = response.data.authUrl
      }
    } catch (err) {
      console.error('❌ Failed to initiate Gmail auth:', err)
      toast.error('Failed to connect Gmail. Please try again.')
    }
  }

  const handleDisconnectGmail = async () => {
    try {
      const token = await window.Clerk.session?.getToken()
      const response = await api.delete('/gmail/disconnect', {
        headers: { Authorization: `Bearer ${token}` },
      })
      console.log('✅ Gmail disconnected:', response)
      setGmailConnected(false)
      toast.success('Gmail disconnected successfully.')
    } catch (err) {
      console.error('❌ Failed to disconnect Gmail:', err)
      toast.error('Failed to disconnect Gmail. Please try again.')
    }
  }
  
  // Handle fetching emails from Gmail
  const handleFetchEmails = async (skipConfirm = false) => {
    const runFetchEmails = async () => {
      try {
        setFetchingEmails(true)
        
        // Step 1: Fetch emails from Gmail with user options
        const fetchResponse = await fetchGmailEmails(gmailFetchOptions)
        console.log('✅ Emails fetched:', fetchResponse)
        
        // Step 2: Classify the emails
        console.log('🤖 Classifying emails...')
        const classifyResponse = await classifyEmails()
        console.log('✅ Emails classified:', classifyResponse)
        
        const message = `Fetched ${fetchResponse.data.fetched} emails (${fetchResponse.data.saved} new)! Classified: ${classifyResponse.stats.processed} emails - Phishing: ${classifyResponse.stats.phishing} | Safe: ${classifyResponse.stats.safe}`
        
        if (!skipConfirm) {
          toast.success(message, { duration: 5000 })
        }
        
        // Refresh emails and stats
        fetchEmails()
        fetchStats()
        setShowFetchOptions(false) // Close options dialog
        
        // Auto-refetch if we got all new emails (means there might be more)
        if (fetchResponse.data.shouldRefetch && fetchResponse.data.saved === fetchResponse.data.fetched) {
          openConfirmDialog({
            title: 'Fetch More Emails',
            description: 'All fetched emails were new. Would you like to fetch more?',
            variant: 'default',
            onConfirm: async () => {
              await runFetchEmails()
            }
          })
          return;
        }
      } catch (err) {
        console.error('❌ Failed to fetch/classify emails:', err)
        toast.error('Failed to fetch/classify emails. Please try again.')
      } finally {
        setFetchingEmails(false)
      }
    }
    
    await runFetchEmails()
  }

  return (
        <div className="space-y-6">
          {/* Migration Warning Banner */}
          {migrationLoading ? (
            <div className="bg-gray-50 rounded-xl border border-gray-200 p-6 animate-pulse">
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-4">
                  <div className="w-12 h-12 bg-gray-200 rounded-lg"></div>
                  <div className="space-y-2">
                    <div className="h-5 bg-gray-200 rounded w-48"></div>
                    <div className="h-4 bg-gray-200 rounded w-96"></div>
                  </div>
                </div>
                <div className="w-28 h-12 bg-gray-200 rounded-lg"></div>
              </div>
            </div>
          ) : migrationNeeded && (
            <div className="bg-yellow-50 rounded-xl border border-yellow-200 p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center space-x-4">
                  <div className="p-3 bg-yellow-100 rounded-lg flex-shrink-0">
                    <svg className="w-6 h-6 text-yellow-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-yellow-900 mb-1">⚠️ Email Migration Required</h3>
                    <p className="text-sm text-yellow-700">
                      {migrationCount > 0 ? `You have ${migrationCount} existing email(s) that need ` : 'Your existing emails need '}
                      to be migrated to your new Clerk account. Click "Fix Now" to update ownership.
                    </p>
                  </div>
                </div>
                <div className="flex space-x-3 w-full sm:w-auto">
                  <button
                    onClick={checkMigrationStatus}
                    disabled={migrating}
                    title="Retry check"
                    className={`px-4 py-3 rounded-lg font-semibold transition duration-200 flex items-center justify-center space-x-2 ${
                      migrating
                        ? 'bg-gray-200 text-gray-400 cursor-not-allowed'
                        : 'bg-white hover:bg-gray-50 text-gray-700 border border-gray-300'
                    }`}
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                  </button>
                  <button
                    onClick={handleMigrateEmails}
                    disabled={migrating}
                    className={`flex-1 sm:flex-none px-6 py-3 rounded-lg font-semibold transition duration-200 flex items-center justify-center space-x-2 ${
                      migrating
                        ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                        : 'bg-yellow-600 hover:bg-yellow-700 text-white shadow-md'
                    }`}
                  >
                    {migrating ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        <span>Migrating...</span>
                      </>
                    ) : (
                      <>
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                        </svg>
                        <span>Fix Now</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>
          )}
          
          {/* OLD EMAILS WARNING BANNER */}
          {stats.total > 0 && (
            <div className="mt-4 p-4 bg-orange-500/10 border border-orange-500/30 rounded-lg">
              <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div className="flex items-start gap-3">
                  <svg className="w-5 h-5 text-orange-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                  <div>
                    <p className="text-sm font-semibold text-orange-300">Old Emails Detected</p>
                    <p className="text-xs text-orange-400/80 mt-1">
                      You have {stats.total} email(s) in database. Clear them to fetch fresh emails and start with a clean slate.
                    </p>
                  </div>
                </div>
                <button
                  onClick={handleClearAllEmails}
                  className="flex-shrink-0 px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg font-semibold transition-all duration-200 text-sm shadow-lg shadow-orange-600/20 flex items-center gap-2"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                  </svg>
                  Clear All ({stats.total})
                </button>
              </div>
            </div>
          )}
          
          {/* Gmail Fetch Options Dialog */}
          {showFetchOptions && gmailConnected && (
            <div className="mt-4 p-4 bg-slate-900/80 border border-slate-700 rounded-xl">
              <h4 className="text-lg font-semibold text-slate-100 mb-4">Gmail Fetch Options</h4>
              
              <div className="mb-4 flex items-center space-x-3 p-3 bg-slate-800 rounded-lg border border-slate-700">
                <input
                  type="checkbox"
                  id="fetchAll"
                  checked={gmailFetchOptions.fetchAll || false}
                  onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, fetchAll: e.target.checked })}
                  className="w-5 h-5 rounded border-slate-600 bg-slate-800 text-blue-500 focus:ring-blue-500"
                />
                <label htmlFor="fetchAll" className="text-sm font-medium text-slate-100 cursor-pointer">
                  Fetch All Emails (No Limit) - ⚠️ This may take a while
                </label>
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    ⏰ Time Range (Real-time Fetch)
                  </label>
                  <select
                    value={gmailFetchOptions.timeRange}
                    onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, timeRange: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                  >
                    <option value="5m">⚡ Last 5 Minutes</option>
                    <option value="15m">🕐 Last 15 Minutes</option>
                    <option value="30m">🕑 Last 30 Minutes</option>
                    <option value="1h">🕓 Last 1 Hour</option>
                    <option value="6h">🕕 Last 6 Hours</option>
                    <option value="12h">🕛 Last 12 Hours</option>
                    <option value="1d">📅 Last 1 Day</option>
                    <option value="3d">📅 Last 3 Days</option>
                    <option value="7d">📅 Last 7 Days</option>
                    <option value="30d">📅 Last 30 Days</option>
                    <option value="all">📬 All Inbox Emails</option>
                  </select>
                  <p className="mt-1 text-xs text-slate-500">Time range filters are ignored if you set custom dates below</p>
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Number of Emails {gmailFetchOptions.fetchAll ? '(Ignored when Fetch All is checked)' : '(1-100)'}
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="100"
                    value={gmailFetchOptions.maxResults}
                    onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, maxResults: parseInt(e.target.value) || 50 })}
                    disabled={gmailFetchOptions.fetchAll}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
                  />
                </div>
              
              </div>
              
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    Gmail Search Query (optional)
                  </label>
                  <input
                    type="text"
                    placeholder="e.g., is:unread, has:attachment"
                    value={gmailFetchOptions.query}
                    onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, query: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    From Date
                  </label>
                  <input
                    type="date"
                    value={gmailFetchOptions.dateFrom}
                    onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, dateFrom: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-slate-400 mb-2">
                    To Date
                  </label>
                  <input
                    type="date"
                    value={gmailFetchOptions.dateTo}
                    onChange={(e) => setGmailFetchOptions({ ...gmailFetchOptions, dateTo: e.target.value })}
                    className="w-full px-4 py-2 bg-slate-900 border border-slate-700 rounded-lg text-slate-100 focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>
              
              <div className="mt-4 flex gap-3">
                <button
                  onClick={handleFetchEmails}
                  disabled={fetchingEmails}
                  className={`px-6 py-2 rounded-lg font-semibold transition-all duration-200 ${
                    fetchingEmails
                      ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
                      : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-600/20'
                  }`}
                >
                  Fetch with Options
                </button>
                <button
                  onClick={() => setShowFetchOptions(false)}
                  className="px-6 py-2 bg-slate-700 hover:bg-slate-600 text-slate-100 rounded-lg font-semibold transition-all duration-200 border border-slate-600"
                >
                  Cancel
                </button>
              </div>
              
              <div className="mt-3 text-xs text-slate-500">
                <p>💡 <strong>Tips:</strong></p>
                <ul className="list-disc list-inside ml-2 mt-1 space-y-1">
                  <li>Search query examples: "from:example@gmail.com", "subject:invoice", "is:unread"</li>
                  <li>Leave dates empty to fetch recent emails</li>
                  <li>Maximum 100 emails per fetch</li>
                </ul>
              </div>
            </div>
          )}

        {/* Reinforcement Learning Section */}
        <div className="bg-gradient-to-br from-purple-900/20 to-blue-900/20 rounded-xl border border-purple-500/30 p-4 sm:p-6 transition-all duration-300 hover:border-purple-500/50 hover:shadow-lg hover:shadow-purple-500/10">
          <div className="flex flex-col gap-4">
            {/* Header */}
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div className="flex items-center space-x-3 sm:space-x-4">
                <div className="p-2 sm:p-3 bg-purple-500/10 rounded-xl border border-purple-500/20 flex-shrink-0">
                  <svg className="w-6 h-6 sm:w-8 sm:h-8 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <h3 className="text-lg sm:text-xl font-semibold text-slate-100">AI Reinforcement Learning</h3>
                    <span className="px-2 sm:px-3 py-1 bg-purple-500/10 border border-purple-500/30 rounded-full text-xs text-purple-400 font-semibold">
                      🧠 Active
                    </span>
                  </div>
                  <p className="text-xs sm:text-sm text-slate-400">
                    {feedbackStats.count > 0 
                      ? `${feedbackStats.count} feedback entries collected • Help improve the AI by marking emails as correct/wrong`
                      : 'Mark emails as correct/wrong to improve accuracy'}
                  </p>
                </div>
              </div>
              <button
                onClick={handleRetrain}
                disabled={retraining || feedbackStats.count === 0}
                className={`flex-shrink-0 px-4 sm:px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center justify-center space-x-2 min-h-[44px] text-sm sm:text-base ${
                  retraining || feedbackStats.count === 0
                    ? 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-lg shadow-purple-600/20 hover:shadow-purple-500/30'
                }`}
              >
                {retraining ? (
                  <>
                    <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Retraining...</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                    </svg>
                    <span>Retrain Model ({feedbackStats.count})</span>
                  </>
                )}
              </button>
            </div>
            
            {/* Info Box */}
            <div className="p-4 bg-slate-900/50 border border-slate-700 rounded-lg">
              <div className="flex items-start gap-3">
                <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <div className="flex-1">
                  <p className="text-sm font-semibold text-slate-200 mb-1">How it works</p>
                  <ul className="text-xs text-slate-400 space-y-1">
                    <li>1️⃣ Click ✓ (correct) or ✗ (wrong) on any classified email below</li>
                    <li>2️⃣ Your feedback is saved and used to build a better training dataset</li>
                    <li>3️⃣ Click "Retrain Model" to improve accuracy based on your corrections</li>
                    <li>4️⃣ The AI automatically retrains every night at 2 AM with all feedback</li>
                  </ul>
                </div>
              </div>
            </div>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          <StatsCard
            title="Total Emails"
            value={stats.total}
            icon={Mail}
            loading={statsLoading}
            iconColor="text-blue-400"
            iconBgColor="bg-blue-500/10"
          />

          <StatsCard
            title="Phishing Detected"
            value={stats.phishing}
            icon={ShieldAlert}
            loading={statsLoading}
            iconColor="text-rose-400"
            iconBgColor="bg-rose-500/10"
          />

          <StatsCard
            title="Safe Emails"
            value={stats.safe}
            icon={CheckCircle2}
            loading={statsLoading}
            iconColor="text-emerald-400"
            iconBgColor="bg-emerald-500/10"
          />

          <StatsCard
            title="Storage Saved"
            value={`${storageSaved.mbSaved.toFixed(2)} MB`}
            icon={HardDrive}
            loading={statsLoading}
            iconColor="text-purple-400"
            iconBgColor="bg-purple-500/10"
          />
        </div>

        {/* Error Message */}
        {error && (
          <div className="p-4 bg-rose-500/10 border border-rose-500/30 rounded-xl backdrop-blur-sm">
            <p className="text-rose-400 text-sm">{error}</p>
          </div>
        )}

        {/* Analytics Chart - Lazy loaded */}
        <Suspense fallback={<ComponentLoader />}>
          <EmailStatsChart stats={stats} loading={statsLoading} />
        </Suspense>

        {/* Action Buttons */}
        <div className="flex flex-wrap gap-3 sm:gap-4">
          {/* Gmail Connection Controls */}
          {gmailConnected ? (
            <button
              onClick={() => openConfirmDialog({
                title: 'Disconnect Gmail',
                description: 'Are you sure you want to disconnect your Gmail account? This will stop email fetching.',
                onConfirm: async () => {
                  await handleDisconnectGmail()
                },
                variant: 'destructive',
              })}
              className="px-4 sm:px-6 py-3 bg-red-600 hover:bg-red-500 text-white rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2 min-h-[44px]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7" />
              </svg>
              Disconnect Gmail
            </button>
          ) : (
            <button
              onClick={handleConnectGmail}
              className="px-4 sm:px-6 py-3 bg-green-600 hover:bg-green-500 text-white rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2 min-h-[44px]"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
              Connect Gmail
            </button>
          )}

          {/* Auto‑Delete Settings */}
          <div className="flex items-center space-x-4 bg-slate-800 p-4 rounded-xl border border-slate-600">
            <label className="flex items-center space-x-2">
              <input
                type="checkbox"
                checked={autoDeleteEnabled}
                disabled={prefLoading}
                onChange={e => setAutoDeleteEnabled(e.target.checked)}
                className="w-5 h-5 text-indigo-600 bg-slate-700 border-slate-600 rounded"
              />
              <span className="text-sm text-slate-200">Enable Auto‑Delete</span>
            </label>
            <label className="flex items-center space-x-2">
              <span className="text-sm text-slate-200">Retention Days:</span>
              <input
                type="number"
                min="1" max="90"
                value={retentionDays}
                disabled={prefLoading}
                onChange={e => setRetentionDays(parseInt(e.target.value) || 30)}
                className="w-16 px-2 py-1 bg-slate-700 text-slate-200 border border-slate-600 rounded"
              />
              <button
                onClick={async () => {
                  try {
                    setPrefLoading(true)
                    await updateAutoDeletePreferences({ enabled: autoDeleteEnabled, retentionDays })
                    toast.success('Auto‑delete preferences saved')
                  } catch (err) {
                    toast.error('Failed to save preferences')
                  } finally {
                    setPrefLoading(false)
                  }
                }}
                disabled={prefLoading}
                className="px-3 py-1 bg-indigo-600 hover:bg-indigo-500 text-white rounded"
              >
                Save
              </button>
            </label>
          </div>

          {/* Bulk Delete Button */}
          <button
            onClick={handleBulkDelete}
            disabled={selectedEmails.length === 0}
            className={`px-4 sm:px-6 py-3 rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2 min-h-[44px] text-sm sm:text-base ${
              selectedEmails.length > 0
                ? 'bg-rose-600 hover:bg-rose-500 text-white shadow-lg shadow-rose-600/20'
                : 'bg-slate-700 text-slate-400 cursor-not-allowed border border-slate-600'
            }`}
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <span className="hidden sm:inline">Delete Selected ({selectedEmails.length})</span>
            <span className="sm:hidden">Delete ({selectedEmails.length})</span>
          </button>

          {/* Clean All Phishing Button */}
          <button
            onClick={handleCleanPhishing}
            className="px-4 sm:px-6 py-3 bg-rose-600 hover:bg-rose-500 text-white rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2 min-h-[44px] text-sm sm:text-base shadow-lg shadow-rose-600/20"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <span className="hidden sm:inline">🧹 Clean All Phishing</span>
            <span className="sm:hidden">🧹 Clean</span>
          </button>
          
          {/* Clear All Emails Button */}
          <button
            onClick={handleClearAllEmails}
            className="px-4 sm:px-6 py-3 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-semibold transition-all duration-200 flex items-center space-x-2 min-h-[44px] text-sm sm:text-base shadow-lg shadow-purple-600/20"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span className="hidden sm:inline">🔄 Clear All Emails</span>
            <span className="sm:hidden">🔄 Clear</span>
          </button>
        </div>

        {/* Email List - Lazy loaded */}
        <Suspense fallback={<ComponentLoader />}>
          <EmailTable
            emails={emails}
            loading={emailsLoading}
            onDelete={handleDelete}
            onFeedback={handleFeedback}
            selectedEmails={selectedEmails}
            onSelectEmail={handleSelectEmail}
            onSelectAll={handleSelectAll}
          />
        </Suspense>

        {/* Footer Note */}
        <div className="mt-8 text-center">
          <p className="text-sm text-slate-500">
            🤖 Powered by AI • Phase 6 - Gmail Actions & Automation Complete
          </p>
        </div>

        {/* Confirmation Dialog */}
        <AlertDialog open={confirmDialog.open} onOpenChange={(open) => setConfirmDialog(prev => ({ ...prev, open }))}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>{confirmDialog.title}</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmDialog.description}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel onClick={() => setConfirmDialog(prev => ({ ...prev, open: false }))}>
                Cancel
              </AlertDialogCancel>
              <AlertDialogAction
                onClick={async () => {
                  setConfirmDialog(prev => ({ ...prev, open: false }))
                  if (confirmDialog.onConfirm) {
                    await confirmDialog.onConfirm()
                  }
                }}
                className={confirmDialog.variant === 'destructive' ? 'bg-red-600 hover:bg-red-700' : ''}
              >
                Continue
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
  )
}

export default Dashboard
