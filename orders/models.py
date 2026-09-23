from django.db import models
from django.utils.translation import gettext_lazy as _

class Order(models.Model):
    class OrderStatus(models.TextChoices):
            WAITING = "WA", _("Waiting")
            PRINTING = "PR", _("Printing")
            READY = "RE", _("Ready")
            COMPLETED = "CO", _("Completed")
            CANCELLED = "CA", _("Cancelled")

    customer = models.ForeignKey(
        "customers.Customer",
        on_delete=models.PROTECT,
        related_name="orders",
    )
    created_at = models.DateTimeField(auto_now_add=True)
    order_status = models.CharField(
        max_length=2,
        choices=OrderStatus.choices
    )
    delivery_notes = models.CharField(max_length=256)
    subtotal_price = models.DecimalField(max_digits=10, decimal_places=2)
    shipping_costs = models.DecimalField(max_digits=10, decimal_places=2)
    total_price = models.DecimalField(max_digits=10, decimal_places=2)

    def __str__(self):
        return self.pk
    

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
        return self.street_name, self.house_number, self.house_number_addition

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
    quantity = models.PositiveIntegerField()
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    stl_file = models.CharField(
        max_length=100,
        blank=True,
    )

    def __str__(self):
        return self.pk, self.order, self.product