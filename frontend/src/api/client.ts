import axios from "axios";

const client = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

let accessToken: string | null = null;

export function setAccessToken(token: string | null) {
  accessToken = token;
}

export function getAccessToken() {
  return accessToken;
}

client.interceptors.request.use((config) => {
  if (accessToken) {
    config.headers.Authorization = `Bearer ${accessToken}`;
  }
  return config;
});

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          const res = await axios.post("/api/auth/refresh", {
            refresh_token: refreshToken,
          });
          setAccessToken(res.data.access_token);
          localStorage.setItem("refresh_token", res.data.refresh_token);
          original.headers.Authorization = `Bearer ${res.data.access_token}`;
          return client(original);
        } catch {
          localStorage.removeItem("refresh_token");
          setAccessToken(null);
          window.location.href = "/login";
        }
      }
    }
    return Promise.reject(error);
  }
);

export default client;
