import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { RotateGate } from './components/RotateGate.tsx'
import { SensePreview } from './preview/SensePreview.tsx'
import { AllyDefensePreview } from './preview/AllyDefensePreview.tsx'

const previewParam = new URLSearchParams(window.location.search).get('preview')
const Root =
  previewParam === 'sense' ? SensePreview
  : previewParam === 'ally' ? AllyDefensePreview
  : App

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RotateGate />
    <Root />
  </StrictMode>,
)
