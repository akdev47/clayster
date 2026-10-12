from django.db import transaction

from products.models import Product
from production.models import ProductionJob

from .models import Order
from .payments import complete_payment, start_payment


@transaction.atomic
def pay_order(order_id):
    """Pays an order that is awaiting payment and hands it over to production.

    Returns (order, paid). Paying again, or paying an order that is not awaiting
    payment, changes nothing and returns paid=False, so a double click or a
    reloaded page cannot pay or start production twice.
    """
    order = Order.objects.select_for_update().get(pk=order_id)
    if order.order_status != Order.OrderStatus.AWAITING_PAYMENT:
        return order, False

    payment = start_payment(order)
    if not complete_payment(payment):
        return order, False

    order.order_status = Order.OrderStatus.PROCESSING
    order.save(update_fields=["order_status"])

    for item in order.items.select_related("product"):
        if item.product.product_type == Product.ProductType.CUSTOM_STAMP:
            ProductionJob.objects.create(
                product=item.product,
                order_item=item,
                quantity=item.quantity,
            )
    return order, True
