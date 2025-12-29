export async function callApi<T>(payload: any): Promise<T & { ok: true }> {
  const endpoint = import.meta.env.VITE_GAS_URL as string;
  if (!endpoint) throw new Error("VITE_GAS_URL is missing");

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });

  const text = await res.text();

  let data: any;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    throw new Error(`Non-JSON response (HTTP ${res.status}): ${text.slice(0, 200)}`);
  }

  if (!res.ok) throw new Error(`HTTP ${res.status}: ${data?.error || text.slice(0, 200)}`);
  if (!data?.ok) throw new Error(data?.error || "API error");
  return data;
}
