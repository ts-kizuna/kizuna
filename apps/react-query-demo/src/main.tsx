import { QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import { client, KizunaProvider, queryClient } from './api.js';

const root = document.getElementById('root');
if (!root) throw new Error('Missing #root element');

createRoot(root).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <KizunaProvider client={client} queryClient={queryClient}>
                <App />
            </KizunaProvider>
        </QueryClientProvider>
    </StrictMode>
);
