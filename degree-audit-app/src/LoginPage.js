import React, { useState } from "react";
import "./LoginPage.css"; // <- new stylesheet for styling
import psuLogo from "./pennstatelogo2.png";

function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setMessage("");

    try {
      const res = await fetch("http://localhost:8000/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail || "Login failed");

      localStorage.setItem("user", username);
      window.location.href = "/dashboard";
    } catch (err) {
      setMessage(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-page">
      <div className="overlay"></div>
      <div className="login-box">
        <img
          src={psuLogo}
          alt="Penn State Logo"
          className="psu-logo"
        />
        <h2 className="title">Sign in</h2>
        <form onSubmit={handleSubmit}>
          <input
            type="email"
            placeholder="userid@psu.edu"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <button type="submit" disabled={loading}>
            {loading ? "Signing in..." : "Next"}
          </button>
        </form>
        {message && <p className="error">{message}</p>}
        <div className="login-footer">
          <p>Log in to your Penn State Account</p>
        </div>
      </div>
    </div>
  );
}

export default LoginPage;
