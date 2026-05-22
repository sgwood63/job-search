import { useEffect, useRef } from 'react'

export function useRefreshOnFocus(refresh: () => void) {
  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    const handler = () => {
      if (document.visibilityState === 'visible') refreshRef.current()
    }
    document.addEventListener('visibilitychange', handler)
    window.addEventListener('focus', handler)
    return () => {
      document.removeEventListener('visibilitychange', handler)
      window.removeEventListener('focus', handler)
    }
  }, [])
}
