import math

# Must match PRICING in src/pricing.js (the frontend's price preview).
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
            "OTHER": 1295,
        },
    },
}

def js_round(value):
    return math.floor(value + 0.5)

def face_area_cm2(stamp, info):
    if info is not None:       
        width = info.get("width") if info.get("width") is not None else stamp['faceSize']
        depth = info.get("depth") if info.get("depth") is not None else stamp['faceSize']
    else:
        width, depth = stamp['faceSize'], stamp['faceSize']
    
    box = (width * depth) / 100

    if stamp["faceShape"] == "round":
        return box * math.pi / 4
    else:
        return box

def estimate_price(stamp, info, quantity, country):
    if not isinstance(quantity, int) or isinstance(quantity, bool) or quantity < 1:
        return None

    #calculate the price based of surface area
    area = face_area_cm2(stamp, info)
    size_cents = js_round(area * PRICING["per_cm2_cents"])
    unit_cents = PRICING["base_cents"] + size_cents
    if stamp["handle"] != "none":
        unit_cents += PRICING["handle_cents"]

    items_cents = unit_cents * quantity

    # calculate price after discount
    discount_rate = 0
    for discount in PRICING["quantity_discounts"]:
        if quantity >= discount["min_quantity"]:
            discount_rate = max(discount["rate"], discount_rate)

    discount_cents = js_round(items_cents * discount_rate)

    after_discount = items_cents - discount_cents

    # add the country shipping price
    by_country = PRICING["shipping"]["by_country_cents"]
    zone = country if country in by_country else "OTHER"

    if after_discount >= PRICING["shipping"]["free_over_cents"]:
        shipping_cents = 0
    else:
        shipping_cents = by_country[zone]

    # final price
    total_cents = after_discount + shipping_cents

    return {
        "unit_cents": unit_cents,
        "items_cents": items_cents,
        "discount_rate": discount_rate,
        "discount_cents": discount_cents,
        "shipping_cents": shipping_cents,
        "total_cents": total_cents,
    }

