import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import "./styles/app.css";
import App from "./App";
import { MotionRoot } from "./components/motion";
import { ToastProvider } from "./components/ui";
import { ApiError } from "./lib/api";
import { AuthProvider } from "./lib/auth";
import { LangProvider } from "./lib/i18n";

const client = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
      // a 4xx is an answer, not an outage: never retry those
      retry: (count, error) => !(error instanceof ApiError && error.status >= 400 && error.status < 500) && count < 2,
    },
  },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <LangProvider>
        <BrowserRouter basename="/app">
          <ToastProvider>
            <AuthProvider>
              <MotionRoot>
                <App />
              </MotionRoot>
            </AuthProvider>
          </ToastProvider>
        </BrowserRouter>
      </LangProvider>
    </QueryClientProvider>
  </StrictMode>,
);
