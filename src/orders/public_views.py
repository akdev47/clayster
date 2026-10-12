"""The pages a customer sees: paying for their order and following it.

Both are addressed by the order's random public_id, never its numeric id. The
link is the only thing that grants access, so these pages are kept out of
caches, search engines and referrer headers, and show only part of the
customer's details.
"""

from functools import wraps

from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.cache import never_cache
from django.views.decorators.http import require_http_methods

from .emails import send_order_confirmation
from .models import Order
from .services import pay_order

STATUS_MESSAGES = {
    Order.OrderStatus.AWAITING_PAYMENT: "Waiting for your payment.",
    Order.OrderStatus.PROCESSING: "Payment received. We are making your stamp.",
    Order.OrderStatus.READY: "Your order is ready and will be shipped soon.",
    Order.OrderStatus.SHIPPED: "Your order is on its way.",
    Order.OrderStatus.COMPLETED: "Your order is complete.",
    Order.OrderStatus.CANCELLED: "This order was cancelled.",
}


def private_page(view):
    """Keeps a page that is reachable by a secret link out of caches, search results and referrers."""

    @wraps(view)
    def wrapper(request, *args, **kwargs):
        response = view(request, *args, **kwargs)
        # "same-origin" and not "no-referrer": with no-referrer browsers send
        # "Origin: null" on form posts, which Django's CSRF check rejects. This
        # still sends no Referer to other sites, such as the CDNs.
        response["Referrer-Policy"] = "same-origin"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response

    return never_cache(wrapper)


def mask_email(email):
    name, _, domain = email.partition("@")
    return f"{name[:1]}***@{domain}"


def _load_order(public_id):
    return get_object_or_404(
        Order.objects.select_related("customer", "address").prefetch_related("items__product"),
        public_id=public_id,
    )


def _discount(order, items):
    """What the quantity discount took off: the items at full price minus the stored subtotal."""
    return sum(item.line_total for item in items) - order.subtotal_price


def _order_url(request, order):
    return request.build_absolute_uri(reverse("orders_public:order", args=[order.public_id]))


@private_page
def order_status(request, public_id):
    order = _load_order(public_id)
    return render(
        request,
        "orders/public/order.html",
        {
            "order": order,
            "items": order.items.all(),
            "discount": _discount(order, order.items.all()),
            "status_message": STATUS_MESSAGES.get(order.order_status, ""),
            "masked_email": mask_email(order.customer.email),
            "order_url": _order_url(request, order),
            "is_paid": order.is_paid,
        },
    )


@private_page
@require_http_methods(["GET", "POST"])
def pay(request, public_id):
    order = _load_order(public_id)
    if order.order_status != Order.OrderStatus.AWAITING_PAYMENT:
        return redirect("orders_public:order", public_id=public_id)

    if request.method == "POST":
        order, paid = pay_order(order.pk)
        if paid:
            send_order_confirmation(order, _order_url(request, order))
        return redirect("orders_public:order", public_id=public_id)

    return render(
        request,
        "orders/public/pay.html",
        {"order": order, "items": order.items.all(), "discount": _discount(order, order.items.all())},
    )
