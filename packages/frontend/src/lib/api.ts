const API_URL = process.env.NEXT_PUBLIC_API_URL;

export async function healthCheck() {
  const res = await fetch(`${API_URL}/health`);
  return res.json();
}