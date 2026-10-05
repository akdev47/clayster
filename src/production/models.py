from django.db import models
from django.utils.translation import gettext_lazy as _

class ProductionJob(models.Model):
    class ProductionStatus(models.TextChoices):
            WAITING = "WA", _("Waiting")
            PRINTING = "PR", _("Printing")
            READY = "RE", _("Ready")
            COMPLETED = "CO", _("Completed")

    product = models.ForeignKey(
             "products.Product",
             on_delete=models.PROTECT,
             related_name="production_jobs"
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

    def __str__(self):
        return f"{self.quantity}x {self.product}"