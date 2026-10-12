"""Price calculation for custom stamp orders.

PLACEHOLDER VALUES: every number in PRICING and COUNTRIES is a stand-in until
the real price list and delivery countries are decided. They are defined once,
here: the stamp generator page receives them through pricing_for_page() for its
live estimate, and create_order() uses estimate_price() so the server always
works out the real price itself. A client-supplied price is never trusted.
"""

import math

PRICING = {
    "currency": "EUR",
    "vat_rate": 0.21,  # prices below already include VAT
    "base_cents": 850,  # one stamp, before size/extras
    "per_cm2_cents": 6,  # per cm² of stamp face
    "handle_cents": 300,
    # Highest matching threshold wins; applied to the item total only.
    "quantity_discounts": [
        {"min_quantity": 10, "rate": 0.10},
        {"min_quantity": 25, "rate": 0.15},
        {"min_quantity": 50, "rate": 0.20},
    ],
    "shipping": {
        "free_over_cents": 5000,
        "by_country_cents": {
            "NL": 495,
            "BE": 695,
            "DE": 695,
            "FR": 895,
            "OTHER": 1295,  # the zone for any other country
        },
    },
}

# Countries the shop delivers to; the keys are the shipping zones above.
COUNTRIES = {
    "NL": "Netherlands",
    "BE": "Belgium",
    "DE": "Germany",
    "FR": "France",
    "OTHER": "Other country",
}

MAX_QUANTITY = 999
MAX_FACE_MM = 250  # sanity limit on the measurements a client may claim


class PricingError(ValueError):
    """The stamp settings or quantity cannot be priced."""


def js_round(value):
    """Round half up, like JavaScript's Math.round, so both sides agree to the cent."""
    return math.floor(value + 0.5)


def _size_mm(value, name):
    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not math.isfinite(value)
        or not 0 < value <= MAX_FACE_MM
    ):
        raise PricingError(f"{name} must be a size in millimetres.")
    return value


def face_area_cm2(stamp, info):
    """Face area from the measured stamp, falling back to the face size setting."""
    info = info or {}
    width = info.get("width")
    depth = info.get("depth")
    width = _size_mm(stamp.get("faceSize") if width is None else width, "width")
    depth = _size_mm(stamp.get("faceSize") if depth is None else depth, "depth")
    box = (width * depth) / 100
    return box * math.pi / 4 if stamp.get("faceShape") == "round" else box


def estimate_price(stamp, info, quantity, country):
    """Returns the price in cents as a dict; raises PricingError if it cannot be priced."""
    if not isinstance(stamp, dict) or not isinstance(info, (dict, type(None))):
        raise PricingError("The stamp settings are missing or invalid.")
    if (
        not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or not 1 <= quantity <= MAX_QUANTITY
    ):
        raise PricingError("The quantity is invalid.")

    area = face_area_cm2(stamp, info)
    unit_cents = PRICING["base_cents"] + js_round(area * PRICING["per_cm2_cents"])
    if stamp.get("handle") != "none":
        unit_cents += PRICING["handle_cents"]

    items_cents = unit_cents * quantity
    discount_rate = max(
        (
            discount["rate"]
            for discount in PRICING["quantity_discounts"]
            if quantity >= discount["min_quantity"]
        ),
        default=0,
    )
    discount_cents = js_round(items_cents * discount_rate)
    after_discount = items_cents - discount_cents

    by_country = PRICING["shipping"]["by_country_cents"]
    zone = country if country in by_country else "OTHER"
    shipping_cents = (
        0
        if after_discount >= PRICING["shipping"]["free_over_cents"]
        else by_country[zone]
    )

    return {
        "unit_cents": unit_cents,
        "items_cents": items_cents,
        "discount_rate": discount_rate,
        "discount_cents": discount_cents,
        "shipping_cents": shipping_cents,
        "total_cents": after_discount + shipping_cents,
    }


def pricing_for_page():
    """PRICING in the shape the browser's estimatePrice() takes (src/.../js/pricing.js)."""
    shipping = PRICING["shipping"]
    return {
        "currency": PRICING["currency"],
        "vatRate": PRICING["vat_rate"],
        "baseCents": PRICING["base_cents"],
        "perCm2Cents": PRICING["per_cm2_cents"],
        "handleCents": PRICING["handle_cents"],
        "quantityDiscounts": [
            {"minQuantity": d["min_quantity"], "rate": d["rate"]}
            for d in PRICING["quantity_discounts"]
        ],
        "shipping": {
            "freeOverCents": shipping["free_over_cents"],
            "byCountryCents": dict(shipping["by_country_cents"]),
        },
    }
