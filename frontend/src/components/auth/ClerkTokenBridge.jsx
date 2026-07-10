import { useEffect } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { clearAuthTokenGetter, setAuthTokenGetter } from '@/services/authToken'

export default function ClerkTokenBridge() {
  const { getToken, isLoaded } = useAuth()

  useEffect(() => {
    if (!isLoaded) {
      clearAuthTokenGetter()
      return undefined
    }

    setAuthTokenGetter(getToken)
    return () => clearAuthTokenGetter()
  }, [getToken, isLoaded])

  return null
}