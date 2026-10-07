import json
from django.http import JsonResponse
from django.views.decorators.http import require_POST

from .forms import CustomerForm, OrderAddressForm

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

@require_POST
def create_order(request):
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return JsonResponse({"errors": {"payload": "Invalid JSON."}}, status=400)

    if not isinstance(payload, dict):
        return JsonResponse({"errors": {"payload": "Invalid JSON."}}, status=400)

    order = payload.get("order") or {}
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

    title = order.get("title")
    if not isinstance(title, str) or title.strip() == "":
        order_errors["title"] = "Give this order item a name."

    quantity = order.get("quantity")
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

    if order_errors or delivery_errors:
        return JsonResponse(
            {"errors": {"order": order_errors, "delivery": delivery_errors}},
            status=400,
        )

    return JsonResponse({"ok": True})
