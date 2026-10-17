import '@juno/tokens/fonts.css'
import '@juno/tokens/global.css'
import './gallery.css'

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

// The index uses system fonts, so without this the first state a page opens
// is laid out in a fallback font. A message row that is off screen by the
// time the bundled fonts arrive keeps that size (content-visibility remembers
// it) until it is laid out again, which the shift guard then reports.
const faces = ['400 1em "Figtree Variable"', '400 1em "Instrument Serif"', 'italic 400 1em "Instrument Serif"', '400 1em "JetBrains Mono"', '500 1em "JetBrains Mono"']
const sample = 'Aa–āő'

void Promise.allSettled(faces.map((font) => document.fonts.load(font, sample))).then(() =>
  createRoot(container).render(
    <StrictMode>
      <App />
    </StrictMode>,
  ),
)
