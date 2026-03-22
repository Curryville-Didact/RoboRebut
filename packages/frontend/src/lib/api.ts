import { API_URL } from "./env";

export async function healthCheck() {
  const res = await fetch(`${API_URL}/health`);
  return res.json();
}