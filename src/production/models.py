from django.db import models
from django.urls import reverse
from django.utils.translation import gettext_lazy as _
from django.core.validators import MinValueValidator

from products.models import Product

class ProductionJob(models.Model):
    class ProductionStatus(models.TextChoices):
            WAITING = "WA", _("Waiting")
            PRINTING = "PR", _("Printing")
            READY = "RE", _("Ready")
            COMPLETED = "CO", _("Completed")
            CANCELLED = "CA", _("Cancelled")

    product = models.ForeignKey(
             "products.Product",
             on_delete=models.PROTECT,
             related_name="production_jobs"
        )

    order_item = models.ForeignKey(
        "orders.OrderItem",
        on_delete=models.PROTECT,
        related_name="production_jobs",
        null=True,
        blank=True,
    )
    
    quantity = models.PositiveIntegerField(default=1)
    status = models.CharField(
            max_length=2,
            choices=ProductionStatus.choices,
            default=ProductionStatus.WAITING,
        )

    created_at = models.DateTimeField(auto_now_add=True)

    started_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    completed_at = models.DateTimeField(
        blank=True,
        null=True,
    )

    @property
    def _stl_owner(self):
        if self.order_item_id:
            item = self.order_item
            if item.product.product_type == Product.ProductType.CUSTOM_STAMP or item.stl_file:
                return item
        return self.product

    @property
    def stl_file(self):
        """Use personalized files without falling back to a generic custom stamp."""
        owner = self._stl_owner
        file = owner.file if isinstance(owner, Product) else owner.stl_file
        return file or None

    @property
    def stl_download_url(self):
        if not self.stl_file:
            return None
        owner = self._stl_owner
        view = "products:download_stl" if isinstance(owner, Product) else "orders:download_item_stl"
        return reverse(view, args=[owner.pk])

    def __str__(self):
        return f"{self.quantity}x {self.product}"
