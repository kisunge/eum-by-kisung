import React from "react";
import ReactDOM from "react-dom/client";
import { HashRouter, Routes, Route, Navigate } from "react-router-dom";
import Host from "./pages/Host";
import Player from "./pages/Player";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <HashRouter>
      <Routes>
        <Route path="/" element={<Navigate to="/p" replace />} />
        <Route path="/p" element={<Player />} />
        <Route path="/host" element={<Host />} />
      </Routes>
    </HashRouter>
  </React.StrictMode>
);
