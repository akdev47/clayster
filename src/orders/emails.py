"""Emails sent to customers.

PLACEHOLDER: the message is composed and handed to Django's mail layer, which
is set to the console backend in settings.MAILERS, so it is printed in the
server log and nothing is delivered. Configuring a real mail backend there is
all that is needed to send these for real; the texts live in
orders/templates/orders/email/.
"""

import logging

from django.core.mail import EmailMessage
from django.template.loader import render_to_string

logger = logging.getLogger(__name__)


def send_order_confirmation(order, order_url):
    """Tells the customer their order is paid and where to follow it."""
    body = render_to_string(
        "orders/email/order_confirmation.txt",
        {"order": order, "order_url": order_url, "items": order.items.all()},
    )
    message = EmailMessage(
        subject=f"Your Clayster order #{order.pk}",
        body=body,
        to=[order.customer.email],
    )
    try:
        message.send()
    except Exception:
        # A mail problem must never undo or hide an order that is already paid.
        logger.exception("Could not send the confirmation for order %s", order.pk)
