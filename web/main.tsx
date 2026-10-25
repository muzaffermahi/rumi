import {createRoot} from 'react-dom/client';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/500.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/jetbrains-mono/400.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/layout.css';
import './styles/editor.css';
import './styles/task.css';
import './styles/panels.css';
import './styles/print.css';
import {App} from './App';
import {ToastProvider} from './Toasts';

// Paint in the theme you chose last time, before the server says so.
try {
  const theme = localStorage.getItem('rumi.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
} catch {}

createRoot(document.getElementById('root')!).render(
  <ToastProvider>
    <App />
  </ToastProvider>,
);
