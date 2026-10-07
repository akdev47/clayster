from django.db import models
from django.utils.translation import gettext_lazy as _

class Order(models.Model):
    class OrderStatus(models.TextChoices):
            PROCESSING = "PR", _("Processing")
            READY = "RE", _("Ready")
            SHIPPED = "SH", _("Shipped")
            CANCELLED = "CA", _("Cancelled")

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
        max_length=256,
        blank=True,
    )
    subtotal_price = models.DecimalField(max_digits=10, decimal_places=2)
    shipping_costs = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return f"Order #{self.pk}"
    

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
    name = models.CharField(max_length=100)
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
    description = models.CharField(max_length=512, blank=True)
    quantity = models.PositiveIntegerField(default=1)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    stl_file = models.FileField(
        upload_to="stl/",
        blank=True,
    )
    design = models.JSONField(
         default=dict,
         blank=True
    )
    # stl_file = models.URLField(blank=True) if we are using URLs

    def __str__(self):
        return f"{self.quantity}x {self.product} (Order #{self.order_id})"