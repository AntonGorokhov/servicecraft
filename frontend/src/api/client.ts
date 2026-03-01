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

// Mutex for token refresh — prevents multiple parallel refresh calls
let refreshPromise: Promise<string> | null = null;

client.interceptors.response.use(
  (response) => response,
  async (error) => {
    const original = error.config;
    if (error.response?.status === 401 && !original._retry) {
      original._retry = true;
      const refreshToken = localStorage.getItem("refresh_token");
      if (refreshToken) {
        try {
          // If a refresh is already in progress, wait for it
          if (!refreshPromise) {
            refreshPromise = axios
              .post("/api/auth/refresh", { refresh_token: refreshToken })
              .then((res) => {
                setAccessToken(res.data.access_token);
                localStorage.setItem("refresh_token", res.data.refresh_token);
                return res.data.access_token;
              })
              .finally(() => {
                refreshPromise = null;
              });
          }
          const newToken = await refreshPromise;
          original.headers.Authorization = `Bearer ${newToken}`;
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
