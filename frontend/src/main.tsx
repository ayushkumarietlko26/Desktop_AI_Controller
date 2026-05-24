import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import CompanionApp from './CompanionApp'
import './App.css'

const isCompanion =
  new URLSearchParams(window.location.search).get('companion') === '1'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    {isCompanion ? <CompanionApp /> : <App />}
  </React.StrictMode>,
)
