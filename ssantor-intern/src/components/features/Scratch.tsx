import { useEffect, useState } from 'react'
import { Copy, Check, Trash2 } from 'lucide-react'
import { Button } from '../ui/button'
import { Textarea } from '../ui/textarea'

const STORAGE_KEY = 'ssantor-intern:scratch'

export function Scratch() {
  const [text, setText] = useState<string>(() => {
    if (typeof window === 'undefined') return ''
    return localStorage.getItem(STORAGE_KEY) ?? ''
  })
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, text)
  }, [text])

  const handleCopy = async () => {
    if (!text) return
    await navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const handleClear = () => {
    if (!text) return
    if (window.confirm('Clear the scratch pad?')) setText('')
  }

  const charCount = text.length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Scratch</h2>
          <p className="text-sm text-text-secondary">
            An open pad — type, paste, copy back out. Saved automatically.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-text-secondary tabular-nums">
            {charCount.toLocaleString()} char{charCount === 1 ? '' : 's'}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={handleCopy}
            disabled={!text}
            aria-label="Copy all"
          >
            {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            {copied ? 'Copied' : 'Copy all'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleClear}
            disabled={!text}
            aria-label="Clear"
          >
            <Trash2 className="h-4 w-4" />
            Clear
          </Button>
        </div>
      </div>

      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Start typing or paste anything here..."
        className="min-h-[60vh] font-mono text-sm leading-relaxed"
      />
    </div>
  )
}
