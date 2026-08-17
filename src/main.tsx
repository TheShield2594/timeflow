import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ErrorBoundary } from "./components/ErrorBoundary";
import "./styles.css";

// The boundary belongs here, not inside App: it used to be mounted below
// useAppBootstrap() and useTheme(), so anything either of those threw escaped
// to a white screen with nothing logged and nothing reported (#111).
ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ErrorBoundary scope="app">
      <App />
    </ErrorBoundary>
  </React.StrictMode>
);
