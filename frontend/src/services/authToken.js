let authTokenGetter = null

export const setAuthTokenGetter = (getter) => {
  authTokenGetter = getter
}

export const clearAuthTokenGetter = () => {
  authTokenGetter = null
}

export const getAuthToken = async () => {
  if (!authTokenGetter) {
    return null
  }

  return authTokenGetter()
}