import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '@fontsource/public-sans/400.css';
import '@fontsource/public-sans/600.css';
import './styles/system.css';
import './styles/cre.scoped.css';
import './styles/admin.scoped.css';
import './styles/bd.scoped.css';
import './styles/app.css';
import { App } from './App';
import { ToastProvider } from './components/ui';

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 15_000, refetchOnWindowFocus: true, retry: 1 } },
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <ToastProvider>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </ToastProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
