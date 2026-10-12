from decimal import Decimal

from django.db import transaction

from customers.models import Customer
from products.models import Product
from production.models import ProductionJob

from .models import Order, OrderItem


@transaction.atomic
def create_test_order(product):
    customer, _ = Customer.objects.get_or_create(
        email="test@clayster.local",
        defaults={
            "first_name": "Test",
            "last_name": "Customer",
            "phone": "",
        },
    )

    quantity = 1
    subtotal = product.price * quantity
    shipping = Decimal("5.00")

    order = Order.objects.create(
        customer=customer,
        subtotal_price=subtotal,
        shipping_costs=shipping,
        total_price=subtotal + shipping,
    )

    order_item = OrderItem.objects.create(
        order=order,
        product=product,
        quantity=quantity,
        unit_price=product.price,
    )

    if product.product_type == Product.ProductType.CUSTOM_STAMP:
        ProductionJob.objects.create(
            product=product,
            order_item=order_item,
            quantity=quantity,
        )

    return order