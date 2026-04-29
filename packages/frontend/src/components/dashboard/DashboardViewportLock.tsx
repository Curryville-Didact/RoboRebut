'use client'

import { useEffect } from 'react'

export default function DashboardViewportLock() {
  useEffect(() => {
    const html = document.documentElement
    const body = document.body

    const prevHtmlOverflow = html.style.overflow
    const prevBodyOverflow = body.style.overflow

    const prevHtmlHeight = html.style.height
    const prevBodyHeight = body.style.height

    // HARD LOCK
    html.style.overflow = 'hidden'
    body.style.overflow = 'hidden'

    html.style.height = '100dvh'
    body.style.height = '100dvh'

    return () => {
      html.style.overflow = prevHtmlOverflow
      body.style.overflow = prevBodyOverflow

      html.style.height = prevHtmlHeight
      body.style.height = prevBodyHeight
    }
  }, [])

  return null
}

