// Sends the finished order to Django. Same origin as the page, so the session
// cookie and the CSRF token are all the request needs.

const GENERAL_ERROR = "Er ging iets mis bij het plaatsen van je bestelling. Probeer het opnieuw.";
const OFFLINE_ERROR = "De server is niet bereikbaar. Controleer je verbinding en probeer het opnieuw.";

/**
 * Posts the order and the stamp file. Never throws:
 * - `{ ok: true, payUrl }` when the order was created, where to pay for it;
 * - `{ ok: false, errors }` otherwise, shaped `{ order, delivery, general }`
 *   with the same field names the order page uses.
 */
export async function submitOrder({
  endpoint,
  csrfToken,
  payload,
  stl,
  fetchImpl = globalThis.fetch,
}) {
  const body = new FormData();
  body.append("payload", JSON.stringify(payload));
  body.append("stl", stl, "stamp.stl");

  let response;
  try {
    response = await fetchImpl(endpoint, {
      method: "POST",
      credentials: "same-origin",
      headers: { "X-CSRFToken": csrfToken ?? "" },
      body,
    });
  } catch {
    return { ok: false, errors: { general: OFFLINE_ERROR } };
  }

  const data = await response.json().catch(() => null);
  if (response.ok && typeof data?.payUrl === "string") {
    return { ok: true, payUrl: data.payUrl };
  }
  return { ok: false, errors: data?.errors ?? { general: GENERAL_ERROR } };
}
