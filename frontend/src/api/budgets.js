const API_BASE_URL =
  import.meta.env.VITE_API_BASE_URL || "http://localhost:2020";

const TOKEN_KEY = "myra_auth_token";

function getHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return {
    "Content-Type": "application/json",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: getHeaders(),
    credentials: "include",
  });
  const body = await response.json();

  if (!response.ok) {
    throw new Error(body.error || `HTTP ${response.status}`);
  }

  return body.data;
}

export const budgetApi = {
  get: () => request("/budgets"),
  update: (settings) =>
    request("/budgets", {
      method: "PUT",
      body: JSON.stringify(settings),
    }),
};
