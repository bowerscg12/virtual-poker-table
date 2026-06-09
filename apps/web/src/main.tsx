import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { installGlobalInputSanitizer } from './utils/inputSanitizer';
import './i18n';
import './styles.css';

// Restrict every text field to regular keyboard (printable ASCII) characters.
installGlobalInputSanitizer();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);
