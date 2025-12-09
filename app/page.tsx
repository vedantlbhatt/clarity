'use client'

import { useState } from 'react'

export default function Home() {
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  const makeCall = async () => {
    setLoading(true)
    setMessage(null)

    try {
      const response = await fetch('/api/call', {
        method: 'POST',
      })

      const data = await response.json()

      if (response.ok) {
        setMessage(`Call initiated! Call SID: ${data.callSid}`)
      } else {
        setMessage(`Error: ${data.error}`)
      }
    } catch (error) {
      setMessage('Failed to make call. Please try again.')
      console.error('Error:', error)
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-indigo-100">
      <div className="text-center px-4">
        <h1 className="text-5xl font-bold text-gray-900 mb-4">
          Clarity
        </h1>
        <p className="text-xl text-gray-600 mb-8">
          AI-powered phone agent with real-time feedback
        </p>
        <div className="space-y-4">
          <p className="text-gray-500 mb-6">
            Get started by exploring the possibilities
          </p>
          <button
            onClick={makeCall}
            disabled={loading}
            className="bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold px-6 py-3 rounded-lg shadow-lg transition-colors duration-200"
          >
            {loading ? 'Calling...' : 'Make Call'}
          </button>
          {message && (
            <p className={`mt-4 text-sm ${message.includes('Error') ? 'text-red-600' : 'text-green-600'}`}>
              {message}
            </p>
          )}
        </div>
      </div>
    </main>
  )
}

