// The order page: stamp preview (2D / 3D), price estimate,
// printability check, and the order and delivery fields. Placing the order
// sends it to Django (orderApi.js) and continues to the payment page.
import {
  COUNTRY_OPTIONS,
  buildOrderPayload,
  clearOrderDraft,
  loadOrderForm,
  saveOrderDraft,
  validateDelivery,
  validateOrderDetails,
} from "./orderDraft.js";
import { submitOrder } from "./orderApi.js";
import { estimatePrice, formatMoney } from "./pricing.js";
import { createStampSpinner } from "./stampSpinner.js";

const ORDER_FIELDS = {
  title: "title",
  description: "description",
  quantity: "quantity",
  notes: "notes",
};
const DELIVERY_FIELDS = [
  "firstName",
  "lastName",
  "email",
  "street",
  "houseNumber",
  "houseNumberAddition",
  "postalCode",
  "city",
  "country",
  "phone",
];


/**
 * `createStl()` returns the checked STL of the current stamp as a Blob and
 * `config` comes from readServerConfig(): the server's price list and endpoint.
 */
export function createOrderPage({
  designModel,
  pipeline,
  onBack,
  renderPreview,
  createStl,
  config,
}) {
  const byId = (id) => document.getElementById(id);
  const page = byId("order-page");
  const status = byId("order-status");
  const svg = byId("order-stamp-preview");
  const frame3d = byId("order-stamp-3d");

  let view = "2d";
  let spinner = null;
  let stampDrawn = false;

  byId("order-delivery-country").replaceChildren(
    ...COUNTRY_OPTIONS.map(({ code, label }) => new Option(label, code)),
  );

  // --- form ----------------------------------------------------------------

  const orderInput = (field) => byId(`order-${ORDER_FIELDS[field]}`);
  const deliveryInput = (field) => byId(`order-delivery-${field}`);

  const readDetails = () =>
    Object.fromEntries(
      Object.keys(ORDER_FIELDS).map((field) => [field, orderInput(field).value]),
    );
  const readDelivery = () =>
    Object.fromEntries(
      DELIVERY_FIELDS.map((field) => [field, deliveryInput(field).value]),
    );

  const writeForm = ({ details, delivery }) => {
    for (const field of Object.keys(ORDER_FIELDS)) {
      orderInput(field).value = details[field];
    }
    for (const field of DELIVERY_FIELDS) deliveryInput(field).value = delivery[field];
  };

  const showErrors = (orderErrors, deliveryErrors) => {
    for (const field of Object.keys(ORDER_FIELDS)) {
      const id = ORDER_FIELDS[field];
      const box = byId(`order-${id}-error`);
      if (box !== null) box.textContent = orderErrors[field] ?? "";
      orderInput(field).classList.toggle("is-invalid", field in orderErrors);
    }
    for (const field of DELIVERY_FIELDS) {
      byId(`order-delivery-${field}-error`).textContent = deliveryErrors[field] ?? "";
      deliveryInput(field).classList.toggle("is-invalid", field in deliveryErrors);
    }
  };

  const storage = () => {
    try {
      return window.localStorage;
    } catch {
      return null;
    }
  };

  const showStatus = (message, ok) => {
    status.hidden = false;
    status.textContent = message;
    status.classList.toggle("ok", ok);
  };

  // --- price ---------------------------------------------------------------

  const currentPrice = () => {
    const details = readDetails();
    return estimatePrice(
      {
        stamp: pipeline.stamp,
        info: pipeline.result?.info ?? null,
        quantity: details.quantity,
        country: deliveryInput("country").value,
      },
      config.pricing ?? undefined, // the server's price list, else the built-in one
    );
  };

  const renderPrice = () => {
    const price = currentPrice();
    const box = byId("order-price");
    if (price === null) {
      const note = document.createElement("p");
      note.className = "pipeline-note";
      note.textContent = "Enter a quantity to see the price.";
      box.replaceChildren(note);
      return;
    }

    const money = (cents) => formatMoney(cents, price.currency);
    const rows = [
      ...price.unitLines.map(({ label, cents }) => [label, money(cents)]),
      ["Price per stamp", money(price.unitCents), "subtotal"],
      [`Items × ${price.quantity}`, money(price.itemsCents)],
    ];
    if (price.discountCents > 0) {
      rows.push([
        `Quantity discount (${Math.round(price.discountRate * 100)}%)`,
        `−${money(price.discountCents)}`,
        "discount",
      ]);
    }
    rows.push([
      "Shipping",
      price.shippingCents === 0 ? "Free" : money(price.shippingCents),
    ]);
    rows.push(["Total", money(price.totalCents), "total"]);

    const list = document.createElement("dl");
    for (const [label, value, kind] of rows) {
      const row = document.createElement("div");
      row.className = `order-price-row${kind ? ` ${kind}` : ""}`;
      const dt = document.createElement("dt");
      const dd = document.createElement("dd");
      dt.textContent = label;
      dd.textContent = value;
      row.append(dt, dd);
      list.append(row);
    }
    const vat = document.createElement("p");
    vat.className = "pipeline-note";
    vat.textContent = `Includes ${money(price.vatCents)} VAT.`;
    box.replaceChildren(list, vat);
  };

  // --- previews ------------------------------------------------------------

  const renderStamp = () => {
    const scene = renderPreview(svg, byId("order-dimension-text"));
    stampDrawn = scene !== null;
    byId("order-stamp-empty").hidden = scene !== null;

    spinner?.setGeometry(pipeline.result?.stamp ?? null);
  };

  const setView = (next) => {
    view = next;
    for (const button of page.querySelectorAll("[data-order-view]")) {
      button.classList.toggle("active", button.dataset.orderView === next);
    }
    const flat = next !== "3d";
    svg.hidden = !flat || !stampDrawn;
    frame3d.hidden = flat;
    byId("order-stamp-frame").dataset.view = next;

    if (next === "3d" && spinner === null) {
      spinner = createStampSpinner(frame3d);
      spinner.setGeometry(pipeline.result?.stamp ?? null);
    }
    if (next === "3d" && !page.hidden) spinner.start();
    else spinner?.stop();
  };

  byId("order-view-toggle").addEventListener("click", (event) => {
    const button = event.target.closest("[data-order-view]");
    if (button !== null) setView(button.dataset.orderView);
  });

  // --- printability check and summary ---------------------------------------

  // Mirrors the design page's printability check so it can be reviewed here.
  const syncChecklist = () => {
    const source = byId("pipeline-overall-status");
    const label = byId("order-check-status");
    label.textContent = source.textContent;
    label.className = source.className;
    const icon = byId("order-check-icon");
    icon.className = `print-heading-icon order-check-icon ${[
      ...byId("pipeline-overall-icon").classList,
    ]
      .filter((name) => name !== "print-heading-icon")
      .join(" ")}`;
    icon.textContent = byId("pipeline-overall-icon").textContent;
    byId("order-check-list").replaceChildren(
      ...[...byId("pipeline-diagnostic-list").children].map((row) =>
        row.cloneNode(true),
      ),
    );
  };

  const renderSummary = () => {
    const { stamp, result } = pipeline;
    const info = result?.info ?? null;
    const rows = [
      ["Elements", String(designModel.elements.length)],
      ["Face", `${stamp.faceShape}, ${stamp.autoFaceSize ? "auto" : `${stamp.faceSize} mm`}`],
      ["Relief", stamp.mode === "emboss" ? "Raised" : "Recessed"],
      ["Size", info === null ? "—" : `${info.width.toFixed(1)} × ${info.depth.toFixed(1)} mm`],
    ];
    byId("order-summary").replaceChildren(
      ...rows.map(([label, value]) => {
        const cell = document.createElement("div");
        const dt = document.createElement("dt");
        const dd = document.createElement("dd");
        dt.textContent = label;
        dd.textContent = value;
        cell.append(dt, dd);
        return cell;
      }),
    );
  };

  const refresh = () => {
    if (page.hidden) return;
    syncChecklist();
    renderSummary();
    renderStamp();
    renderPrice();
    setView(view);
  };
  for (const type of ["running", "result", "failed"]) {
    pipeline.addEventListener(type, refresh);
  }

  // --- events ----------------------------------------------------------------

  page.addEventListener("input", (event) => {
    status.hidden = true;
    // Editing a field answers its error message, so stop showing it.
    const error = byId(`${event.target.id}-error`);
    if (error !== null) error.textContent = "";
    event.target.classList.remove("is-invalid");
    renderPrice();
  });

  const saveButton = byId("order-save");
  let placing = false;

  byId("order-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    if (placing) return;

    const details = readDetails();
    const delivery = readDelivery();
    const orderErrors = validateOrderDetails(details);
    const deliveryErrors = validateDelivery(delivery);
    showErrors(orderErrors, deliveryErrors);
    if (
      Object.keys(orderErrors).length + Object.keys(deliveryErrors).length > 0
    ) {
      showStatus("Please fix the highlighted fields.", false);
      return;
    }
    if (config.orderEndpoint === null) {
      showStatus("Ordering is not available on this page.", false);
      return;
    }

    const payload = buildOrderPayload({
      details,
      delivery,
      pricing: currentPrice(),
      elements: designModel.elements,
      stamp: pipeline.stamp,
      info: pipeline.result?.info ?? null,
    });
    let stl;
    try {
      stl = createStl();
    } catch (error) {
      showStatus(error.message, false);
      return;
    }

    // Keep what was typed until the server has accepted it.
    const target = storage();
    if (target !== null) saveOrderDraft(target, payload);

    placing = true;
    saveButton.disabled = true;
    showStatus("Placing your order…", true);
    const result = await submitOrder({
      endpoint: config.orderEndpoint,
      csrfToken: config.csrfToken,
      payload,
      stl,
    });

    if (result.ok) {
      // The details now live on the server, so none are left on this device.
      if (target !== null) clearOrderDraft(target);
      window.location.assign(result.payUrl);
      return;
    }

    placing = false;
    saveButton.disabled = false;
    showErrors(result.errors.order ?? {}, result.errors.delivery ?? {});
    showStatus(
      result.errors.general ?? "Please fix the highlighted fields.",
      false,
    );
  });

  byId("order-back").addEventListener("click", onBack);

  const target = storage();
  writeForm(
    loadOrderForm(target ?? { getItem: () => null }),
  );

  return {
    /** Call whenever the page is shown. */
    show() {
      showErrors({}, {});
      status.hidden = true;
      refresh();
    },
    /** Call when leaving the page, so the 3D view stops rendering. */
    hide() {
      spinner?.stop();
    },
  };
}
