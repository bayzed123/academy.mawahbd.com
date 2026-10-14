import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/admin.css";
import App from "./App";
import { ConfirmProvider, ToastProvider } from "./components/ui";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { LangProvider } from "./lib/i18n";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      refetchOnWindowFocus: false,
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <LangProvider>
        <BrowserRouter basename="/admin">
          <ToastProvider>
            <ConfirmProvider>
              <AuthProvider>
                <App />
              </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </BrowserRouter>
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);
