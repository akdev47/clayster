import json
import math
from decimal import Decimal

from django.core.files.base import ContentFile
from django.db import transaction
from django.http import JsonResponse
from django.urls import reverse
from django.views.decorators.http import require_POST

from customers.models import Customer
from products.utils import get_custom_stamp_product

from .forms import DeliveryForm, OrderDetailsForm
from .models import Order, OrderAddress, OrderItem
from .pricing import PricingError, estimate_price
from .stl import MAX_STL_BYTES, StlError, extents_match, read_stl

MAX_PAYLOAD_CHARS = 1_000_000


def _reject_constant(name):
    raise ValueError(f"{name} is not valid JSON")


def _euros(cents):
    return (Decimal(cents) / 100).quantize(Decimal("0.01"))


def _field_errors(form):
    return {field: messages[0] for field, messages in form.errors.items() if field != "__all__"}


def _claimed_extents(measurements):
    """The size the browser says the stamp has, as three plain numbers."""
    if not isinstance(measurements, dict):
        raise PricingError("The stamp measurements are missing.")
    values = [measurements.get(key) for key in ("width", "depth", "height")]
    for value in values:
        if (
            isinstance(value, bool)
            or not isinstance(value, (int, float))
            or not math.isfinite(value)
            or value <= 0
        ):
            raise PricingError("The stamp measurements are invalid.")
    return values


def _failure(errors):
    return JsonResponse({"errors": errors}, status=400)


@require_POST
def create_order(request):
    """Creates an order, awaiting payment, from the stamp generator's order page.

    The request is multipart: `payload` is the JSON from buildOrderPayload() in
    orderDraft.js and `stl` is the stamp file the browser built. Nothing the
    client says about price is used; the price is calculated here.
    """
    raw = request.POST.get("payload", "")
    upload = request.FILES.get("stl")
    if not raw or upload is None:
        return _failure({"general": "The order is incomplete. Please try again."})
    if len(raw) > MAX_PAYLOAD_CHARS:
        return _failure({"general": "The order is too large."})
    try:
        payload = json.loads(raw, parse_constant=_reject_constant)
    except ValueError:
        return _failure({"general": "The order could not be read. Please try again."})
    if not isinstance(payload, dict):
        return _failure({"general": "The order could not be read. Please try again."})

    details = payload.get("order")
    delivery = payload.get("delivery")
    details_form = OrderDetailsForm(details if isinstance(details, dict) else {})
    delivery_form = DeliveryForm(delivery if isinstance(delivery, dict) else {})
    details_ok = details_form.is_valid()
    delivery_ok = delivery_form.is_valid()
    errors = {
        "order": _field_errors(details_form),
        "delivery": _field_errors(delivery_form),
    }

    stl_data = stl_info = None
    if upload.size > MAX_STL_BYTES:
        errors["general"] = "The stamp file is too large."
    else:
        stl_data = upload.read()
        try:
            stl_info = read_stl(stl_data)
        except StlError as error:
            errors["general"] = str(error)

    price = None
    stamp = payload.get("stamp")
    measurements = payload.get("measurements")
    if details_ok and delivery_ok and stl_info is not None:
        try:
            price = estimate_price(
                stamp,
                measurements,
                details_form.cleaned_data["quantity"],
                delivery_form.cleaned_data["country"],
            )
            if not extents_match(stl_info.extents_mm, _claimed_extents(measurements)):
                raise PricingError("The stamp file does not match the stamp settings.")
        except PricingError as error:
            errors["general"] = str(error)

    if price is None or errors["order"] or errors["delivery"] or "general" in errors:
        return _failure(errors)

    cleaned = details_form.cleaned_data
    with transaction.atomic():
        customer = Customer.objects.create(**delivery_form.customer_fields())
        order = Order.objects.create(
            customer=customer,
            order_status=Order.OrderStatus.AWAITING_PAYMENT,
            delivery_notes=cleaned["notes"],
            subtotal_price=_euros(price["items_cents"] - price["discount_cents"]),
            shipping_costs=_euros(price["shipping_cents"]),
            total_price=_euros(price["total_cents"]),
        )
        OrderAddress.objects.create(order=order, **delivery_form.address_fields())
        item = OrderItem(
            order=order,
            product=get_custom_stamp_product(),
            name=cleaned["title"],
            description=cleaned["description"],
            quantity=cleaned["quantity"],
            unit_price=_euros(price["unit_cents"]),
            design={
                "stamp": stamp,
                "measurements": measurements,
                "design": payload.get("design"),
                "stl": {
                    "triangles": stl_info.triangles,
                    "extentsMm": list(stl_info.extents_mm),
                },
            },
        )
        item.stl_file.save("stamp.stl", ContentFile(stl_data), save=False)
        item.save()

    return JsonResponse(
        {"payUrl": reverse("orders_public:pay", args=[order.public_id])},
        status=201,
    )
