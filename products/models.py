from django.db import models
from django.utils.translation import gettext_lazy as _

class Product(models.Model):
    class ProductType(models.TextChoices):
        STANDARD = "ST", _("Standard")
        CUSTOM_STAMP = "CS", _("Custom stamp")

    name = models.CharField(max_length=110)
    description = models.CharField(max_length=512)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    product_type = models.CharField(
        max_length=2,
        choices=ProductType.choices
    )

    def __str__(self):
        return self.name