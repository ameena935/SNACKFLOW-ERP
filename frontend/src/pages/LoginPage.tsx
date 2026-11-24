import React, { useState } from "react";
import { api } from "../lib/api";
import { AuthUser, setStoredAuth } from "../lib/auth";

interface LoginPageProps {
  onLogin: (user: AuthUser) => void;
}

const QUICK_ACCOUNTS = [
  { label: "Salesman A", email: "salesmanA@factory.in", role: "SALESMAN" },
  { label: "Salesman B", email: "salesmanB@factory.in", role: "SALESMAN" },
  { label: "Admin", email: "admin@factory.in", role: "ADMIN" },
  { label: "Production", email: "floor@factory.in", role: "PRODUCTION" },
  { label: "Auditor", email: "auditor@factory.in", role: "AUDITOR" },
  { label: "Owner", email: "owner@factory.in", role: "OWNER" },
];

export function LoginPage({ onLogin }: LoginPageProps) {
  const [email, setEmail] = useState("admin@factory.in");
  const [password, setPassword] = useState("password123");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function submitLogin(loginEmail: string, loginPassword: string) {
    setError(null);
    setLoading(true);
    try {
      const res = await api.post("/auth/login", {
        email: loginEmail,
        password: loginPassword,
      });
      const { token, user } = res.data as { token: string; user: AuthUser };
      setStoredAuth(token, user);
      onLogin(user);
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Login failed";
      setError(msg);
    } finally {
      setLoading(false);
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    void submitLogin(email, password);
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-brand-50 to-orange-100 flex items-center justify-center p-4">
      <div className="card max-w-md w-full space-y-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-brand-700">CrispLedger ERP</h1>
          <p className="text-sm text-gray-500 mt-1">
            Order-to-Audit ERP for South Indian Snack Manufacturing
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="label">Email</label>
            <input
              type="email"
              className="input border p-2"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div>
            <label className="label">Password</label>
            <input
              type="password"
              className="input border p-2"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          {error && (
            <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded p-2.5">
              {error}
            </div>
          )}

          <button type="submit" disabled={loading} className="btn-primary w-full justify-center py-2.5">
            {loading ? "Signing in..." : "Sign In"}
          </button>
        </form>

        <div className="border-t border-gray-200 pt-4">
          <p className="text-xs font-medium text-gray-500 uppercase tracking-wider mb-2.5">
            1-Click Quick-Fill Test Accounts (pw: password123)
          </p>
          <div className="grid grid-cols-2 gap-2">
            {QUICK_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                onClick={() => {
                  setEmail(acc.email);
                  setPassword("password123");
                  void submitLogin(acc.email, "password123");
                }}
                className="btn-secondary justify-between text-xs px-3 py-2"
              >
                <span className="font-medium">{acc.label}</span>
                <span className="text-[10px] text-gray-500">{acc.role}</span>
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
