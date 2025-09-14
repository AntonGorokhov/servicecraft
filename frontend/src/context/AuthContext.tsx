import {
  createContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import client, { setAccessToken } from "../api/client";

export interface User {
  id: number;
  email: string;
  name: string;
  role: "superadmin" | "admin" | "operator";
  company_id?: number;
  company_name?: string;
}

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  updateUser: (updates: Partial<User>) => void;
}

export const AuthContext = createContext<AuthContextType>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  const logout = useCallback(() => {
    setAccessToken(null);
    localStorage.removeItem("refresh_token");
    setUser(null);
    client.post("/auth/logout").catch(() => {});
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await client.post("/auth/login", { email, password });
    setAccessToken(res.data.access_token);
    localStorage.setItem("refresh_token", res.data.refresh_token);
    setUser(res.data.user);
  }, []);

  const updateUser = useCallback((updates: Partial<User>) => {
    setUser((prev) => (prev ? { ...prev, ...updates } : prev));
  }, []);

  // Restore session from refresh token on mount
  useEffect(() => {
    const refreshToken = localStorage.getItem("refresh_token");
    if (!refreshToken) {
      setLoading(false);
      return;
    }
    client
      .post("/auth/refresh", { refresh_token: refreshToken })
      .then((res) => {
        setAccessToken(res.data.access_token);
        localStorage.setItem("refresh_token", res.data.refresh_token);
        return client.get("/auth/me");
      })
      .then((res) => setUser(res.data))
      .catch(() => {
        localStorage.removeItem("refresh_token");
        setAccessToken(null);
      })
      .finally(() => setLoading(false));
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, logout, updateUser }}>
      {children}
    </AuthContext.Provider>
  );
}
