import React from "react";
import { Routes, Route, Navigate } from "react-router-dom";
import LoginPage from "./LoginPage";
import Dashboard from "./Dashboard";

function App() {
  // const user = localStorage.getItem("user");  // you can even remove this

  return (
    <Routes>
      <Route path="/" element={<Dashboard />} />
      <Route path="/dashboard" element={<Dashboard />} />
      {/* Optional: keep login around but unused */}
      <Route path="/login" element={<LoginPage />} />
      <Route path="*" element={<Dashboard />} />
    </Routes>
  );
}

export default App;
