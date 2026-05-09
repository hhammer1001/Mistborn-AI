import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SensePreview } from './preview/SensePreview.tsx'

const previewParam = new URLSearchParams(window.location.search).get('preview')
const Root = previewParam === 'sense' ? SensePreview : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
)
