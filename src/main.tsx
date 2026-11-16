import { createRoot } from 'react-dom/client';
import App from './App.tsx';
import './index.css';

window.addEventListener('keydown', (e) => {
  if (e.key === 'F11' || e.code === 'F11') {
    e.preventDefault();
    if (document.fullscreenElement) {
      document.exitFullscreen?.().catch(() => {});
    } else {
      document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }
});

createRoot(document.getElementById('root')!).render(<App />);
