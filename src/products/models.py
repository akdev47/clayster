from django.db import models
from django.utils.translation import gettext_lazy as _

class Category(models.Model):
    name = models.CharField(
        max_length=100,
        default="",
    )

    def __str__(self):
        return self.name
    
class Product(models.Model):
    class ProductType(models.TextChoices):
        STANDARD = "ST", _("Standard")
        CUSTOM_STAMP = "CS", _("Custom stamp")

    name = models.CharField(max_length=110)
    short_description = models.CharField(
        max_length=255,
        blank=True
    )
    long_description = models.TextField(blank=True)
    price = models.DecimalField(max_digits=10, decimal_places=2)
    product_type = models.CharField(
        max_length=2,
        choices=ProductType.choices,
        default= ProductType.STANDARD,
    )
    category = models.ForeignKey(
        Category,
        on_delete=models.PROTECT,
        related_name="products",
        blank=True,
        null=True,
    )
    file = models.FileField(
        upload_to="stl-files/",
        blank=True,
    )
    on_website = models.BooleanField(default=False)
    stock = models.PositiveIntegerField(default=0)

    def __str__(self):
        return self.name

