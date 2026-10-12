"""Payment handling for orders.

PLACEHOLDER: no money moves. This module is the one place a real payment
provider will be connected, so the rest of the program (the pay page, the order
status, the production jobs) already works the way it will with real payments.

To connect a provider later:
- start_payment() creates the payment with the provider and stores its
  reference, and the pay page sends the customer to the provider.
- complete_payment() is replaced by the provider telling us the result (usually
  a webhook), which marks the payment PAID or FAILED.
"""

from django.utils import timezone

from .models import Payment

PROVIDER = "placeholder"


def start_payment(order):
    """Records an attempt to pay the order's total."""
    return Payment.objects.create(
        order=order,
        provider=PROVIDER,
        amount=order.total_price,
    )


def complete_payment(payment):
    """PLACEHOLDER: accepts every payment immediately. Returns True when paid."""
    payment.status = Payment.PaymentStatus.PAID
    payment.paid_at = timezone.now()
    payment.provider_reference = f"{PROVIDER}-{payment.pk}"
    payment.save(update_fields=["status", "paid_at", "provider_reference"])
    return True
