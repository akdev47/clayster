// Sends orders to the Django backend. In development, vite.config.js
// proxies /api/... to Django (python manage.py runserver).

async function getCsrfToken() {
  const response = await fetch("/api/csrf/", { credentials: "same-origin" });
  if (!response.ok) throw new Error(`CSRF request failed: ${response.status}`);
  return (await response.json()).csrfToken;
}

/** Returns `{ ok, status, data }`; throws only when the server is unreachable. */
export async function submitOrder(payload) {
  const token = await getCsrfToken();
  const response = await fetch("/api/orders/", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRFToken": token },
    body: JSON.stringify(payload),
  });
  const data = await response.json().catch(() => null);
  return { ok: response.ok, status: response.status, data };
}
