import uuid

from django.db import models
from django.utils.translation import gettext_lazy as _


def order_stl_path(instance, filename):
    """Uploaded files get a random name; the name the customer's browser sent is never used."""
    return f"stl/{uuid.uuid4().hex}.stl"


class Order(models.Model):
    class OrderStatus(models.TextChoices):
            AWAITING_PAYMENT = "AP", _("Awaiting payment")
            PROCESSING = "PR", _("Processing")
            READY = "RE", _("Ready")
            SHIPPED = "SH", _("Shipped")
            COMPLETED = "CO", _("Completed")
            CANCELLED = "CA", _("Cancelled")

    # What the customer's own order page is addressed by. Random and unguessable,
    # unlike the numeric id, which only staff use.
    public_id = models.UUIDField(default=uuid.uuid4, unique=True, editable=False)
    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    order_status = models.CharField(
        max_length=2,
        choices=OrderStatus.choices,
        default=OrderStatus.PROCESSING,
    )
    delivery_notes = models.CharField(
        max_length=500,
        blank=True,
    )
    subtotal_price = models.DecimalField(max_digits=10, decimal_places=2)
    shipping_costs = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)


    @property
    def is_paid(self):
        return self.payments.filter(status=Payment.PaymentStatus.PAID).exists()

    def all_items_ready(self):
        return (
            self.items.exists()
            and not self.items.filter(is_ready=False).exists()
        )

    def __str__(self):
        return f"Order #{self.pk}"
    

class Payment(models.Model):
    """One attempt to pay an order. See orders/payments.py for the placeholder provider."""

    class PaymentStatus(models.TextChoices):
        PENDING = "PE", _("Pending")
        PAID = "PA", _("Paid")
        FAILED = "FA", _("Failed")

    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="payments",
    )
    provider = models.CharField(max_length=30)
    provider_reference = models.CharField(max_length=100, blank=True)
    amount = models.DecimalField(max_digits=10, decimal_places=2)
    status = models.CharField(
        max_length=2,
        choices=PaymentStatus.choices,
        default=PaymentStatus.PENDING,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    paid_at = models.DateTimeField(blank=True, null=True)

    def __str__(self):
        return f"{self.get_status_display()} payment of {self.amount} for order #{self.order_id}"


class OrderAddress(models.Model):
    order = models.OneToOneField(
        Order,
        on_delete=models.CASCADE,
        related_name="address",
    )

    street_name = models.CharField(max_length=100)
    country = models.CharField(max_length=100)
    city = models.CharField(max_length=100)
    postal_code = models.CharField(max_length=10)
    house_number = models.PositiveIntegerField()
    house_number_addition = models.CharField(
        max_length=20,
        blank=True,
    )

    def __str__(self):
        return f"{self.street_name} {self.house_number}{self.house_number_addition}"

class OrderItem(models.Model):
    order = models.ForeignKey(
        Order,
        on_delete=models.CASCADE,
        related_name="items",
    )
    product = models.ForeignKey(
         "products.Product",
         on_delete=models.PROTECT,
         related_name="order_items"
    )
    # What the customer called this item and a description of it, for custom stamps.
    name = models.CharField(max_length=120, blank=True)
    description = models.CharField(max_length=1000, blank=True)
    # The stamp settings, measurements and design the customer ordered.
    design = models.JSONField(default=dict, blank=True)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    stl_file = models.FileField(
        upload_to=order_stl_path,
        blank=True,
    )
    is_ready = models.BooleanField(default=False)

    @property
    def display_name(self):
        return self.name or self.product.name

    @property
    def line_total(self):
        return self.quantity * self.unit_price

    @property
    def available_stock(self):
        if self.product.product_type == self.product.ProductType.CUSTOM_STAMP:
            return None

        return self.product.stock


    @property
    def quantity_to_produce(self):
        if self.is_ready:
            return 0

        if self.product.product_type == self.product.ProductType.CUSTOM_STAMP:
            return self.quantity

        return max(0, self.quantity - self.product.stock)

    def __str__(self):
        return f"{self.quantity}x {self.product} (Order #{self.order_id})"