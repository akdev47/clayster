import json
from django.http import JsonResponse
from django.middleware.csrf import get_token
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_GET, require_POST

from .forms import CustomerForm, OrderAddressForm

from decimal import Decimal

from django.db import transaction

from products.utils import get_custom_stamp_product

from .models import Order, OrderItem
from .pricing import estimate_price


CUSTOMER_FIELDS = {
    "firstName": "first_name",
    "lastName": "last_name",
    "email": "email",
    "phone": "phone",
}
ADDRESS_FIELDS = {
    "street": "street_name",
    "houseNumber": "house_number",
    "houseNumberAddition": "house_number_addition",
    "postalCode": "postal_code",
    "city": "city",
    "country": "country",
}

def cents_to_euros(cents):
    return Decimal(cents) / 100

@require_POST
def create_order(request):
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"errors": {"payload": "Invalid JSON."}}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"errors": {"payload": "Invalid JSON."}}, status=400)

    order_details = payload.get("order") or {}
    delivery = payload.get("delivery") or {}

    customer_data = {
        model_field: delivery.get(js_key, "")
        for js_key, model_field in CUSTOMER_FIELDS.items()
    }
    address_data = {
        model_field: delivery.get(js_key, "")
        for js_key, model_field in ADDRESS_FIELDS.items()
    }

    customer_form = CustomerForm(customer_data)
    address_form = OrderAddressForm(address_data)

    order_errors = {}

    title = order_details.get("title")
    if not isinstance(title, str) or title.strip() == "":
        order_errors["title"] = "Give this order item a name."

    quantity = order_details.get("quantity")
    if (
        not isinstance(quantity, int)
        or isinstance(quantity, bool)
        or quantity < 1
        or quantity > 999
    ):
        order_errors["quantity"] = "Quantity must be a whole number from 1 to 999."

    delivery_errors = {}

    if not customer_form.is_valid():
        for js_key, model_field in CUSTOMER_FIELDS.items():
            if model_field in customer_form.errors:
                delivery_errors[js_key] = customer_form.errors[model_field][0]

    if not address_form.is_valid():
        for js_key, model_field in ADDRESS_FIELDS.items():
            if model_field in address_form.errors:
                delivery_errors[js_key] = address_form.errors[model_field][0]

    stamp = payload.get("stamp")
    measurements = payload.get("measurements")
    try:
        price = estimate_price(stamp, measurements, quantity, delivery.get("country", ""))
    except (KeyError, TypeError):
        price = None
    if price is None and "quantity" not in order_errors:
        order_errors["stamp"] = "The stamp settings are missing or invalid."

    if order_errors or delivery_errors:
        return JsonResponse(
            {"errors": {"order": order_errors, "delivery": delivery_errors}},
            status=400,
        )

    with transaction.atomic():
        customer = customer_form.save()

        order = Order.objects.create(
            customer=customer,
            delivery_notes=str(order_details.get("notes", "")).strip(),
            subtotal_price=cents_to_euros(price["items_cents"] - price["discount_cents"]),
            shipping_costs=cents_to_euros(price["shipping_cents"]),
            total_price=cents_to_euros(price["total_cents"]),
        )

        address = address_form.save(commit=False)
        address.order = order
        address.save()

        OrderItem.objects.create(
            order=order,
            product=get_custom_stamp_product(),
            name=title.strip(),
            description=str(order_details.get("description", "")).strip(),
            quantity=quantity,
            unit_price=cents_to_euros(price["unit_cents"]),
            design={
                "stamp": stamp,
                "measurements": measurements,
                "design": payload.get("design"),
            },
        )

    return JsonResponse(
        {"order_id": order.pk, "total_cents": price["total_cents"]},
        status=201,
    )

@require_GET
@ensure_csrf_cookie
def csrf_token(request):
    return JsonResponse({"csrfToken": get_token(request)})
